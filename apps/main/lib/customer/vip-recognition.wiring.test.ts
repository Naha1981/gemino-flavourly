import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const LOGIC = join(HERE, 'vip-recognition.ts');
const STORE = join(HERE, 'vip-store.ts');
const WEBHOOK = join(APP, 'api', 'webhooks', 'whatsapp', 'route.ts');
const API = join(APP, 'api', 'customer', 'vip-alerts', 'route.ts');
const TODAY_API = join(APP, 'api', 'customer', 'vip-alerts', 'today', 'route.ts');
const ID_API = join(APP, 'api', 'customer', 'vip-alerts', '[id]', 'route.ts');
const PAGE = join(APP, 'dashboard', 'inbox', 'page.tsx');
const VIP_PAGE = join(APP, 'dashboard', 'customers', 'vip-today', 'page.tsx');
const CLIENT = join(APP, 'dashboard', 'customers', 'vip-today', 'vip-today-client.tsx');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0008_vip_recognition.sql');
const JOURNAL = join(HERE, '..', '..', 'drizzle', 'meta', '_journal.json');
const MIGRATE_ROUTE = join(APP, 'api', 'migrate', 'route.ts');
const ADMIN = join(APP, 'admin', 'page.tsx');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
}

function from(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > -1, `"${needle}" not found`);
  return src.slice(at);
}

