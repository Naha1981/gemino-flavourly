import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRON = join(HERE, '..', '..', 'app', 'api', 'cron', 'track-competitors', 'route.ts');

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

describe('market tracking cron wiring', () => {
  const route = code(CRON);

  test('route is guarded before any store access', () => {
    assert.match(route, /import\s*\{[^}]*assertCronAuthorized[^}]*\}\s*from\s*'@\/lib\/cron\/auth'/);
    assert.match(route, /assertCronAuthorized\(req\)/);
    assert.match(route, /if\s*\(authError\)\s*return\s*authError;/);

    const handler = from(route, 'export async function GET');
    const guardAt = handler.indexOf('assertCronAuthorized(req)');
    const storeAt = handler.search(/drizzleMarketTrackingStore|runCompetitorTrackingCron/);
    assert.ok(guardAt > -1, 'guard call not found');
    assert.ok(storeAt === -1 || guardAt < storeAt, 'guard must precede store usage');
  });

  test('route honours the platform kill-switch before scraping anything', () => {
    assert.match(route, /masterAiSwitch === false/);
    const handler = from(route, 'export async function GET');
    const switchAt = handler.indexOf('masterAiSwitch === false');
    const runAt = handler.indexOf('runCompetitorTrackingCron(');
    assert.ok(switchAt > -1 && runAt > -1);
    assert.ok(switchAt < runAt, 'the kill-switch must be checked before the sweep runs');
  });

  test('the sweep is bounded so it cannot run off the function timeout', () => {
    assert.match(route, /limit:\s*COMPETITORS_PER_RUN/);
    assert.match(route, /export const maxDuration = 60/);
  });

  test('the same sweep refreshes market opportunities from stored data', () => {
    assert.match(route, /refreshOpportunitiesForTrackedTenants\(\)/);
    const handler = from(route, 'export async function GET');
    const trackAt = handler.indexOf('runCompetitorTrackingCron(');
    const opportunitiesAt = handler.indexOf('refreshOpportunitiesForTrackedTenants(');
    assert.ok(trackAt > -1 && opportunitiesAt > -1);
    assert.ok(trackAt < opportunitiesAt, 'opportunities must be recomputed AFTER the menus are scraped');
  });

  test('route does not read a secret from the query string', () => {
    assert.doesNotMatch(route, /searchParams\.get\(\s*['"](key|secret|token|cron_secret)['"]\s*\)/i);
  });

  test('route runs the framework-free runner with the real store and scanners', () => {
    assert.match(route, /runCompetitorTrackingCron\(\s*drizzleMarketTrackingStore/);
    assert.match(route, /scrapeMenuFn:\s*scrapeMenu/);
    assert.match(route, /detectPromotionsFn:\s*detectPromotions/);
    assert.match(route, /menuSnapshotTextFn:\s*menuSnapshotText/);
    assert.match(route, /itemsFromTextFn:\s*itemsFromText/);
    assert.match(route, /newPromotionsFn:\s*newPromotions/);
  });
});
