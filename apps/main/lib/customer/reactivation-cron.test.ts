import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runReactivationCampaignCron,
  reactivationCutoffs,
  type ReactivationCandidate,
  type ReactivationCronStore,
} from './reactivation-cron.ts';
import { recordReactivationResponse, type ReactivationResponseStore } from './reactivation-response.ts';
import { REACTIVATION_COOLDOWN_DAYS } from './reactivation.ts';

/**
 * Integration tests for Gate #9 with an in-memory store: the real cron
 * runner driving the real decision rules, no database. The Drizzle adapter
 * (reactivation-store.ts) is covered by the source-level wiring checks in
 * reactivation.wiring.test.ts because importing it here would require
 * DATABASE_URL.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-24T10:00:00.000Z');
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const WA_ACCOUNT = 'wa-account-1';

interface CampaignRow {
  id: string;
  tenantId: string;
  customerPhone: string;
  segment: 'dormant' | 'at_risk';
  messageText: string;
  sentAt: Date | null;
  responded: boolean;
  createdAt: Date;
}

let campaignSeq = 0;

class MemoryCronStore implements ReactivationCronStore {
  tenants: string[] = [];
  candidates: ReactivationCandidate[] = [];
  /** Phones per tenant that received a campaign inside the cooldown. */
  recent: Record<string, Set<string>> = {};
  waAccount: string | null = null;
  campaigns: CampaignRow[] = [];
  dispatched: Array<{ tenantId: string; to: string; text: string }> = [];
  /** Phones whose operator dispatch should fail. */
  failFor = new Set<string>();
  /**
   * Set to false to simulate a hand-rolled/buggy adapter that returns
   * candidates without tenant filtering — the runner must catch that.
   */
  strictTenantFilter = true;

  constructor(mutate: (store: MemoryCronStore) => void = () => {}) {
    mutate(this);
  }

  findTenantIds(): Promise<string[]> {
    return Promise.resolve([...this.tenants]);
  }

  fetchReactivationCandidates(tenantId: string): Promise<ReactivationCandidate[]> {
    if (!this.strictTenantFilter) return Promise.resolve([...this.candidates]);
    return Promise.resolve(this.candidates.filter((candidate) => candidate.tenantId === tenantId));
  }

  fetchRecentCampaignRecipients(tenantId: string): Promise<Set<string>> {
    return Promise.resolve(this.recent[tenantId] ?? new Set());
  }

  findWhatsAppAccount(): Promise<string | null> {
    return Promise.resolve(this.waAccount);
  }

  createPendingCampaign(
    tenantId: string,
    customerPhone: string,
    segment: 'dormant' | 'at_risk',
    messageText: string
  ): Promise<{ id: string }> {
    const row: CampaignRow = {
      id: `campaign-${++campaignSeq}`,
      tenantId,
      customerPhone,
      segment,
      messageText,
      sentAt: null,
      responded: false,
      createdAt: NOW,
    };
    this.campaigns.push(row);
    return Promise.resolve({ id: row.id });
  }

  markSent(campaignId: string, sentAt: Date): Promise<boolean> {
    const row = this.campaigns.find((campaign) => campaign.id === campaignId);
    if (!row || row.sentAt !== null) return Promise.resolve(false);
    row.sentAt = sentAt;
    return Promise.resolve(true);
  }

  dispatchWhatsApp(input: { tenantId: string; to: string; text: string }): Promise<{ ok: boolean; error?: string }> {
    this.dispatched.push(input);
    if (this.failFor.has(input.to)) return Promise.resolve({ ok: false, error: 'Operator unreachable' });
    return Promise.resolve({ ok: true });
  }
}

function candidate(overrides: Partial<ReactivationCandidate> & { tenantId: string; customerPhone: string }): ReactivationCandidate {
  return {
    profileId: `profile-${overrides.customerPhone}`,
    customerName: 'Thabo',
    segment: 'dormant',
    lastVisitAt: new Date(NOW.getTime() - 200 * DAY),
    preferences: null,
    tenantName: 'Gemino Grill',
    ...overrides,
  };
}

