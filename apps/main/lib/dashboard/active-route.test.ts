import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * GATE UI-3R / F8 — exactly ONE sidebar item may be active per route.
 *
 * Owner-verified symptoms (S9, S24): on /dashboard/customers/vip-today BOTH
 * "Customers" and "VIP Today" rendered active; on /dashboard/marketing/calendar
 * BOTH "Marketing" and "Calendar" rendered active. Root cause: the old
 * `startsWith` matcher lights up every ancestor of the current path.
 *
 * These tests are written BEFORE the fix (failing-first): the module
 * lib/nav/active-route.ts does not exist yet on the unmodified branch.
 */

describe('F8 — resolveActiveNavHref returns exactly one active item', () => {
  const SIDEBAR = [
    '/dashboard',
    '/dashboard/inbox',
    '/dashboard/customers',
    '/dashboard/customers/vip-today',
    '/dashboard/reputation',
    '/dashboard/market/competitors',
    '/dashboard/marketing',
    '/dashboard/marketing/campaigns',
    '/dashboard/marketing/events',
    '/dashboard/marketing/calendar',
    '/dashboard/analytics',
    '/dashboard/operations/channel-configs',
    '/dashboard/operations/approval-requests',
    '/dashboard/whatsapp',
    '/dashboard/billing',
    '/dashboard/settings',
  ];

  test('S9: on /dashboard/customers/vip-today only VIP Today is active (not Customers)', async () => {
    const { resolveActiveNavHref } = await import('../nav/active-route.ts');
    assert.equal(resolveActiveNavHref('/dashboard/customers/vip-today', SIDEBAR), '/dashboard/customers/vip-today');
  });

  test('S24: on /dashboard/marketing/calendar only Calendar is active (not Marketing)', async () => {
    const { resolveActiveNavHref } = await import('../nav/active-route.ts');
    assert.equal(resolveActiveNavHref('/dashboard/marketing/calendar', SIDEBAR), '/dashboard/marketing/calendar');
  });

  test('on /dashboard/customers only Customers is active (not VIP Today)', async () => {
    const { resolveActiveNavHref } = await import('../nav/active-route.ts');
    assert.equal(resolveActiveNavHref('/dashboard/customers', SIDEBAR), '/dashboard/customers');
  });

  test('on /dashboard/marketing only Marketing is active', async () => {
    const { resolveActiveNavHref } = await import('../nav/active-route.ts');
    assert.equal(resolveActiveNavHref('/dashboard/marketing', SIDEBAR), '/dashboard/marketing');
  });

  test('overview route /dashboard resolves to itself (exact match, not prefix victim)', async () => {
    const { resolveActiveNavHref } = await import('../nav/active-route.ts');
    assert.equal(resolveActiveNavHref('/dashboard', SIDEBAR), '/dashboard');
  });

  test('deeper unseen page /dashboard/customers/reactivation maps to Customers', async () => {
    const { resolveActiveNavHref } = await import('../nav/active-route.ts');
    assert.equal(resolveActiveNavHref('/dashboard/customers/reactivation', SIDEBAR), '/dashboard/customers');
  });

  test('conversation detail /dashboard/inbox/[id] maps to Inbox', async () => {
    const { resolveActiveNavHref } = await import('../nav/active-route.ts');
    assert.equal(resolveActiveNavHref('/dashboard/inbox/12345', SIDEBAR), '/dashboard/inbox');
  });

  test('unknown route resolves to null (nothing active)', async () => {
    const { resolveActiveNavHref } = await import('../nav/active-route.ts');
    assert.equal(resolveActiveNavHref('/dashboard/does-not-exist', SIDEBAR), null);
  });

  test('mobile bottom nav subset also resolves single-active on vip-today', async () => {
    const { resolveActiveNavHref } = await import('../nav/active-route.ts');
    const BOTTOM = ['/dashboard', '/dashboard/inbox', '/dashboard/customers', '/dashboard/marketing', '/dashboard/market/competitors'];
    assert.equal(resolveActiveNavHref('/dashboard/customers/vip-today', BOTTOM), '/dashboard/customers');
  });
});