describe('VIP schema wiring', () => {
  test('schema defines the vip_alerts table with the required columns and tenant FK', () => {
    const table = from(code(SCHEMA), 'export const vipAlerts = pgTable(');
    assert.match(table, /uuid\('tenant_id'\)/);
    assert.match(table, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(table, /text\('customer_phone'\)\.notNull\(\)/);
    assert.match(table, /text\('customer_name'\)/);
    assert.match(table, /integer\('total_visits'\)\.notNull\(\)/);
    assert.match(table, /integer\('total_spend_cents'\)\.notNull\(\)/);
    assert.match(table, /timestamp\('last_visit_at'\)\.notNull\(\)/);
    assert.match(table, /jsonb\('preferences'\)\.default\(\{\}\)\.notNull\(\)/);
    assert.match(table, /timestamp\('sent_at'\)\.defaultNow\(\)\.notNull\(\)/);
  });

  test('schema declares all three VIP indexes', () => {
    const table = from(code(SCHEMA), 'export const vipAlerts = pgTable(');
    assert.match(table, /index\('vip_alerts_tenant_idx'\)\.on\(table\.tenantId\)/);
    assert.match(table, /index\('vip_alerts_phone_idx'\)\.on\(table\.customerPhone\)/);
    assert.match(table, /index\('vip_alerts_sent_idx'\)\.on\(table\.sentAt\)/);
  });

  test('schema supports the quick-action columns and the system message direction', () => {
    const table = from(code(SCHEMA), 'export const vipAlerts = pgTable(');
    assert.match(table, /timestamp\('served_at'\)/);
    assert.match(table, /text\('note'\)/);
    assert.match(code(SCHEMA), /text\('direction',\s*\{\s*enum:\s*\['inbound',\s*'outbound',\s*'system'\]/);
  });

  test('tenant relations expose vipAlerts', () => {
    assert.match(code(SCHEMA), /vipAlerts:\s*many\(vipAlerts\)/);
  });

  test('0008 migration creates the table and all three indexes', () => {
    const src = source(MIGRATION);
    assert.match(src, /CREATE TABLE IF NOT EXISTS "vip_alerts"/);
    assert.match(src, /"tenant_id" uuid NOT NULL REFERENCES tenants\(id\) ON DELETE CASCADE/);
    assert.match(src, /"customer_phone" text NOT NULL/);
    assert.match(src, /"total_visits" integer NOT NULL/);
    assert.match(src, /"total_spend_cents" integer NOT NULL/);
    assert.match(src, /"last_visit_at" timestamp NOT NULL/);
    assert.match(src, /"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL/);
    assert.match(src, /vip_alerts_tenant_idx/);
    assert.match(src, /vip_alerts_phone_idx/);
    assert.match(src, /vip_alerts_sent_idx/);
  });

  test('migration journal and /api/migrate include the Gate #10 DDL', () => {
    const journal = JSON.parse(source(JOURNAL));
    assert.ok(
      journal.entries.some((entry: { tag: string }) => entry.tag === '0008_vip_recognition'),
      'journal has no 0008_vip_recognition entry'
    );
    const route = code(MIGRATE_ROUTE);
    assert.match(route, /CREATE TABLE IF NOT EXISTS vip_alerts/);
    assert.match(route, /vip_alerts_tenant_idx/);
    assert.match(route, /vip_alerts_phone_idx/);
    assert.match(route, /vip_alerts_sent_idx/);
  });
});

describe('VIP seams are framework-free where promised', () => {
  test('detection/copy module has no framework imports', () => {
    const src = code(LOGIC);
    assert.doesNotMatch(src, /from\s+['"](?:@\/lib\/db|drizzle-orm|next\/)/);
  });
});

describe('VIP store wiring (mutation + isolation checks)', () => {
  test('profile lookup is tenant-scoped', () => {
    const body = from(code(STORE), 'export async function findProfileByPhone');
    assert.match(body, /eq\(customerProfiles\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(customerProfiles\.customerPhone,\s*customerPhone\)/);
  });

  test('saveVipAlert writes to vip_alerts with all required columns', () => {
    const body = from(code(STORE), 'export async function saveVipAlert');
    assert.match(body, /insert\(vipAlerts\)/);
    assert.match(body, /customerPhone:\s*input\.alert\.customerPhone/);
    assert.match(body, /totalVisits:\s*input\.alert\.totalVisits/);
    assert.match(body, /totalSpendCents:\s*input\.alert\.totalSpendCents/);
    assert.match(body, /lastVisitAt:\s*input\.alert\.lastVisitAt/);
  });

  test('saveSystemMessage writes a system-direction message (never dispatched)', () => {
    const body = from(code(STORE), 'export async function saveSystemMessage');
    assert.match(body, /insert\(messages\)/);
    assert.match(body, /direction:\s*'system'/);
    assert.match(body, /conversationId:\s*input\.conversationId/);
    assert.match(body, /messageType:\s*'system'/);
  });

  test('list/count reads are tenant-scoped', () => {
    const src = code(STORE);
    for (const fn of [
      'export async function listVipAlerts',
      'export async function listVipAlertsToday',
      'export async function countVipAlerts',
    ]) {
      assert.match(from(src, fn), /eq\(vipAlerts\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
  });

  test('countVipAlertsToday aggregates across all tenants (super admin)', () => {
    const source = code(STORE);
    const body = from(source, 'export async function countVipAlertsToday');
    // Isolate just this function (stop at the next top-level export).
    const fn = body.split('\n\nexport async function')[0];
    assert.match(fn, /from\(vipAlerts\)/);
    assert.match(fn, /gte\(vipAlerts\.sentAt,\s*startOfToday\(\)\)/);
    assert.doesNotMatch(fn, /eq\(vipAlerts\.tenantId/);
  });

  test('markVipAlertServed is idempotent and tenant-scoped', () => {
    const body = from(code(STORE), 'export async function markVipAlertServed');
    assert.match(body, /set\(\{\s*servedAt:\s*new Date\(\)/);
    assert.match(body, /eq\(vipAlerts\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(vipAlerts\.id,\s*alertId\)/);
    assert.match(body, /isNull\(vipAlerts\.servedAt\)/);
  });

  test('addVipAlertNote is tenant-scoped', () => {
    const body = from(code(STORE), 'export async function addVipAlertNote');
    assert.match(body, /eq\(vipAlerts\.tenantId,\s*tenantId\)/);
    assert.match(body, /eq\(vipAlerts\.id,\s*alertId\)/);
  });

  test('the webhook adapter satisfies the framework-free store contract', () => {
    const src = code(STORE);
    assert.match(src, /export const drizzleVipRecognitionStore:\s*VipRecognitionStore/);
  });
});

describe('webhook VIP wiring', () => {
  test('webhook imports the VIP orchestrator and Drizzle adapter', () => {
    const src = code(WEBHOOK);
    assert.match(src, /import\s*\{[^}]*processFirstMessageVip[^}]*\}\s*from\s*'@\/lib\/customer\/vip-recognition'/);
    assert.match(src, /import\s*\{[^}]*drizzleVipRecognitionStore[^}]*\}\s*from\s*'@\/lib\/customer\/vip-store'/);
  });

  test('VIP recognition runs only when a NEW conversation starts', () => {
    const body = from(code(WEBHOOK), 'export async function POST');
    const blockAt = body.indexOf('processFirstMessageVip(drizzleVipRecognitionStore');
    const isNewAt = body.indexOf('if (isNewConversation)');
    assert.ok(blockAt > -1, 'VIP recognition not invoked');
    assert.ok(isNewAt > -1, 'VIP recognition is not gated on a new conversation');
    assert.ok(isNewAt < blockAt, 'VIP recognition must run inside the new-conversation guard');
  });

  test('VIP recognition runs after the inbound message is recorded and before the AI reply', () => {
    const body = from(code(WEBHOOK), 'export async function POST');
    const insertAt = body.indexOf('.insert(messages)');
    const vipAt = body.indexOf('processFirstMessageVip(drizzleVipRecognitionStore');
    const aiAt = body.indexOf('processInboundAIResponse(');
    assert.ok(insertAt > -1, 'inbound insert not found');
    assert.ok(vipAt > insertAt, 'VIP recognition must run after the inbound message is recorded');
    assert.ok(aiAt === -1 || aiAt > vipAt, 'VIP recognition must run before the AI reply is generated');
  });

  test('VIP recognition failure cannot break the reply path (guarded)', () => {
    const body = from(code(WEBHOOK), 'export async function POST');
    const vipAt = body.indexOf('processFirstMessageVip(drizzleVipRecognitionStore');
    const tryAt = body.lastIndexOf('try', vipAt);
    const catchAt = body.indexOf('catch', vipAt);
    assert.ok(tryAt > -1 && catchAt > vipAt, 'VIP recognition is not wrapped in try/catch');
  });

  test('the new-conversation flag is set when a conversation row is created', () => {
    const body = from(code(WEBHOOK), 'export async function POST');
    assert.match(body, /isNewConversation\s*=\s*true/);
  });
});

describe('dashboard API wiring', () => {
  test('GET lists VIP alerts tenant-scoped', () => {
    const src = code(API);
    const body = from(src, 'export async function GET');
    assert.match(body, /getOrCreateTenant\(\)/);
    assert.match(body, /listVipAlerts\(tenant\.id/);
    assert.match(body, /countVipAlerts\(tenant\.id\)/);
    assert.match(body, /401/);
  });

  test('today endpoint returns today\'s alerts tenant-scoped', () => {
    const src = code(TODAY_API);
    const body = from(src, 'export async function GET');
    assert.match(body, /getOrCreateTenant\(\)/);
    assert.match(body, /listVipAlertsToday\(tenant\.id/);
    assert.match(body, /401/);
  });

  test('PATCH quick action marks served and/or adds a note, tenant-scoped', () => {
    const src = code(ID_API);
    const body = from(src, 'export async function PATCH');
    assert.match(body, /markVipAlertServed\(tenant\.id,\s*alertId\)/);
    assert.match(body, /addVipAlertNote\(tenant\.id,\s*alertId,\s*note\)/);
    assert.match(body, /401/);
  });
});

describe('dashboard UI wiring', () => {
  test('inbox renders a gold VIP banner linked to the vip-today page', () => {
    const src = source(PAGE);
    assert.match(src, /listVipAlerts\(tenantId/);
    assert.match(src, /VIP Alert/);
    assert.match(src, /dashboard\/customers\/vip-today/);
    assert.match(src, /dashboard\/customers\/\$\{encodeURIComponent\(alert\.customerPhone\)\}/);
  });

  test('vip-today page renders the client action component', () => {
    const src = source(VIP_PAGE);
    assert.match(src, /listVipAlertsToday\(tenant\.id/);
    assert.match(src, /VipTodayClient/);
    assert.match(src, /redirect\('\/sign-in'\)/);
  });

  test('client form posts the PATCH action and refreshes', () => {
    const src = source(CLIENT);
    assert.match(src, /'use client'/);
    assert.match(src, /fetch\(`\/api\/customer\/vip-alerts\/\$\{id\}`/);
    assert.match(src, /method:\s*'PATCH'/);
    assert.match(src, /router\.refresh\(\)/);
    assert.match(src, /served:\s*true/);
    assert.match(src, /note/);
  });
});

describe('super admin extension wiring', () => {
  test('admin page adds the VIP Alerts Today metric across all tenants', () => {
    const src = code(ADMIN);
    assert.match(src, /countVipAlertsToday\(\)/);
    assert.match(src, /VIP Alerts Today/);
    assert.match(src, /vipAlertsToday/);
  });
});
