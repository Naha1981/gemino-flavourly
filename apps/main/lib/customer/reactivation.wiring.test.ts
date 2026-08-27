import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const LOGIC = join(HERE, 'reactivation.ts');
const RUNNER = join(HERE, 'reactivation-cron.ts');
const STORE = join(HERE, 'reactivation-store.ts');
const CRON = join(APP, 'api', 'cron', 'reactivation-campaigns', 'route.ts');
const WEBHOOK = join(APP, 'api', 'webhooks', 'whatsapp', 'route.ts');
const API = join(APP, 'api', 'customer', 'reactivation', 'route.ts');
const STATS_API = join(APP, 'api', 'customer', 'reactivation', 'stats', 'route.ts');
const PAGE = join(APP, 'dashboard', 'customers', 'reactivation', 'page.tsx');
const CLIENT = join(APP, 'dashboard', 'customers', 'reactivation', 'reactivation-client.tsx');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0007_reactivation_campaigns.sql');
const JOURNAL = join(HERE, '..', '..', 'drizzle', 'meta', '_journal.json');
// The /api/migrate DDL was lifted verbatim out of the route handler into
// lib/db/migrate-ddl.ts so it can be EXECUTED by lib/db/migrate-execute.test.ts.
// These assertions check the same statements, now at their real home.
const MIGRATE_DDL_FILE = join(APP, '..', 'lib', 'db', 'migrate-ddl.ts');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** Everything after the first occurrence of `needle` — scopes a match to a
 * specific function instead of the whole module. */
function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('reactivation schema wiring', () => {
  test('schema defines the campaign table with state columns and tenant FK', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const reactivationCampaigns = pgTable(');
    assert.match(table, /uuid\('tenant_id'\)/);
    assert.match(table, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(table, /text\('customer_phone'\)\.notNull\(\)/);
    assert.match(table, /text\('segment',\s*\{\s*enum:\s*\['dormant',\s*'at_risk'\]\s*\}\)\.notNull\(\)/);
    assert.match(table, /text\('message_text'\)\.notNull\(\)/);
    assert.match(table, /timestamp\('sent_at'\)/);
    assert.match(table, /boolean\('responded'\)\.default\(false\)\.notNull\(\)/);
    assert.match(table, /timestamp\('created_at'\)\.defaultNow\(\)\.notNull\(\)/);
  });

  test('schema declares all three indexes including the partial pending index', () => {
    const table = from(code(SCHEMA), 'export const reactivationCampaigns = pgTable(');
    assert.match(table, /index\('reactivation_campaigns_tenant_idx'\)\.on\(table\.tenantId\)/);
    assert.match(table, /index\('reactivation_campaigns_phone_idx'\)\.on\(table\.customerPhone\)/);
    assert.match(table, /index\('reactivation_campaigns_pending_idx'\)/);
    assert.match(table, /where\(sql`\$\{table\.sentAt\} IS NULL`\)/);
  });

  test('tenant relations expose reactivationCampaigns', () => {
    const src = code(SCHEMA);
    assert.match(src, /reactivationCampaigns:\s*many\(reactivationCampaigns\)/);
  });

  test('0007 migration creates the table and all three indexes', () => {
    const src = source(MIGRATION);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "reactivation_campaigns"/);
    assert.match(src, /"tenant_id" uuid NOT NULL REFERENCES tenants\(id\) ON DELETE CASCADE/);
    assert.match(src, /"segment" text NOT NULL/);
    assert.match(src, /"sent_at" timestamp/);
    assert.match(src, /"responded" boolean DEFAULT false NOT NULL/);
    assert.match(src, /reactivation_campaigns_tenant_idx/);
    assert.match(src, /reactivation_campaigns_phone_idx/);
    assert.match(src, /reactivation_campaigns_pending_idx[\s\S]*WHERE "sent_at" IS NULL/);
  });

  test('migration journal and /api/migrate include the Gate #9 DDL', () => {
    const journal = JSON.parse(source(JOURNAL));
    assert.ok(
      journal.entries.some((entry: { tag: string }) => entry.tag === '0007_reactivation_campaigns'),
      'journal has no 0007_reactivation_campaigns entry'
    );
    const route = code(MIGRATE_DDL_FILE);
    assert.match(route, /CREATE TABLE IF NOT EXISTS reactivation_campaigns/);
    assert.match(route, /reactivation_campaigns_tenant_idx/);
    assert.match(route, /reactivation_campaigns_phone_idx/);
    assert.match(
      route,
      /reactivation_campaigns_pending_idx[\s\S]*ON reactivation_campaigns[\s\S]*WHERE sent_at IS NULL/
    );
  });
});

