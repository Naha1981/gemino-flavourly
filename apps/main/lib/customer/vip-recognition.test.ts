import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectVipAlert,
  extractVipPreferences,
  formatRandCents,
  formatVisitDate,
  generateVipAlertMessage,
  generateVipSystemMessage,
  processFirstMessageVip,
  vipDisplayName,
  type VipProfileLike,
  type VipRecognitionStore,
  type VipAlertData,
} from './vip-recognition.ts';

function vipProfile(overrides: Partial<VipProfileLike> = {}): VipProfileLike {
  return {
    customerName: 'Thabo',
    customerPhone: '27820000001',
    totalVisits: 12,
    totalSpendCents: 300_000,
    lastVisitAt: new Date('2026-08-01T00:00:00.000Z'),
    preferences: {
      dietary: ['vegetarian', 'vegan'],
      occasions: ['birthday'],
      favorites: ['butter chicken'],
    },
    segment: 'vip',
    ...overrides,
  };
}

function alert(overrides: Partial<VipAlertData> = {}): VipAlertData {
  return {
    customerPhone: '27820000001',
    customerName: 'Thabo',
    totalVisits: 12,
    totalSpendCents: 300_000,
    lastVisitAt: new Date('2026-08-01T00:00:00.000Z'),
    preferences: {
      dietary: ['vegetarian', 'vegan'],
      occasions: ['birthday'],
      favorites: ['butter chicken'],
    },
    ...overrides,
  };
}

/** An in-memory store for the framework-free integration tests. */
class MemoryVipStore implements VipRecognitionStore {
  profilesByTenant = new Map<string, Map<string, VipProfileLike>>();
  alerts: Array<{ tenantId: string; alert: VipAlertData }> = [];
  systemMessages: Array<{ tenantId: string; conversationId: string; content: string }> = [];
  private seq = 0;

  seed(tenantId: string, profile: VipProfileLike) {
    const byPhone = this.profilesByTenant.get(tenantId) ?? new Map<string, VipProfileLike>();
    byPhone.set(profile.customerPhone ?? profile.customer_phone ?? '', profile);
    this.profilesByTenant.set(tenantId, byPhone);
  }

  async findProfileByPhone(tenantId: string, customerPhone: string) {
    return this.profilesByTenant.get(tenantId)?.get(customerPhone) ?? null;
  }

  async saveVipAlert(input: { tenantId: string; alert: VipAlertData }) {
    this.alerts.push({ tenantId: input.tenantId, alert: input.alert });
    return { id: `alert-${++this.seq}` };
  }

  async saveSystemMessage(input: { tenantId: string; conversationId: string; content: string }) {
    this.systemMessages.push(input);
    return { id: `msg-${++this.seq}` };
  }
}

describe('unit: VIP detection', () => {
  test('correctly identifies a VIP customer (segment="vip")', () => {
    const processed = detectVipAlert(vipProfile());
    assert.ok(processed, 'a VIP profile must be detected');
    assert.equal(processed.alert.customerName, 'Thabo');
    assert.equal(processed.alert.totalVisits, 12);
    assert.equal(processed.alert.totalSpendCents, 300_000);
    assert.ok(processed.message.includes('VIP Alert'));
  });

  test('returns null for a non-VIP customer', () => {
    for (const segment of ['regular', 'at_risk', 'dormant', 'new', null, undefined]) {
      assert.equal(detectVipAlert(vipProfile({ segment })), null, `expected ${segment} to be non-VIP`);
    }
  });

  test('returns null when no profile exists (empty object / no phone)', () => {
    assert.equal(detectVipAlert({}), null);
    assert.equal(detectVipAlert({ segment: 'vip', customer_name: 'No phone' }), null);
  });

  test('accepts snake_case row shapes from raw Postgres', () => {
    const processed = detectVipAlert({
      customer_name: 'Anna',
      customer_phone: '27820000002',
      total_visits: 12,
      total_spend_cents: 250_000,
      last_visit_at: new Date('2026-08-10T00:00:00.000Z').toISOString(),
      segment: 'vip',
      preferences: { favorites: ['gnocchi'] },
    });
    assert.ok(processed);
    assert.equal(processed.alert.customerName, 'Anna');
    assert.equal(processed.alert.totalVisits, 12);
    assert.ok(processed.message.includes('Anna'));
  });
});

