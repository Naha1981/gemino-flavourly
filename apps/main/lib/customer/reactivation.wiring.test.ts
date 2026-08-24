import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Gate #9 wiring guards.
 *
 * The unit tests in reactivation.test.ts / reactivation-cron.test.ts prove
 * the decision logic. They prove nothing about whether the schema, routes,
 * migrations and UI are actually wired to it — a route that forgot the
 * tenant scope, or a store mutation without its guard condition, would
 * still pass. These source-level checks fail loudly when the wiring drifts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const STORE = join(HERE, 'reactivation-store.ts');
const LOGIC = join(HERE, 'reactivation.ts');
const RUNNER = join(HERE, 'reactivation-cron.ts');
const RESPONSE = join(HERE, 'reactivation-response.ts');
const CRON = join(APP, 'api', 'cron', 'reactivation-campaigns', 'route.ts');
const WEBHOOK = join(APP, 'api', 'webhooks', 'whatsapp', 'route.ts');
const API = join(APP, 'api', 'customer', 'reactivation', 'route.ts');
const STATS_API = join(APP, 'api', 'customer', 'reactivation', 'stats', 'route.ts');
const PAGE = join(APP, 'dashboard', 'customers', 'reactivation', 'page.tsx');
const SEND_FORM = join(APP, 'dashboard', 'customers', 'reactivation', 'send-campaign-client.tsx');
const LAYOUT = join(APP, 'dashboard', 'layout.tsx');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0007_reactivation_campaigns.sql');
const JOURNAL = join(HERE, '..', '..', 'drizzle', 'meta', '_journal.json');
const MIGRATE_ROUTE = join(APP, 'api', 'migrate', 'route.ts');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Strip comments so prose about a pattern cannot be mistaken for live code. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('reactivation schema wiring', () => {
  test('schema declares the campaign table with all gate columns', () => {
    const src = code(SCHEMA);
    assert.match(src, /export const reactivationCampaigns = pgTable\(\s*'reactivation_campaigns'/);
    const body = from(src, "pgTable(\n  'reactivation_campaigns'");
    assert.match(body, /uuid\('id'\)\.primaryKey\(\)\.defaultRandom\(\)/);
    assert.match(body, /uuid\('tenant_id'\)[\s\S]*?references\(\(\) => tenants\.id/);
    assert.match(body, /text\('customer_phone'\)\.notNull\(\)/);
    assert.match(body, /text\('segment',\s*\{\s*enum:\s*\['dormant',\s*'at_risk'\]\s*\}\)\.notNull\(\)/);
    assert.match(body, /text\('message_text'\)\.notNull\(\)/);
    assert.match(body, /timestamp\('sent_at'\)/);
    assert.match(body, /boolean\('responded'\)\.default\(false\)\.notNull\(\)/);
    assert.match(body, /timestamp\('created_at'\)\.defaultNow\(\)\.notNull\(\)/);
  });

  test('schema has the three gate indexes, including the partial pending index', () => {
    const src = code(SCHEMA);
    assert.match(src, /index\('reactivation_campaigns_tenant_idx'\)\.on\(table\.tenantId\)/);
    assert.match(src, /index\('reactivation_campaigns_phone_idx'\)\.on\(table\.customerPhone\)/);
    assert.match(
      src,
      /index\('reactivation_campaigns_pending_idx'\)[\s\S]*?on\(table\.tenantId,\s*table\.sentAt\)[\s\S]*?where\(sql`[^`]*sentAt[\s\S]*?IS NULL[^`]*`\)/
    );
  });

  test('0007 migration creates the table and all three indexes', () => {
    const src = source(MIGRATION);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "reactivation_campaigns"/);
    assert.match(src, /"tenant_id" uuid NOT NULL REFERENCES "tenants"\("id"\) ON DELETE CASCADE/);
    assert.match(src, /"customer_phone" text NOT NULL/);
    assert.match(src, /"segment" text NOT NULL/);
    assert.match(src, /"message_text" text NOT NULL/);
    assert.match(src, /"sent_at" timestamp/);
    assert.match(src, /"responded" boolean DEFAULT false NOT NULL/);
    assert.match(src, /"created_at" timestamp DEFAULT NOW\(\) NOT NULL/);
    assert.match(src, /reactivation_campaigns_tenant_idx/);
    assert.match(src, /reactivation_campaigns_phone_idx/);
    assert.match(src, /reactivation_campaigns_pending_idx[\s\S]*?WHERE "sent_at" IS NULL/);
  });

  test('migration journal and /api/migrate include the Gate #9 DDL', () => {
    const journal = JSON.parse(source(JOURNAL));
    assert.ok(
      journal.entries.some((entry: { tag: string }) => entry.tag === '0007_reactivation_campaigns')
    );
    const route = code(MIGRATE_ROUTE);
    assert.match(route, /CREATE TABLE IF NOT EXISTS reactivation_campaigns/);
    assert.match(route, /reactivation_campaigns_tenant_idx/);
    assert.match(route, /reactivation_campaigns_phone_idx/);
    assert.match(route, /reactivation_campaigns_pending_idx[\s\S]*?WHERE sent_at IS NULL/);
  });
});

describe('reactivation seams stay framework-free', () => {
  for (const file of [LOGIC, RUNNER, RESPONSE]) {
    test(`${file.split('/').pop()} imports no framework or database module`, () => {
      const src = code(file);
      assert.doesNotMatch(src, /from\s+['"](?:@\/lib\/db|drizzle-orm|next\/)/);
    });
  }
});

describe('reactivation store guards (tenant scoping + mutation checks)', () => {
  test('createPendingCampaign inserts without a sent_at value', () => {
    const body = from(code(STORE), 'export async function createPendingCampaign');
    const end = body.indexOf('\nexport ');
    const scoped = end > -1 ? body.slice(0, end) : body;
    assert.match(scoped, /\.insert\(reactivationCampaigns\)/);
    assert.match(scoped, /tenantId,/);
    assert.match(scoped, /customerPhone,/);
    assert.match(scoped, /segment,/);
    assert.match(scoped, /messageText,/);
    assert.doesNotMatch(scoped, /sentAt/);
  });

  test('markSent is conditional: only rows still pending are stamped', () => {
    const body = from(code(STORE), 'export async function markSent');
    const end = body.indexOf('\nexport ');
    const scoped = end > -1 ? body.slice(0, end) : body;
    assert.match(scoped, /\.set\(\{\s*sentAt\s*\}\)/);
    assert.match(scoped, /eq\(reactivationCampaigns\.id,\s*campaignId\)/);
    assert.match(scoped, /isNull\(reactivationCampaigns\.sentAt\)/);
  });

  test('markResponded is conditional and single-shot', () => {
    const body = from(code(STORE), 'export async function markResponded');
    const end = body.indexOf('\nexport ');
    const scoped = end > -1 ? body.slice(0, end) : body;
    assert.match(scoped, /\.set\(\{\s*responded:\s*true\s*\}\)/);
    assert.match(scoped, /eq\(reactivationCampaigns\.id,\s*campaignId\)/);
    assert.match(scoped, /eq\(reactivationCampaigns\.responded,\s*false\)/);
  });

  test('reads are tenant-scoped (pending list, history, stats, list, counts)', () => {
    const src = code(STORE);
    assert.match(from(src, 'export async function getPendingCampaigns'), /eq\(reactivationCampaigns\.tenantId,\s*tenantId\)/);
    const history = from(src, 'export async function getCampaignHistory');
    assert.match(history, /eq\(reactivationCampaigns\.tenantId,\s*tenantId\)/);
    assert.match(history, /eq\(reactivationCampaigns\.customerPhone,\s*customerPhone\)/);
    assert.match(from(src, 'export async function listCampaigns'), /eq\(reactivationCampaigns\.tenantId,\s*tenantId\)/);
    assert.match(from(src, 'export async function countCampaigns'), /eq\(reactivationCampaigns\.tenantId,\s*tenantId\)/);
    assert.match(from(src, 'export async function campaignStats'), /eq\(reactivationCampaigns\.tenantId,\s*tenantId\)/);
  });

  test('candidate query enforces POPIA opt-out and tenant flags in SQL', () => {
    const body = from(code(STORE), 'export async function fetchReactivationCandidates');
    const end = body.indexOf('\nexport ');
    const scoped = end > -1 ? body.slice(0, end) : body;
    assert.match(scoped, /eq\(customerProfiles\.tenantId,\s*tenantId\)/);
    assert.match(scoped, /eq\(tenants\.aiEnabled,\s*true\)/);
    assert.match(scoped, /eq\(tenants\.manualMode,\s*false\)/);
    assert.match(scoped, /or\(isNull\(contacts\.id\),\s*eq\(contacts\.blocklisted,\s*false\)\)/);
    assert.match(scoped, /inArray\(customerProfiles\.segment,\s*\['dormant',\s*'at_risk'\]\)/);
    assert.match(scoped, /lt\(customerProfiles\.lastVisitAt,\s*dormantCutoff\)/);
  });

  test('cooldown measures COALESCE(sent_at, created_at) so pending rows count', () => {
    const body = from(code(STORE), 'export async function fetchRecentCampaignRecipients');
    const end = body.indexOf('\nexport ');
    const scoped = end > -1 ? body.slice(0, end) : body;
    assert.match(scoped, /eq\(reactivationCampaigns\.tenantId,\s*tenantId\)/);
    assert.match(scoped, /coalesce\(\$\{reactivationCampaigns\.sentAt\},\s*\$\{reactivationCampaigns\.createdAt\}\)/);
  });

  test('webhook reply path pairs tenant with phone before touching a campaign', () => {
    const body = from(code(STORE), 'export async function markRespondedForReply');
    const end = body.indexOf('\nexport ');
    const scoped = end > -1 ? body.slice(0, end) : body;
    assert.match(scoped, /eq\(reactivationCampaigns\.tenantId,\s*tenantId\)/);
    assert.match(scoped, /eq\(reactivationCampaigns\.customerPhone,\s*customerPhone\)/);
    assert.match(scoped, /isNotNull\(reactivationCampaigns\.sentAt\)/);
    assert.match(scoped, /recordReactivationResponse/);
  });

  test('dispatch goes through the operator client with tenant verification', () => {
    const body = from(code(STORE), 'export async function dispatchWhatsApp');
    const end = body.indexOf('\nexport ');
    const scoped = end > -1 ? body.slice(0, end) : body;
    assert.match(scoped, /operatorClient\.sendMessage\(input\.tenantId,/);
  });

  test('cron adapter injects every store seam', () => {
    const body = from(code(STORE), 'export const drizzleReactivationStore');
    for (const seam of [
      'findTenantIds',
      'fetchReactivationCandidates',
      'fetchRecentCampaignRecipients',
      'findWhatsAppAccount',
      'createPendingCampaign',
      'markSent',
      'dispatchWhatsApp',
    ]) {
      assert.match(body, new RegExp(seam));
    }
  });
});

describe('reactivation cron route wiring', () => {
  test('cron route authenticates before any database access', () => {
    const src = code(CRON);
    assert.match(src, /import\s*\{[^}]*assertCronAuthorized[^}]*\}\s*from\s*'@\/lib\/cron\/auth'/);
    const guardAt = src.indexOf('assertCronAuthorized(req)');
    const dbAt = src.search(/\bdb\s*\./);
    assert.ok(guardAt > -1, 'guard call not found');
    assert.ok(dbAt === -1 || guardAt < dbAt, 'database is accessed before the authorization check');
  });

  test('cron route respects the global master AI kill-switch', () => {
    const src = code(CRON);
    assert.match(src, /masterAiSwitch === false/);
    assert.match(src, /master_ai_switch_off/);
  });

  test('cron route runs the injected store, not ad-hoc queries', () => {
    const src = code(CRON);
    assert.match(src, /runReactivationCampaignCron\(drizzleReactivationStore/);
    // The schedule lives in the route's comments (cron-job.org is managed
    // outside the repo), so assert it against the raw source.
    assert.match(source(CRON), /daily/i);
  });
});

describe('webhook response-handling wiring', () => {
  test('webhook imports and calls markRespondedForReply', () => {
    const src = code(WEBHOOK);
    assert.match(src, /import\s*\{[^}]*markRespondedForReply[^}]*\}\s*from\s*'@\/lib\/customer\/reactivation-store'/);
    assert.match(src, /markRespondedForReply\(tenantId,\s*fromPhone,\s*textContent\)/);
  });

  test('the call is guarded so a missing table cannot 500 the webhook', () => {
    const body = from(code(WEBHOOK), 'export async function POST');
    const at = body.indexOf('markRespondedForReply(tenantId');
    const before = body.slice(Math.max(0, at - 200), at);
    assert.ok(at > -1);
    assert.match(before, /try\s*\{/);
    assert.match(body.slice(at), /catch/);
  });

  test('responses are recorded before manual takeover or AI suppression returns', () => {
    const body = from(code(WEBHOOK), 'export async function POST');
    const respondAt = body.indexOf('markRespondedForReply(tenantId');
    const takeoverAt = body.indexOf('conversation.manualTakeover');
    assert.ok(respondAt > -1 && takeoverAt > -1);
    assert.ok(respondAt < takeoverAt, 'campaign response must be recorded even for staff-handled replies');
  });
});

describe('reactivation API wiring', () => {
  test('list API is tenant-scoped and paginated', () => {
    const src = code(API);
    assert.match(src, /getOrCreateTenant/);
    assert.match(src, /status:\s*401/);
    assert.match(src, /listCampaigns\(tenant\.id,\s*limit,\s*offset\)/);
    assert.match(src, /countCampaigns\(tenant\.id\)/);
    assert.match(src, /serializeReactivationCampaign/);
  });

  test('manual send API enforces POPIA and the cooldown', () => {
    const src = code(API);
    assert.match(src, /contacts\.blocklisted/);
    assert.match(src, /status:\s*403/);
    assert.match(src, /REACTIVATION_COOLDOWN_DAYS/);
    assert.match(src, /status:\s*409/);
    assert.match(src, /buildReactivationMessage/);
    assert.match(src, /createPendingCampaign\(tenant\.id,\s*customerPhone,\s*segment,\s*message\.text\)/);
    assert.match(src, /findWhatsAppAccount\(tenant\.id\)/);
    assert.match(src, /markSent\(campaign\.id,\s*now\)/);
  });

  test('segment filter is validated against the two reactivation segments', () => {
    const src = code(API);
    assert.match(src, /isReactivationSegment\(body\.segment\)/);
    assert.match(src, /resolveReactivationTarget\(profile\)/);
  });

  test('stats API requires the signed-in tenant', () => {
    const src = code(STATS_API);
    assert.match(src, /getOrCreateTenant/);
    assert.match(src, /campaignStats\(tenant\.id\)/);
    assert.match(src, /status:\s*401/);
  });
});

describe('reactivation dashboard wiring', () => {
  test('page shows the response-rate line, stats and campaign table', () => {
    const src = source(PAGE);
    assert.match(src, /formatResponseRate\(stats\.sent,\s*stats\.responded\)/);
    assert.match(src, /SendCampaignForm/);
    assert.match(src, /campaignStats\(tenant\.id\)/);
    assert.match(src, /listCampaigns\(tenant\.id,\s*200,\s*0\)/);
    for (const header of ['Customer', 'Segment', 'Message', 'Sent', 'Responded']) {
      assert.match(src, new RegExp(header));
    }
    assert.match(src, /campaign\.messageText/);
    assert.match(src, /campaign\.responded/);
  });

  test('manual send form posts to the reactivation API', () => {
    const src = source(SEND_FORM);
    assert.match(src, /'use client'/);
    assert.match(src, /fetch\('\/api\/customer\/reactivation',\s*\{\s*method:\s*'POST'/);
    assert.match(src, /router\.refresh\(\)/);
  });

  test('dashboard navigation links the reactivation page', () => {
    const src = source(LAYOUT);
    assert.match(src, /\/dashboard\/customers\/reactivation/);
  });
});