describe('reactivation seams are framework-free where promised', () => {
  test('eligibility/copy module has no framework imports', () => {
    const src = code(LOGIC);
    assert.doesNotMatch(src, /from\s+['"](?:@\/lib\/db|drizzle-orm|next\/)/);
  });

  test('cron runner has no framework imports', () => {
    const src = code(RUNNER);
    assert.doesNotMatch(src, /from\s+['"](?:@\/lib\/db|drizzle-orm|next\/)/);
  });
});

describe('reactivation store wiring (mutation checks)', () => {
  test('campaign reads and writes are tenant-scoped', () => {
    const src = code(STORE);
    for (const fn of [
      'export async function getPendingCampaigns',
      'export async function getCampaignHistory',
      'export async function listCampaigns',
      'export async function countCampaigns',
      'export async function campaignStats',
      'export async function markLatestCampaignResponded',
    ]) {
      assert.match(from(src, fn), /eq\(reactivationCampaigns\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
  });

  test('markSent is idempotent — it cannot restamp an already-sent campaign', () => {
    const body = from(code(STORE), 'export async function markSent');
    assert.match(body, /eq\(reactivationCampaigns\.id,\s*campaignId\)/);
    assert.match(body, /isNull\(reactivationCampaigns\.sentAt\)/);
  });

  test('markResponded only flips an unresponded campaign', () => {
    const body = from(code(STORE), 'export async function markResponded');
    assert.match(body, /eq\(reactivationCampaigns\.id,\s*campaignId\)/);
    assert.match(body, /eq\(reactivationCampaigns\.responded,\s*false\)/);
  });

  test('response attribution checks the response window before marking', () => {
    const body = from(code(STORE), 'export async function markLatestCampaignResponded');
    assert.match(body, /isNotNull\(reactivationCampaigns\.sentAt\)/);
    assert.match(body, /eq\(reactivationCampaigns\.responded,\s*false\)/);
    assert.match(body, /isWithinResponseWindow\(latest\.sentAt,\s*now\)/);
    const markAt = body.indexOf('markResponded(latest.id)');
    const windowAt = body.indexOf('isWithinResponseWindow(latest.sentAt, now)');
    assert.ok(markAt > windowAt, 'campaign marked responded before the window check');
  });

  test('candidate fetch pre-filters win-back segments and opted-out contacts in SQL', () => {
    const body = from(code(STORE), 'export async function fetchCampaignCandidates');
    assert.match(body, /eq\(customerProfiles\.tenantId,\s*tenantId\)/);
    assert.match(body, /inArray\(customerProfiles\.segment,\s*\['dormant',\s*'at_risk'\]\)/);
    assert.match(body, /COALESCE\(\$\{contacts\.blocklisted\},\s*false\) = false/);
  });

  test('queueCampaignMessage hands off to the jobs outbox like every other send', () => {
    const body = from(code(STORE), 'export async function queueCampaignMessage');
    assert.match(body, /insert\(jobs\)/);
    assert.match(body, /type:\s*'send_whatsapp'/);
    assert.match(body, /status:\s*'pending'/);
  });

  test('cron adapter satisfies the runner contract and is exported', () => {
    const src = code(STORE);
    assert.match(src, /export const drizzleReactivationCronStore:\s*ReactivationCampaignStore/);
  });
});

describe('reactivation cron route wiring', () => {
  test('route runs the runner with the Drizzle adapter', () => {
    const src = code(CRON);
    assert.match(src, /import\s*\{[^}]*runReactivationCampaignCron[^}]*\}\s*from\s*'@\/lib\/customer\/reactivation-cron'/);
    assert.match(src, /import\s*\{[^}]*drizzleReactivationCronStore[^}]*\}\s*from\s*'@\/lib\/customer\/reactivation-store'/);
    assert.match(src, /runReactivationCampaignCron\(\s*drizzleReactivationCronStore/);
  });

  test('route honors the global master AI kill-switch before running', () => {
    const body = from(code(CRON), 'export async function GET');
    const switchAt = body.indexOf('masterAiSwitch');
    const runAt = body.indexOf('runReactivationCampaignCron(');
    assert.ok(switchAt > -1, 'no masterAiSwitch check');
    assert.ok(runAt > switchAt, 'runner executes before the kill-switch check');
  });
});

describe('webhook response handling wiring', () => {
  test('webhook imports the attribution hook and booking-intent helper', () => {
    const src = code(WEBHOOK);
    assert.match(src, /import\s*\{[^}]*markLatestCampaignResponded[^}]*\}\s*from\s*'@\/lib\/customer\/reactivation-store'/);
    assert.match(src, /import\s*\{[^}]*isReactivationBookingReply[^}]*\}\s*from\s*'@\/lib\/customer\/reactivation'/);
  });

  test('attribution runs after the inbound message is recorded and before the AI reply', () => {
    const body = from(code(WEBHOOK), 'export async function POST');
    const insertAt = body.indexOf('.insert(messages)');
    const hookAt = body.indexOf('markLatestCampaignResponded(tenantId, fromPhone)');
    const aiAt = body.indexOf('processInboundAIResponse(');
    assert.ok(insertAt > -1, 'inbound insert not found');
    assert.ok(hookAt > insertAt, 'attribution must run after the inbound message is recorded');
    assert.ok(aiAt === -1 || aiAt > hookAt, 'attribution must run before the AI reply is generated');
  });

  test('attribution failure cannot break the reply path (guarded)', () => {
    const body = from(code(WEBHOOK), 'export async function POST');
    const hookAt = body.indexOf('markLatestCampaignResponded(tenantId, fromPhone)');
    const tryAt = body.lastIndexOf('try', hookAt);
    const catchAt = body.indexOf('catch', hookAt);
    assert.ok(tryAt > -1 && catchAt > hookAt, 'attribution call is not wrapped in try/catch');
  });
});

