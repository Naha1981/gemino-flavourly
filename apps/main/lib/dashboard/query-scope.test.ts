import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * GATE UI-3R / F2 — LIVE views read ONLY real rows.
 *
 * Root cause of S2/S13 (R500 / "25 000" with zero connected channels): the
 * seed dataset writes rows whose ids start with "deadbeef-" (see
 * lib/demo/deadbeef.ts) — including six demo "platform tenants" (Marble,
 * Gemelli, SUD, AURUM, Saint, Zioux). Every live query read them as if they
 * were real. This module supplies the SQL predicate live queries must add.
 * Failing-first: it does not exist on the unmodified branch.
 */

describe('F2 — isDemoTenantId', () => {
  test('deadbeef tenant ids are recognised as demo (e.g. Marble from the seed)', async () => {
    const { isDemoTenantId } = await import('../demo/query-scope.ts');
    assert.equal(isDemoTenantId('deadbeef-0100-4000-8000-000000000001'), true);
  });

  test('ordinary uuids are NOT demo tenants', async () => {
    const { isDemoTenantId } = await import('../demo/query-scope.ts');
    assert.equal(isDemoTenantId('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'), false);
    assert.equal(isDemoTenantId(''), false);
    assert.equal(isDemoTenantId(null), false);
    assert.equal(isDemoTenantId(undefined), false);
  });
});

describe('F2 — liveRowsOnly predicate shape', () => {
  test("builds a NOT LIKE 'deadbeef-%' predicate for a column", async () => {
    const { liveRowsOnly } = await import('../demo/query-scope.ts');
    const fakeColumn = { name: 'id' } as never;
    const pred = liveRowsOnly(fakeColumn);
    assert.ok(pred, 'predicate must be truthy');
    // Drizzle SQL fragments expose the query chunks; assert the LIKE marker.
    const text = JSON.stringify(pred);
    assert.match(text, /deadbeef-%/, 'must match the deadbeef prefix');
    assert.match(text, /NOT LIKE/i, 'must be a NOT LIKE predicate');
  });

  test('demo mode disables the predicate (includeDemoRows=true returns undefined)', async () => {
    const { liveRowsOnly } = await import('../demo/query-scope.ts');
    const fakeColumn = { name: 'id' } as never;
    assert.equal(liveRowsOnly(fakeColumn, { includeDemoRows: true }), undefined);
  });
});