describe('reactivation cron creates and sends campaigns', () => {
  test('eligible dormant and at-risk customers get created, dispatched and marked sent', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        candidate({ tenantId: TENANT_A, customerPhone: '27820000001', segment: 'dormant', lastVisitAt: new Date(NOW.getTime() - 210 * DAY) }),
        candidate({ tenantId: TENANT_A, customerPhone: '27820000002', segment: 'at_risk', lastVisitAt: new Date(NOW.getTime() - 150 * DAY), customerName: 'Nadia' }),
      ];
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.tenantsChecked, 1);
    assert.equal(summary.candidatesScanned, 2);
    assert.equal(summary.campaignsCreated, 2);
    assert.equal(summary.sent, 2);
    assert.equal(summary.skipped.failed, 0);
    assert.equal(store.dispatched.length, 2);
    assert.ok(store.campaigns.every((campaign) => campaign.sentAt !== null));

    const dormant = store.campaigns.find((campaign) => campaign.customerPhone === '27820000001')!;
    assert.equal(dormant.segment, 'dormant');
    assert.match(dormant.messageText, /we've missed you at Gemino Grill!/);
    assert.match(dormant.messageText, /enjoy 10% off/);

    const atRisk = store.campaigns.find((campaign) => campaign.customerPhone === '27820000002')!;
    assert.equal(atRisk.segment, 'at_risk');
    assert.match(atRisk.messageText, /Book a table this week and we'll save your favorite spot/);

    // Samples expose what was actually sent, for logs and tests alike.
    assert.equal(summary.samples.length, 2);
    assert.ok(summary.samples.some((sample) => sample.segment === 'dormant' && sample.to === '27820000001'));
  });

  test('a customer whose last visit went past 180 days gets the dormant copy even with a stale label', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        candidate({ tenantId: TENANT_A, customerPhone: '27820000003', segment: 'at_risk', lastVisitAt: new Date(NOW.getTime() - 200 * DAY) }),
      ];
    });

    await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(store.campaigns[0].segment, 'dormant');
  });

  test('customers whose re-derived segment says no are skipped as not eligible', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        // Stale dormant label, but they visited last week.
        candidate({ tenantId: TENANT_A, customerPhone: '27820000004', segment: 'dormant', lastVisitAt: new Date(NOW.getTime() - 7 * DAY) }),
      ];
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped.notEligible, 1);
    assert.equal(store.campaigns.length, 0);
  });
});

describe('reactivation cron anti-spam cooldown', () => {
  test('customers who received a campaign in the last 90 days are skipped', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        candidate({ tenantId: TENANT_A, customerPhone: '27820000010' }),
        candidate({ tenantId: TENANT_A, customerPhone: '27820000011' }),
      ];
      s.recent[TENANT_A] = new Set(['27820000010']);
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.skipped.recentCampaign, 1);
    assert.equal(summary.sent, 1);
    assert.equal(store.campaigns.length, 1);
    assert.equal(store.campaigns[0].customerPhone, '27820000011');
    // The exact phone that was messaged before must NOT be re-messaged.
    assert.ok(!store.dispatched.some((d) => d.to === '27820000010'));
  });

  test('the cooldown window is exactly 90 days wide', () => {
    const { cooldownSince } = reactivationCutoffs(NOW);
    assert.equal(
      Math.round((NOW.getTime() - cooldownSince.getTime()) / DAY),
      REACTIVATION_COOLDOWN_DAYS
    );
  });
});

describe('reactivation cron POPIA compliance', () => {
  test('opted-out contacts are never messaged, even if the store returns them', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        candidate({ tenantId: TENANT_A, customerPhone: '27820000020', optedOut: true }),
      ];
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.skipped.optedOut, 1);
    assert.equal(summary.sent, 0);
    assert.equal(store.campaigns.length, 0);
    assert.equal(store.dispatched.length, 0);
  });

  test('tenants with AI off or in manual mode are skipped (defense in depth)', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        candidate({ tenantId: TENANT_A, customerPhone: '27820000021', tenantAiEnabled: false }),
        candidate({ tenantId: TENANT_A, customerPhone: '27820000022', tenantManualMode: true }),
      ];
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.skipped.tenantMessagingDisabled, 2);
    assert.equal(store.campaigns.length, 0);
  });
});

describe('reactivation cron tenant isolation', () => {
  test('a candidate returned for the wrong tenant is refused', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      // Simulate a buggy adapter that returns tenant B's row for tenant A.
      s.strictTenantFilter = false;
      s.candidates = [
        candidate({ tenantId: TENANT_B, customerPhone: '27820000030' }),
      ];
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.skipped.failed, 1);
    assert.equal(store.campaigns.length, 0);
    assert.equal(store.dispatched.length, 0);
  });

  test('the same phone number in two tenants gets two independent campaigns', async () => {
    const sharedPhone = '27820000031';
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A, TENANT_B];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        candidate({ tenantId: TENANT_A, customerPhone: sharedPhone, tenantName: 'Gemino Grill' }),
        candidate({ tenantId: TENANT_B, customerPhone: sharedPhone, tenantName: 'Flavourly Bistro', customerName: 'Thabo B' }),
      ];
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.sent, 2);
    const forA = store.campaigns.find((campaign) => campaign.tenantId === TENANT_A)!;
    const forB = store.campaigns.find((campaign) => campaign.tenantId === TENANT_B)!;
    assert.equal(forA.customerPhone, sharedPhone);
    assert.equal(forB.customerPhone, sharedPhone);
    assert.match(forA.messageText, /Gemino Grill/);
    assert.match(forB.messageText, /Flavourly Bistro/);
  });

  test('a cooldown in one tenant does not block the same phone in another', async () => {
    const sharedPhone = '27820000032';
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A, TENANT_B];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        candidate({ tenantId: TENANT_A, customerPhone: sharedPhone }),
        candidate({ tenantId: TENANT_B, customerPhone: sharedPhone }),
      ];
      s.recent[TENANT_A] = new Set([sharedPhone]);
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.skipped.recentCampaign, 1);
    assert.equal(summary.sent, 1);
    assert.equal(store.campaigns[0].tenantId, TENANT_B);
  });
});

