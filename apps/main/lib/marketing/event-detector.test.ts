import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectEventOpportunities } from './event-detector.ts';

describe('event detector: pure date logic', () => {
  test('returns opportunities for events within the 30-day window', () => {
    const now = new Date('2026-05-01T12:00:00.000Z');
    const result = detectEventOpportunities('tenant-1', now);
    const names = result.map((r) => r.title);
    assert.ok(names.some((n) => n.includes("Mother's Day")), `missing Mother's Day in ${names.join(', ')}`);
    assert.ok(names.some((n) => n.includes("Worker's Day")), `missing Worker's Day in ${names.join(', ')}`);
  });

  test('skips events outside the window', () => {
    const now = new Date('2026-01-10T12:00:00.000Z');
    const result = detectEventOpportunities('tenant-1', now);
    const names = result.map((r) => r.title);
    assert.ok(!names.some((n) => n.includes("Valentine's Day")), `Valentine's Day should be outside window`);
  });

  test('produces stable keys per tenant and year', () => {
    const now = new Date('2026-05-01T12:00:00.000Z');
    const result = detectEventOpportunities('tenant-1', now);
    const keys = result.map((r) => r.key);
    assert.ok(keys.every((k) => k.startsWith('event:')), 'key should start with event:');
    assert.ok(keys.every((k) => k.endsWith(':2026')), 'key should end with year');
    assert.equal(new Set(keys).size, keys.length, 'keys must be unique');
  });

  test('sets confidence to 1 for all detected events', () => {
    const now = new Date('2026-05-01T12:00:00.000Z');
    const result = detectEventOpportunities('tenant-1', now);
    assert.ok(result.length > 0, 'expected at least one event');
    assert.ok(result.every((r) => r.confidence === 1), 'confidence should be 1');
  });
});
