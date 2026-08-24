import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runReactivationCampaignCron,
  type ReactivationCampaignRecord,
  type ReactivationCampaignStore,
  type ReactivationCandidate,
  type ReactivationTenant,
} from './reactivation-cron.ts';
import { isWithinResponseWindow } from './reactivation.ts';

/**
 * Integration tests for the reactivation cron runner against an in-memory
 * store. These exercise the full loop — eligibility, POPIA, cooldown,
 * resume, dispatch — without a database; the Drizzle adapter's SQL is
 * covered by reactivation.wiring.test.ts.
 */

const NOW = new Date('2026-08-24T10:00:00.000Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * MS_PER_DAY);

interface StoredCampaign extends ReactivationCampaignRecord {
  tenantId: string;
  customerPhone: string;
}

class MemoryStore implements ReactivationCampaignStore {
  tenants: ReactivationTenant[] = [];
  candidatesByTenant = new Map<string, ReactivationCandidate[]>();
  campaigns: StoredCampaign[] = [];
  queued: Array<{ tenantId: string; waAccountId: string; to: string; text: string }> = [];
  senderByTenant = new Map<string, string>();
  private seq = 0;

  findTenants() {
    return Promise.resolve(this.tenants);
  }

  fetchCampaignCandidates(tenantId: string) {
    return Promise.resolve(this.candidatesByTenant.get(tenantId) ?? []);
  }

  findLatestCampaign(tenantId: string, customerPhone: string) {
    const rows = this.campaigns
      .filter((c) => c.tenantId === tenantId && c.customerPhone === customerPhone)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(rows[0] ?? null);
  }

  createPendingCampaign(
    tenantId: string,
    customerPhone: string,
    segment: 'dormant' | 'at_risk',
    messageText: string
  ) {
    const row: StoredCampaign = {
      id: `campaign-${++this.seq}`,
      tenantId,
      customerPhone,
      segment,
      messageText,
      sentAt: null,
      createdAt: new Date(NOW.getTime() + this.seq),
      responded: false,
    };
    this.campaigns.push(row);
    return Promise.resolve(row);
  }

  markSent(campaignId: string, sentAt: Date) {
    const row = this.campaigns.find((c) => c.id === campaignId);
    if (row) row.sentAt = sentAt;
    return Promise.resolve(!!row);
  }

  markResponded(campaignId: string) {
    const row = this.campaigns.find((c) => c.id === campaignId);
    if (row) row.responded = true;
    return !!row;
  }

  queueCampaignMessage(input: { tenantId: string; waAccountId: string; to: string; text: string }) {
    this.queued.push(input);
    return Promise.resolve();
  }

  resolveSender(tenantId: string) {
    const waAccountId = this.senderByTenant.get(tenantId);
    return Promise.resolve(waAccountId ? { waAccountId } : null);
  }

  /** The webhook's attribution hook, mirrored against the in-memory rows. */
  attributeResponse(tenantId: string, phone: string, replyAt: Date = NOW): StoredCampaign | null {
    const latest = this.campaigns
      .filter(
        (c) =>
          c.tenantId === tenantId &&
          c.customerPhone === phone &&
          c.sentAt !== null &&
          c.responded === false
      )
      .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0))[0];
    if (!latest?.sentAt) return null;
    if (!isWithinResponseWindow(latest.sentAt, replyAt)) return null;
    return this.markResponded(latest.id) ? latest : null;
  }
}

function tenant(overrides: Partial<ReactivationTenant> = {}): ReactivationTenant {
  return { id: 't1', name: 'Flavourly', aiEnabled: true, manualMode: false, ...overrides };
}

function candidate(overrides: Partial<ReactivationCandidate> = {}): ReactivationCandidate {
  return {
    profileId: 'p1',
    tenantId: 't1',
    customerPhone: '27820000001',
    customerName: 'Thabo',
    totalVisits: 6,
    lastVisitAt: daysAgo(200),
    storedSegment: 'dormant',
    preferences: {},
    blocklisted: false,
    ...overrides,
  };
}

