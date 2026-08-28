import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * RC5 / F5+F6 — no blank screen, ever.
 *
 * Before this change the app had ZERO error.tsx, loading.tsx or
 * not-found.tsx files (verified: `find app -name error.tsx -o -name
 * loading.tsx -o -name not-found.tsx` returned nothing). Any unhandled throw
 * in a server component therefore produced Next's bare "500: Internal Server
 * Error" page — and because the throw happened while rendering the layout,
 * there was no boundary above it to catch it.
 *
 * These tests pin that a boundary exists at every level that can throw, and
 * that each one is pure static UI: an error page that itself needs the
 * database would fail during the very outage it is meant to survive.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// This file sits directly in lib/, so the app root is one level up (the
// lib/auth and lib/db tests are two levels down and use '..','..').
const MAIN = join(HERE, '..');

function src(rel: string): string {
  const p = join(MAIN, rel);
  assert.ok(existsSync(p), `missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const ERROR_BOUNDARIES = [
  'app/error.tsx',
  'app/global-error.tsx',
  'app/dashboard/error.tsx',
  'app/admin/error.tsx',
];

const LOADING_STATES = [
  'app/loading.tsx',
  'app/dashboard/loading.tsx',
  'app/admin/loading.tsx',
];

describe('RC5 — an error boundary exists at every level that can throw', () => {
  for (const rel of ERROR_BOUNDARIES) {
    test(`${rel} exists`, () => {
      assert.ok(existsSync(join(MAIN, rel)), `${rel} must exist`);
    });

    test(`${rel} is a client component (required by Next for error.tsx)`, () => {
      assert.match(src(rel).trimStart().slice(0, 40), /^'use client'/);
    });

    test(`${rel} exposes error + reset and offers a way out`, () => {
      const code = stripComments(src(rel));
      assert.match(code, /error/, 'must receive the error');
      assert.match(code, /reset|href/, 'must offer recovery (reset button or a link)');
    });

    test(`${rel} is pure static UI (no DB, no Clerk, no network)`, () => {
      const code = stripComments(src(rel));
      assert.ok(!/@\/lib\/db/.test(code), `${rel} must not touch the database`);
      assert.ok(!/@clerk\//.test(code), `${rel} must not depend on Clerk`);
      assert.ok(!/\bfetch\(/.test(code), `${rel} must not perform network calls`);
      assert.ok(!/drizzle-orm/.test(code), `${rel} must not import drizzle`);
    });
  }

  test('global-error.tsx renders its own <html> and <body>', () => {
    // Next requires global-error to supply the full document, because it
    // replaces the root layout — which is exactly the layout that threw.
    const code = stripComments(src('app/global-error.tsx'));
    assert.match(code, /<html/);
    assert.match(code, /<body/);
  });

  test('error.tsx boundaries do NOT render <html> (they nest inside the layout)', () => {
    for (const rel of ['app/error.tsx', 'app/dashboard/error.tsx', 'app/admin/error.tsx']) {
      assert.ok(!/<html/.test(src(rel)), `${rel} must not render <html>`);
    }
  });
});

describe('RC5 — loading and 404 states exist', () => {
  for (const rel of LOADING_STATES) {
    test(`${rel} exists and is pure static UI`, () => {
      const code = stripComments(src(rel));
      assert.ok(!/@\/lib\/db/.test(code), `${rel} must not touch the database`);
      assert.ok(!/@clerk\//.test(code), `${rel} must not depend on Clerk`);
    });
  }

  test('app/not-found.tsx exists and is pure static UI', () => {
    const code = stripComments(src('app/not-found.tsx'));
    assert.ok(!/@\/lib\/db/.test(code));
    assert.ok(!/@clerk\//.test(code));
    assert.match(code, /404|not found|Not Found|couldn.t find/i);
  });
});

describe('RC6 — dashboard layout degrades instead of throwing (F2)', () => {
  const layout = stripComments(src('app/dashboard/layout.tsx'));

  test('resolveActiveTenant is wrapped in try/catch', () => {
    assert.match(layout, /try\s*\{[\s\S]*?resolveActiveTenant\(\)[\s\S]*?\}\s*catch/);
  });

  test('getOrCreateTenant is wrapped in try/catch', () => {
    assert.match(layout, /try\s*\{[\s\S]*?getOrCreateTenant\(\)[\s\S]*?\}\s*catch/);
  });

  test('listManagedTenants cannot take the layout down', () => {
    assert.match(layout, /listManagedTenants\([\s\S]{0,200}?\.catch\(|try\s*\{[\s\S]*?listManagedTenants/);
  });

  test('a DB outage surfaces a banner rather than a 500', () => {
    assert.match(layout, /degraded|Reconnecting|reconnect/i);
  });

  test('the layout logs a diagnosable message', () => {
    assert.match(layout, /console\.error\(/);
  });
});
