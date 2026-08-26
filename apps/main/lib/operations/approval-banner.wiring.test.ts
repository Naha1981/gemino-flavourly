import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const DASHBOARD = join(APP, 'dashboard', 'page.tsx');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
}

describe('approval workflow — pending-approvals banner (Engine 6)', () => {
  test('the dashboard overview surfaces a pending-approvals banner', () => {
    const src = code(DASHBOARD);
    assert.match(src, /countPendingApprovals\(/);
    assert.match(src, /awaiting approval|pending approval/i);
    assert.match(src, /operations\/approval-requests/);
    assert.match(src, /Review Approvals/);
  });
});