describe('unit: VIP alert copy', () => {
  test('generates the exact staff alert message format', () => {
    const message = generateVipAlertMessage(alert());
    assert.equal(
      message,
      '🌟 VIP Alert: Thabo just walked in! 12 visits, R3000 total spend. Preferences: vegetarian, vegan. Favorite dish: butter chicken. Last visited: 2026-08-01.'
    );
  });

  test('system message uses the short sent-format', () => {
    assert.equal(
      generateVipSystemMessage(alert()),
      '🌟 VIP Alert sent: Thabo (12 visits, R3000 spend)'
    );
  });

  test('falls back to "Guest" without a name and to "none" without preferences', () => {
    const noName = generateVipAlertMessage(alert({ customerName: null, preferences: {} }));
    assert.ok(noName.includes('Guest just walked in'));
    assert.ok(noName.includes('Preferences: none'));
    assert.ok(noName.includes('Favorite dish: none'));
    assert.equal(vipDisplayName(alert({ customerName: '   ' })), 'Guest');
  });

  test('formats cents and visit dates consistently', () => {
    assert.equal(formatRandCents(300_000), '3000');
    assert.equal(formatRandCents(250_150), '2501.50');
    assert.equal(formatRandCents(0), '0');
    assert.equal(formatVisitDate(new Date('2026-08-01T00:00:00.000Z')), '2026-08-01');
    assert.equal(formatVisitDate(null), 'unknown');
    assert.equal(formatVisitDate('not-a-date'), 'unknown');
  });

  test('extractVipPreferences normalizes and caps the lists', () => {
    assert.deepEqual(
      extractVipPreferences({ dietary: [' Vegetarian ', 'VEGAN', 'halal'], favorites: ['Butter Chicken', 'Pizza'] }),
      { dietary: ['vegetarian', 'vegan', 'halal'], favorite: 'butter chicken' }
    );
    assert.deepEqual(extractVipPreferences(undefined), { dietary: [], favorite: null });
    assert.deepEqual(extractVipPreferences(null), { dietary: [], favorite: null });
    assert.deepEqual(extractVipPreferences('vegetarian'), { dietary: [], favorite: null });
  });
});

describe('integration: first-message VIP flow (in-memory store)', () => {
  test('first message from a VIP creates an alert row AND a system message', async () => {
    const store = new MemoryVipStore();
    store.seed('tenant-a', vipProfile());

    const processed = await processFirstMessageVip(store, {
      tenantId: 'tenant-a',
      customerPhone: '27820000001',
      conversationId: 'conv-1',
    });

    assert.ok(processed);
    assert.equal(store.alerts.length, 1);
    assert.equal(store.alerts[0].tenantId, 'tenant-a');
    assert.equal(store.alerts[0].alert.customerPhone, '27820000001');
    assert.equal(store.systemMessages.length, 1);
    assert.equal(store.systemMessages[0].conversationId, 'conv-1');
    assert.equal(store.systemMessages[0].content, processed.systemMessage);
    assert.ok(store.systemMessages[0].content.startsWith('🌟 VIP Alert sent:'));
  });

  test('subsequent messages from the same VIP do NOT duplicate (only first conversation fires)', async () => {
    const store = new MemoryVipStore();
    store.seed('tenant-a', vipProfile());

    // A conversation-tracking fake mirrors the webhook gate: VIP recognition
    // only runs when this is the FIRST message of a NEW conversation.
    const seenConversations = new Set<string>();
    async function simulateInbound(conversationId: string) {
      if (seenConversations.has(conversationId)) return null;
      seenConversations.add(conversationId);
      return processFirstMessageVip(store, {
        tenantId: 'tenant-a',
        customerPhone: '27820000001',
        conversationId,
      });
    }

    // First message (new conversation) -> alert.
    const first = await simulateInbound('conv-1');
    assert.ok(first);
    assert.equal(store.alerts.length, 1);

    // Later messages in the SAME conversation -> no new alert.
    assert.equal(await simulateInbound('conv-1'), null);
    assert.equal(store.alerts.length, 1);

    // A genuinely different conversation from a different walk-in -> alert.
    const second = await simulateInbound('conv-2');
    assert.ok(second);
    assert.equal(store.alerts.length, 2);
  });

  test('non-VIP first message returns null and writes nothing', async () => {
    const store = new MemoryVipStore();
    store.seed('tenant-a', vipProfile({ segment: 'regular' }));

    const processed = await processFirstMessageVip(store, {
      tenantId: 'tenant-a',
      customerPhone: '27820000001',
      conversationId: 'conv-1',
    });

    assert.equal(processed, null);
    assert.equal(store.alerts.length, 0);
    assert.equal(store.systemMessages.length, 0);
  });

  test('tenant isolation: the same phone in another tenant is not alerted', async () => {
    const store = new MemoryVipStore();
    store.seed('tenant-a', vipProfile());
    // tenant-b has the SAME phone but it is NOT a VIP profile.
    store.seed('tenant-b', vipProfile({ segment: 'regular', customerPhone: '27820000001' }));

    // tenant-a -> VIP alert.
    assert.ok(
      await processFirstMessageVip(store, {
        tenantId: 'tenant-a',
        customerPhone: '27820000001',
        conversationId: 'conv-a',
      })
    );
    // tenant-b -> no alert (its profile for that phone is non-VIP).
    assert.equal(
      await processFirstMessageVip(store, {
        tenantId: 'tenant-b',
        customerPhone: '27820000001',
        conversationId: 'conv-b',
      }),
      null
    );
    assert.equal(store.alerts.length, 1);
    assert.equal(store.alerts[0].tenantId, 'tenant-a');
  });
});