describe('reactivation cron failure handling', () => {
  test('a tenant with no connected WhatsApp account creates nothing', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = null;
      s.candidates = [candidate({ tenantId: TENANT_A, customerPhone: '27820000040' })];
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.skipped.noWhatsAppAccount, 1);
    assert.equal(store.campaigns.length, 0);
    assert.equal(store.dispatched.length, 0);
  });

  test('a failed dispatch leaves the campaign pending and visible, never marked sent', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [candidate({ tenantId: TENANT_A, customerPhone: '27820000041' })];
      s.failFor = new Set(['27820000041']);
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW });

    assert.equal(summary.campaignsCreated, 1);
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped.failed, 1);
    assert.equal(store.campaigns[0].sentAt, null);
    assert.equal(store.campaigns[0].responded, false);
  });

  test('the per-tenant limit caps how many campaigns one run creates', async () => {
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        candidate({ tenantId: TENANT_A, customerPhone: '27820000050' }),
        candidate({ tenantId: TENANT_A, customerPhone: '27820000051' }),
        candidate({ tenantId: TENANT_A, customerPhone: '27820000052' }),
      ];
    });

    const summary = await runReactivationCampaignCron(store, { now: NOW, limit: 2 });

    assert.equal(summary.campaignsCreated, 2);
    assert.equal(store.campaigns.length, 2);
  });
});

describe('customer reply marks the campaign responded', () => {
  function responseStore(rows: CampaignRow[]): ReactivationResponseStore {
    return {
      findRecentSentCampaigns: (tenantId, customerPhone, since) =>
        Promise.resolve(
          rows
            .filter(
              (row) =>
                row.tenantId === tenantId &&
                row.customerPhone === customerPhone &&
                row.sentAt !== null &&
                new Date(row.sentAt).getTime() >= since.getTime()
            )
            .sort((a, b) => new Date(b.sentAt!).getTime() - new Date(a.sentAt!).getTime())
        ),
      markResponded: (campaignId) => {
        const row = rows.find((r) => r.id === campaignId);
        if (!row || row.responded) return Promise.resolve(false);
        row.responded = true;
        return Promise.resolve(true);
      },
    };
  }

  test('a booking-intent reply flips responded on the sent campaign', async () => {
    const rows: CampaignRow[] = [
      {
        id: 'campaign-100',
        tenantId: TENANT_A,
        customerPhone: '27820000060',
        segment: 'dormant',
        messageText: 'win-back',
        sentAt: new Date(NOW.getTime() - 2 * DAY),
        responded: false,
        createdAt: NOW,
      },
    ];

    const marked = await recordReactivationResponse(responseStore(rows), {
      tenantId: TENANT_A,
      customerPhone: '27820000060',
      text: 'Hi! I would like to book a table for Saturday',
      now: NOW,
    });

    assert.equal(marked?.id, 'campaign-100');
    assert.equal(rows[0].responded, true);
  });

  test('a reply without booking intent does not burn the response flag', async () => {
    const rows: CampaignRow[] = [
      { id: 'campaign-101', tenantId: TENANT_A, customerPhone: '27820000061', segment: 'dormant', messageText: 'win-back', sentAt: NOW, responded: false, createdAt: NOW },
    ];

    const marked = await recordReactivationResponse(responseStore(rows), {
      tenantId: TENANT_A,
      customerPhone: '27820000061',
      text: 'no thanks, not this time',
      now: NOW,
    });

    assert.equal(marked, null);
    assert.equal(rows[0].responded, false);
  });

  test('a pending (undispatched) campaign can never be responded to', async () => {
    const rows: CampaignRow[] = [
      { id: 'campaign-102', tenantId: TENANT_A, customerPhone: '27820000062', segment: 'dormant', messageText: 'win-back', sentAt: null, responded: false, createdAt: NOW },
    ];

    const marked = await recordReactivationResponse(responseStore(rows), {
      tenantId: TENANT_A,
      customerPhone: '27820000062',
      text: 'yes please reserve us a table',
      now: NOW,
    });

    assert.equal(marked, null);
    assert.equal(rows[0].responded, false);
  });

  test('an old campaign outside the reply window is not flipped', async () => {
    const rows: CampaignRow[] = [
      { id: 'campaign-103', tenantId: TENANT_A, customerPhone: '27820000063', segment: 'dormant', messageText: 'win-back', sentAt: new Date(NOW.getTime() - 30 * DAY), responded: false, createdAt: NOW },
    ];

    const marked = await recordReactivationResponse(responseStore(rows), {
      tenantId: TENANT_A,
      customerPhone: '27820000063',
      text: 'I would like to book',
      now: NOW,
    });

    assert.equal(marked, null);
    assert.equal(rows[0].responded, false);
  });

  test('a second reply after a response is a no-op (once-only)', async () => {
    const rows: CampaignRow[] = [
      { id: 'campaign-104', tenantId: TENANT_A, customerPhone: '27820000064', segment: 'dormant', messageText: 'win-back', sentAt: NOW, responded: true, createdAt: NOW },
    ];

    const marked = await recordReactivationResponse(responseStore(rows), {
      tenantId: TENANT_A,
      customerPhone: '27820000064',
      text: 'reserve for two please',
      now: NOW,
    });

    assert.equal(marked, null);
    assert.equal(rows[0].responded, true);
  });
});

