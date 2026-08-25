import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const SCHEMA = join(HERE, '..', 'db', 'schema.ts');
const STORE = join(HERE, 'approval-request-store.ts');
const API = join(APP, 'api', 'operations', 'approval-requests', 'route.ts');
const PATCH_API = join(APP, 'api', 'operations', 'approval-requests', '[id]', 'route.ts');
const PAGE = join(APP, 'dashboard', 'operations', 'approval-requests', 'page.tsx');
const MIGRATION = join(HERE, '..', '..', 'drizzle', '0013_engine6_operations.sql');
const JOURNAL = join(HERE, '..', '..', 'drizzle', 'meta', '_journal.json');
const MIGRATE_ROUTE = join(APP, 'api', 'migrate', 'route.ts');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

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

describe('approval request schema wiring', () => {
  test('schema defines approval_requests with tenant and conversation FKs', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const approvalRequests = pgTable(');
    assert.match(table, /uuid\('tenant_id'\)/);
    assert.match(table, /references\(\(\) => tenants\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(table, /uuid\('conversation_id'\)/);
    assert.match(table, /references\(\(\) => conversations\.id,\s*\{\s*onDelete:\s*'cascade'/);
    assert.match(table, /text\('message_text'\)\.notNull\(\)/);
    assert.match(table, /text\('risk_level',\s*\{\s*enum:\s*\['green',\s*'yellow',\s*'red'\]\s*\}\)\.notNull\(\)/);
    assert.match(table, /text\('status',\s*\{\s*enum:\s*\['pending',\s*'approved',\s*'rejected'\]\s*\}\)\.default\('pending'\)\.notNull\(\)/);
    assert.match(table, /text\('approved_by'\)/);
    assert.match(table, /timestamp\('approved_at'\)/);
  });

  test('schema declares approval request indexes', () => {
    const src = code(SCHEMA);
    const table = from(src, 'export const approvalRequests = pgTable(');
    assert.match(table, /index\('approval_requests_tenant_status_idx'\)\.on\(table\.tenantId,\s*table\.status\)/);
    assert.match(table, /index\('approval_requests_conversation_idx'\)\.on\(table\.conversationId\)/);
  });

  test('tenant and conversation relations expose approvalRequests', () => {
    const src = code(SCHEMA);
    assert.match(src, /approvalRequests:\s*many\(approvalRequests\)/);
    const convRel = from(src, 'export const conversationRelations = relations(conversations');
    assert.match(convRel, /approvalRequests:\s*many\(approvalRequests\)/);
  });

  test('0013 migration creates approval_requests with correct DDL', () => {
    const src = source(MIGRATION);
    assert.match(src, /CREATE TABLE IF NOT EXISTS approval_requests/);
    assert.match(src, /conversation_id uuid NOT NULL REFERENCES conversations\(id\) ON DELETE CASCADE/);
    assert.match(src, /message_text text NOT NULL/);
    assert.match(src, /risk_level text NOT NULL/);
    assert.match(src, /status text DEFAULT 'pending' NOT NULL/);
    assert.match(src, /approved_by text/);
    assert.match(src, /approved_at timestamp/);
    assert.match(src, /approval_requests_tenant_status_idx/);
    assert.match(src, /approval_requests_conversation_idx/);
  });

  test('migration journal and /api/migrate include Engine 6 DDL', () => {
    const journal = JSON.parse(source(JOURNAL));
    assert.ok(
      journal.entries.some((entry: { tag: string }) => entry.tag === '0013_engine6_operations'),
      'journal has no 0013_engine6_operations entry'
    );
    const route = code(MIGRATE_ROUTE);
    assert.match(route, /CREATE TABLE IF NOT EXISTS approval_requests/);
    assert.match(route, /approval_requests_tenant_status_idx/);
    assert.match(route, /approval_requests_conversation_idx/);
  });
});

describe('approval request store wiring', () => {
  test('all reads and writes are tenant-scoped', () => {
    const src = code(STORE);
    for (const fn of [
      'export async function listApprovalRequests',
      'export async function getApprovalRequest',
      'export async function createApprovalRequest',
      'export async function updateApprovalStatus',
      'export async function countPendingApprovals',
    ]) {
      assert.match(from(src, fn), /eq\(approvalRequests\.tenantId,\s*tenantId\)/, `${fn} is not tenant-scoped`);
    }
  });

  test('updateApprovalStatus only flips pending rows', () => {
    const body = from(code(STORE), 'export async function updateApprovalStatus');
    assert.match(body, /eq\(approvalRequests\.status,\s*'pending'\)/);
  });

  test('createApprovalRequest requires conversationId, messageText, and riskLevel', () => {
    const body = from(code(STORE), 'export async function createApprovalRequest');
    assert.match(body, /tenantId:\s*input\.tenantId/);
    assert.match(body, /conversationId:\s*input\.conversationId/);
    assert.match(body, /messageText:\s*input\.messageText/);
    assert.match(body, /riskLevel:\s*input\.riskLevel/);
  });
});

describe('approval request API wiring', () => {
  test('GET lists requests and supports optional status filter', () => {
    const src = code(API);
    assert.match(src, /getOrCreateTenant\(\)/);
    assert.match(src, /listApprovalRequests\(tenant\.id/);
    assert.match(src, /countPendingApprovals\(tenant\.id\)/);
    assert.match(src, /401/);
  });

  test('POST validates required fields and risk level enum', () => {
    const src = code(API);
    const body = from(src, 'export async function POST');
    assert.match(body, /conversation_id/);
    assert.match(body, /message_text/);
    assert.match(body, /risk_level/);
    assert.match(body, /\['green',\s*'yellow',\s*'red'\]/);
    assert.match(body, /201/);
  });

  test('PATCH enforces pending state and records approver', () => {
    const src = code(PATCH_API);
    assert.match(src, /getApprovalRequest\(tenant\.id,\s*requestId\)/);
    assert.match(src, /updateApprovalStatus\(/);
    assert.match(src, /existing\.status !== 'pending'/);
    assert.match(src, /approvedBy/);
  });
});

describe('approval request dashboard wiring', () => {
  test('page renders pending and resolved sections', () => {
    const src = source(PAGE);
    assert.match(src, /listApprovalRequests\(tenant\.id,\s*'pending'\)/);
    assert.match(src, /listApprovalRequests\(tenant\.id,\s*'approved'\)/);
    assert.match(src, /listApprovalRequests\(tenant\.id,\s*'rejected'\)/);
    assert.match(src, /Pending/);
    assert.match(src, /Resolved/);
    assert.match(src, /redirect\('\/sign-in'\)/);
  });
});