function seedCampaign(store: MemoryStore, overrides: Partial<StoredCampaign> = {}): StoredCampaign {
  const row: StoredCampaign = {
    id: `seed-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: 't1',
    customerPhone: '27820000001',
    segment: 'dormant',
    messageText: 'Hi Thabo, we missed you.',
    sentAt: daysAgo(30),
    createdAt: daysAgo(30),
    responded: false,
    ...overrides,
  };
  store.campaigns.push(row);
  return row;
}

async function run(store: MemoryStore, options: { limit?: number } = {}) {
  return runReactivationCampaignCron(store, { now: NOW, ...options });
}

describe('reactivation cron — happy paths', () => {
  test('creates and sends a personalized campaign for an eligible dormant customer', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate()]);
    store.senderByTenant.set('t1', 'wa-1');

    const summary = await run(store);

    assert.equal(summary.tenantsChecked, 1);
    assert.equal(summary.candidatesScanned, 1);
    assert.equal(summary.created, 1);
    assert.equal(summary.sent, 1);
    assert.equal(summary.skipped.optedOut, 0);
    assert.equal(summary.skipped.cooldown, 0);

    // One queued operator job with the dormant copy, addressed to the customer.
    assert.equal(store.queued.length, 1);
    assert.equal(store.queued[0].to, '27820000001');
    assert.equal(store.queued[0].waAccountId, 'wa-1');
    assert.equal(store.queued[0].tenantId, 't1');
    assert.match(store.queued[0].text, /we've missed you at Flavourly!/);
    assert.match(store.queued[0].text, /10% off/);

    // The campaign row exists, is stamped sent, and was sampled.
    assert.equal(store.campaigns.length, 1);
    assert.equal(store.campaigns[0].sentAt?.getTime(), NOW.getTime());
    assert.equal(store.campaigns[0].segment, 'dormant');
    assert.equal(summary.samples.length, 1);
    assert.equal(summary.samples[0].customerPhone, '27820000001');
  });

  test('uses the at-risk copy for a 120-180 day customer', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate({ lastVisitAt: daysAgo(150), storedSegment: 'at_risk' })]);
    store.senderByTenant.set('t1', 'wa-1');

    const summary = await run(store);

    assert.equal(summary.sent, 1);
    assert.equal(store.campaigns[0].segment, 'at_risk');
    assert.match(store.queued[0].text, /it's been a while!/);
    assert.doesNotMatch(store.queued[0].text, /10% off/);
  });

  test('personalizes with the customer name and preferences', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [
      candidate({ customerName: 'Lerato', preferences: { dietary: ['vegetarian'], occasions: ['birthday'] } }),
    ]);
    store.senderByTenant.set('t1', 'wa-1');

    await run(store);

    assert.match(store.queued[0].text, /Hi Lerato/);
    assert.match(store.queued[0].text, /vegetarian dishes/);
    assert.match(store.queued[0].text, /Your birthday is coming up/);
  });
});

describe('reactivation cron — anti-spam and compliance skips', () => {
  test('skips customers who received a campaign in the last 90 days', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate()]);
    store.senderByTenant.set('t1', 'wa-1');
    seedCampaign(store, { sentAt: daysAgo(30), createdAt: daysAgo(30) }); // dispatched a month ago

    const summary = await run(store);

    assert.equal(summary.skipped.cooldown, 1);
    assert.equal(summary.created, 0);
    assert.equal(summary.sent, 0);
    assert.equal(store.queued.length, 0);
    assert.equal(store.campaigns.length, 1, 'no duplicate campaign row');
  });

  test('campaigns again once the 90-day cooldown has lapsed', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate()]);
    store.senderByTenant.set('t1', 'wa-1');
    seedCampaign(store, { sentAt: daysAgo(91), createdAt: daysAgo(91), responded: true });

    const summary = await run(store);

    assert.equal(summary.skipped.cooldown, 0);
    assert.equal(summary.created, 1);
    assert.equal(summary.sent, 1);
    assert.equal(store.campaigns.length, 2);
  });

  test('never messages opted-out contacts (POPIA)', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate({ blocklisted: true }), candidate()]);
    store.senderByTenant.set('t1', 'wa-1');

    const summary = await run(store);

    assert.equal(summary.skipped.optedOut, 1);
    assert.equal(summary.sent, 1);
    assert.equal(store.queued.length, 1);
    assert.equal(store.queued[0].to, '27820000001');
  });

  test('skips tenants with AI disabled or in manual takeover mode', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant({ id: 't-off', aiEnabled: false }), tenant({ id: 't-manual', manualMode: true })];
    store.candidatesByTenant.set('t-off', [candidate({ tenantId: 't-off' })]);
    store.candidatesByTenant.set('t-manual', [candidate({ tenantId: 't-manual' })]);
    store.senderByTenant.set('t-off', 'wa-1');
    store.senderByTenant.set('t-manual', 'wa-1');

    const summary = await run(store);

    assert.equal(summary.skipped.tenantDisabled, 2);
    assert.equal(summary.candidatesScanned, 0, 'disabled tenants are skipped before candidate fetches');
    assert.equal(store.queued.length, 0);
  });

  test('skips stale segments when the fresh visit date says the customer returned', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate({ lastVisitAt: daysAgo(10) })]); // label dormant, visit 10d ago
    store.senderByTenant.set('t1', 'wa-1');

    const summary = await run(store);

    assert.equal(summary.skipped.notEligible, 1);
    assert.equal(summary.sent, 0);
    assert.equal(store.queued.length, 0);
  });

  test('skips everyone when the tenant has no connected WhatsApp account', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate(), candidate({ customerPhone: '27820000002' })]);

    const summary = await run(store);

    assert.equal(summary.skipped.noSender, 2);
    assert.equal(summary.sent, 0);
    assert.equal(store.queued.length, 0);
    assert.equal(store.campaigns.length, 0, 'no campaign rows created without a sender');
  });

  test('refuses candidates returned for the wrong tenant (isolation guard)', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate({ tenantId: 't2', customerPhone: '27829999999' })]);
    store.senderByTenant.set('t1', 'wa-1');

    const summary = await run(store);

    assert.equal(summary.skipped.failed, 1);
    assert.equal(summary.sent, 0);
    assert.equal(store.queued.length, 0);
  });

  test('caps messages per run with the limit option', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [
      candidate({ customerPhone: '27820000001' }),
      candidate({ customerPhone: '27820000002' }),
      candidate({ customerPhone: '27820000003' }),
    ]);
    store.senderByTenant.set('t1', 'wa-1');

    const summary = await run(store, { limit: 2 });

    assert.equal(summary.sent, 2);
    assert.equal(store.queued.length, 2);
  });
});

describe('reactivation cron — failure recovery', () => {
  test('resumes an undispatched pending campaign instead of duplicating it', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate()]);
    store.senderByTenant.set('t1', 'wa-1');
    // Yesterday's run created the row but died before queueing it.
    seedCampaign(store, { sentAt: null, createdAt: daysAgo(1), messageText: 'Hi Thabo, we missed you yesterday.' });

    const summary = await run(store);

    assert.equal(summary.created, 0);
    assert.equal(summary.resumed, 1);
    assert.equal(summary.sent, 1);
    assert.equal(store.campaigns.length, 1, 'the pending row was reused, not duplicated');
    assert.equal(store.queued.length, 1);
    assert.equal(store.queued[0].text, 'Hi Thabo, we missed you yesterday.');
    assert.equal(store.campaigns[0].sentAt?.getTime(), NOW.getTime());
  });

  test('a dispatch failure leaves the row pending for the next run to resume', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate()]);
    store.senderByTenant.set('t1', 'wa-1');
    let failQueue = true;
    const originalQueue = store.queueCampaignMessage.bind(store);
    store.queueCampaignMessage = async (input) => {
      if (failQueue) throw new Error('outbox down');
      return originalQueue(input);
    };

    const failed = await run(store);
    assert.equal(failed.skipped.failed, 1);
    assert.equal(failed.sent, 0);
    assert.equal(store.campaigns.length, 1);
    assert.equal(store.campaigns[0].sentAt, null, 'row stays pending, cooldown not consumed');

    // Next run: the queue is back; the pending row is resumed and sent.
    failQueue = false;
    const recovered = await run(store);
    assert.equal(recovered.resumed, 1);
    assert.equal(recovered.sent, 1);
    assert.equal(store.campaigns.length, 1);
  });
});

describe('reactivation cron — end-to-end attribution loop', () => {
  test('dormant customer → cron sends → customer replies → campaign marked responded', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate()]);
    store.senderByTenant.set('t1', 'wa-1');

    const summary = await run(store);
    assert.equal(summary.sent, 1);
    const campaign = store.campaigns[0];
    assert.equal(campaign.responded, false);

    // The customer texts back two days later ("book a table"), i.e. the
    // inbound webhook path: attribution within the response window.
    const replyAt = new Date(NOW.getTime() + 2 * MS_PER_DAY);
    const attributed = store.attributeResponse('t1', '27820000001', replyAt);
    assert.ok(attributed, 'reply inside the window should be attributed');
    assert.equal(attributed.id, campaign.id);
    assert.equal(store.campaigns[0].responded, true);

    // A second reply must not flip anything new (already responded).
    const again = store.attributeResponse('t1', '27820000001', replyAt);
    assert.equal(again, null);
  });

  test('a reply after the response window is not attributed to the campaign', async () => {
    const store = new MemoryStore();
    store.tenants = [tenant()];
    store.candidatesByTenant.set('t1', [candidate()]);
    store.senderByTenant.set('t1', 'wa-1');

    await run(store);

    const muchLater = new Date(NOW.getTime() + 45 * MS_PER_DAY);
    assert.equal(store.attributeResponse('t1', '27820000001', muchLater), null);
    assert.equal(store.campaigns[0].responded, false);
  });
});
