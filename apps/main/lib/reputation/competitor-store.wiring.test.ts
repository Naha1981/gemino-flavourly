import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'competitor-store.ts');
const CRON = join(HERE, '..', '..', 'app', 'api', 'cron', 'fetch-competitor-ratings', 'route.ts');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('competitor store wiring (Gate #14 mutation + isolation checks)', () => {
  const src = code(STORE);

  test('every competitor read/write is tenant-scoped (except the platform cron)', () => {
    for (const fn of [
      'export async function listCompetitors',
      'export async function getCompetitor',
      'export async function deleteCompetitor',
      'export async function getRatingHistory',
    ]) {
      const body = from(src, fn);
      assert.match(body, /eq\(competitors\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
    // detectRatingDrop scopes via getRatingHistory (which pins tenant+row).
    const dropBody = from(src, 'export async function detectRatingDrop');
    assert.match(dropBody, /getRatingHistory\(tenantId,\s*competitorId/);
    // Alert reads query the message stream, so their tenant scope is messages.
    const alertsBody = from(src, 'export async function recentCompetitorAlerts');
    assert.match(alertsBody, /eq\(messages\.tenantId,\s*tenantId\)/);
  });

  test('findAllCompetitors is deliberately platform-wide and labelled cron-only', () => {
    const body = from(src, 'export async function findAllCompetitors').split('\n\nexport ')[0];
    assert.doesNotMatch(body, /tenantId/);
  });

  test('updateRating writes BOTH the competitor row and a history reading', () => {
    const body = from(src, 'export async function updateRating');
    assert.match(body, /update\(competitors\)/);
    assert.match(body, /lastCheckAt/);
    assert.match(body, /insert\(competitorRatingHistory\)/);
    assert.match(body, /recordedAt:\s*at/);
  });

  test('system alerts are direction=system and never dispatched', () => {
    const body = from(src, 'export async function insertSystemAlert');
    assert.match(body, /insert\(messages\)/);
    assert.match(body, /direction:\s*'system'/);
    assert.match(body, /messageType:\s*'system'/);
    // and they must never enter the outbox
    assert.doesNotMatch(body, /jobs/);
  });

  test('the system-alerts contact is a sentinel that cannot collide with a real JID', () => {
    assert.equal((src.match(/SYSTEM_ALERTS_PHONE = '([^']+)'/) || [])[1], 'system-alerts');
  });

  test('platform metrics are unscoped by design (super admin KPIs)', () => {
    const countAll = from(src, 'export async function countAllCompetitors').split('\n\nexport ')[0];
    assert.match(countAll, /from\(competitors\)/);
    assert.doesNotMatch(countAll, /tenantId/);
    const alertsWeek = from(src, 'export async function countRatingDropAlertsThisWeek').split('\n\nexport ')[0];
    assert.match(alertsWeek, /gte\(messages\.createdAt,\s*since\)/);
  });

  test('rating-drop alerts are identifiable by prefix for the weekly metric', () => {
    assert.match(src, /COMPETITOR_ALERT_PREFIX = '⚠️ Competitor Alert:'/);
  });
});

describe('competitor ratings cron wiring', () => {
  const src = code(CRON);

  test('route is guarded and honours the kill-switch before any store access', () => {
    assert.match(src, /assertCronAuthorized\(req\)/);
    // Scoped to the handler body: the store import naturally sits above it.
    const handler = from(src, 'export async function GET');
    const guardAt = handler.indexOf('assertCronAuthorized(req)');
    const dbAt = handler.search(/db\.query|drizzleCompetitorRatingsStore/);
    assert.ok(guardAt > -1, 'guard call not found');
    assert.ok(dbAt === -1 || guardAt < dbAt, 'guard must precede store/db usage');
    assert.match(src, /masterAiSwitch === false/);
  });

  test('route runs the framework-free runner with the real store + client', () => {
    assert.match(src, /runCompetitorRatingsCron\(drizzleCompetitorRatingsStore/);
    assert.match(src, /fetchPlaceRatingFn:\s*fetchPlaceRating/);
  });
});