describe('dashboard API wiring', () => {
  test('GET lists campaigns tenant-scoped and paginated', () => {
    const src = code(API);
    const body = from(src, 'export async function GET');
    assert.match(body, /getOrCreateTenant\(\)/);
    assert.match(body, /listCampaigns\(tenant\.id,\s*limit,\s*offset\)/);
    assert.match(body, /countCampaigns\(tenant\.id\)/);
    assert.match(body, /401/);
  });

  test('POST enforces POPIA, eligibility, cooldown override, and the send sequence', () => {
    const src = code(API);
    const body = from(src, 'export async function POST');
    assert.match(body, /findReactivationTargetProfile\(tenant\.id,\s*customerPhone\)/);
    assert.match(body, /status:\s*403/, 'opted-out contacts must be refused');
    assert.match(body, /resolveReactivationTarget\(profile\)/);
    assert.match(body, /isWithinCampaignCooldown\(latest\.sentAt\)/);
    assert.match(body, /status:\s*409/, 'cooldown must be surfaced as a conflict');
    assert.match(body, /force/);
    assert.match(body, /createPendingCampaign\(/);
    assert.match(body, /queueCampaignMessage\(/);
    const createAt = body.indexOf('createPendingCampaign(');
    const queueAt = body.indexOf('queueCampaignMessage({', createAt);
    const sentAt = body.indexOf('markSent(campaign.id)', queueAt);
    assert.ok(createAt > -1 && queueAt > createAt && sentAt > queueAt, 'create → queue → markSent order violated');
  });

  test('stats endpoint returns the FILTER-aggregate metrics tenant-scoped', () => {
    const src = code(STATS_API);
    assert.match(src, /campaignStats\(tenant\.id\)/);
    assert.match(code(STORE), /count\(\*\) FILTER \(WHERE \$\{reactivationCampaigns\.responded\} AND/);
  });
});

describe('dashboard UI wiring', () => {
  test('page renders the response-rate headline and campaign table', () => {
    const src = source(PAGE);
    assert.match(src, /\{stats\.sent\} sent, \{stats\.responded\} responded \(\{responsePercent\}%\)/);
    assert.match(src, /campaignStats\(tenant\.id\)/);
    assert.match(src, /listCampaigns\(tenant\.id,\s*100,\s*0\)/);
    assert.match(src, /campaign\.messageText/);
    assert.match(src, /campaign\.responded/);
    assert.match(src, /redirect\('\/sign-in'\)/);
  });

  test('client form posts to the reactivation API and refreshes the list', () => {
    const src = source(CLIENT);
    assert.match(src, /'use client'/);
    assert.match(src, /fetch\('\/api\/customer\/reactivation'/);
    assert.match(src, /method:\s*'POST'/);
    assert.match(src, /router\.refresh\(\)/);
  });
});