describe('reactivation end-to-end flow (logic level)', () => {
  test('dormant customer -> cron sends -> customer replies -> campaign marked responded', async () => {
    // 1. A dormant customer exists (200 days since last visit, vegetarian).
    const store = new MemoryCronStore((s) => {
      s.tenants = [TENANT_A];
      s.waAccount = WA_ACCOUNT;
      s.candidates = [
        candidate({
          tenantId: TENANT_A,
          customerPhone: '27820000070',
          customerName: 'Lerato',
          segment: 'dormant',
          lastVisitAt: new Date(NOW.getTime() - 200 * DAY),
          preferences: { dietary: ['vegetarian'], occasions: ['birthday'] },
        }),
      ];
    });

    // 2. The daily cron runs: one personalised campaign, dispatched + sent.
    const cronSummary = await runReactivationCampaignCron(store, { now: NOW });
    assert.equal(cronSummary.sent, 1);
    assert.equal(store.campaigns.length, 1);

    const campaign = store.campaigns[0];
    assert.equal(campaign.tenantId, TENANT_A);
    assert.equal(campaign.segment, 'dormant');
    assert.ok(campaign.sentAt);
    assert.match(campaign.messageText, /Hi Lerato/);
    assert.match(campaign.messageText, /vegetarian/);
    assert.match(campaign.messageText, /birthday/);
    assert.equal(campaign.responded, false);

    // 3. The customer replies with booking intent (webhook path).
    const replyAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const marked = await recordReactivationResponse(
      {
        findRecentSentCampaigns: (tenantId, phone, since) =>
          Promise.resolve(
            store.campaigns.filter(
              (row) =>
                row.tenantId === tenantId &&
                row.customerPhone === phone &&
                row.sentAt !== null &&
                new Date(row.sentAt!).getTime() >= since.getTime()
            )
          ),
        markResponded: (campaignId) => {
          const row = store.campaigns.find((r) => r.id === campaignId)!;
          row.responded = true;
          return Promise.resolve(true);
        },
      },
      {
        tenantId: TENANT_A,
        customerPhone: '27820000070',
        text: 'Hi Gemino! I would love to book a table this weekend',
        now: replyAt,
      }
    );

    // 4. The campaign is marked responded — once, and only once.
    assert.equal(marked?.id, campaign.id);
    assert.equal(campaign.responded, true);

    const again = await recordReactivationResponse(
      {
        findRecentSentCampaigns: () => Promise.resolve(store.campaigns.filter((row) => row.sentAt !== null)),
        markResponded: (campaignId) => {
          const row = store.campaigns.find((r) => r.id === campaignId)!;
          row.responded = true;
          return Promise.resolve(true);
        },
      },
      { tenantId: TENANT_A, customerPhone: '27820000070', text: 'book!', now: replyAt }
    );
    assert.equal(again, null);

    // 5. The next day's cron does NOT re-message them (90-day cooldown).
    const nextDay = new Date(NOW.getTime() + DAY);
    store.recent[TENANT_A] = new Set(['27820000070']);
    const nextRun = await runReactivationCampaignCron(store, { now: nextDay });
    assert.equal(nextRun.sent, 0);
    assert.equal(nextRun.skipped.recentCampaign, 1);
    assert.equal(store.campaigns.length, 1);
  });
});
