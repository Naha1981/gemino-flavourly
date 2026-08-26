import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildVipDailyBrief, type VipAlertSummaryItem } from './vip-daily-brief.ts';

const NOW = new Date('2026-08-26T07:00:00.000Z');

function item(partial: Partial<VipAlertSummaryItem>): VipAlertSummaryItem {
  return {
    customerName: 'Thandi',
    customerPhone: '+27111111111',
    totalVisits: 5,
    totalSpendCents: 300_00,
    servedAt: null,
    ...partial,
  };
}

describe('VIP daily brief — empty day', () => {
  test('reports no VIPs with a time-stamped line, count 0', () => {
    const brief = buildVipDailyBrief({ tenantName: 'Marble', today: [], now: NOW });
    assert.equal(brief.count, 0);
    assert.match(brief.line, /no VIP walk-ins/);
    assert.match(brief.line, /Marble/);
  });
});

describe('VIP daily brief — with VIPs', () => {
  test('summarises up to 3 names and a suggested action for the top VIP', () => {
    const today = [
      item({ customerName: 'Thandi', totalSpendCents: 600_00, totalVisits: 12 }),
      item({ customerName: 'Sipho', totalVisits: 9 }),
      item({ customerName: 'Annelie', totalVisits: 3 }),
      item({ customerName: 'Lerato', totalVisits: 2 }),
    ];
    const brief = buildVipDailyBrief({ tenantName: 'Marble', today, now: NOW });
    assert.equal(brief.count, 4);
    assert.match(brief.line, /Thandi, Sipho, Annelie/);
    assert.match(brief.line, /and 1 more/);
    // Top VIP: high spend -> tasting menu suggestion.
    assert.match(brief.line, /tasting menu/);
  });

  test('uses a name fallback when a VIP has no recorded name', () => {
    const brief = buildVipDailyBrief({
      tenantName: null,
      today: [item({ customerName: null })],
      now: NOW,
    });
    assert.match(brief.line, /A VIP/);
    assert.match(brief.line, /the top VIP/);
  });

  test('suggests a low-format action for a light VIP', () => {
    const brief = buildVipDailyBrief({
      tenantName: 'Marble',
      today: [item({ totalVisits: 2, totalSpendCents: 50_00 })],
      now: NOW,
    });
    assert.match(brief.line, /Warm welcome/);
  });
});
