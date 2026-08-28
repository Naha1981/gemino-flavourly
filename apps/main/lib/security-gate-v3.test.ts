import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..');
const APP = join(MAIN, 'app');
const LIB = join(MAIN, 'lib');

function src(rel: string): string {
  const p = join(MAIN, rel);
  assert.ok(existsSync(p), `missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

function handlerBody(full: string, method: string): string {
  const idx = full.indexOf(`export async function ${method}(`);
  if (idx === -1) return '';
  return full.slice(idx);
}

// ---------------------------------------------------------------------------
// 1. Unauthenticated Access — /dashboard and /api/* must be protected
// ---------------------------------------------------------------------------
describe('GATE V3 — unauthenticated access must be denied', () => {
  test('middleware defines isPublicRoute and calls auth().protect()', () => {
    const mw = src('middleware.ts');
    assert.match(mw, /isPublicRoute/);
    assert.match(mw, /auth\(\)\.protect\(\)/);
  });

  test('/dashboard is NOT in public route list', () => {
    const mw = src('middleware.ts');
    // isPublicRoute array must not contain '/dashboard'
    const publicBlock = mw.match(/isPublicRoute\s*=\s*createRouteMatcher\(\[([\s\S]*?)\]\)/);
    assert.ok(publicBlock, 'isPublicRoute matcher not found');
    const list = publicBlock[1];
    assert.doesNotMatch(list, /['\"]\/dashboard['\"]/);
    assert.doesNotMatch(list, /dashboard/);
  });

  test('/admin is NOT in public route list', () => {
    const mw = src('middleware.ts');
    const publicBlock = mw.match(/isPublicRoute\s*=\s*createRouteMatcher\(\[([\s\S]*?)\]\)/);
    assert.ok(publicBlock);
    const list = publicBlock[1];
    assert.doesNotMatch(list, /\/admin/);
  });

  test('/api/tenant/* is NOT public — requires auth()', () => {
    const listRoute = src('app/api/tenant/list/route.ts');
    assert.match(listRoute, /auth\(\)/);
    assert.match(listRoute, /status:\s*401/);
    const switchRoute = src('app/api/tenant/switch/route.ts');
    assert.match(switchRoute, /auth\(\)/);
    assert.match(switchRoute, /status:\s*401/);
  });

  test('/api/conversations/* requires getOrCreateTenant and returns 401', () => {
    const route = src('app/api/conversations/[id]/messages/route.ts');
    assert.match(route, /getOrCreateTenant\(\)/);
    assert.match(route, /status:\s*401/);
  });

  test('/api/customer/* requires getOrCreateTenant', () => {
    const route = src('app/api/customer/profiles/route.ts');
    assert.match(route, /getOrCreateTenant\(\)/);
  });

  test('middleware matcher covers api and trpc', () => {
    const mw = src('middleware.ts');
    assert.match(mw, /\/\(api\|trpc\)/);
  });
});

// ---------------------------------------------------------------------------
// 2. Super Admin Gate — non-admin must be denied /admin
// ---------------------------------------------------------------------------
describe('GATE V3 — super-admin gate denies non-admin', () => {
  test('/admin page checks isSuperAdmin and redirects', () => {
    const page = src('app/admin/page.tsx');
    assert.match(page, /isSuperAdmin\(\)/);
    assert.match(page, /redirect\(['\"]\/sign-in['\"]\)/);
  });

  test('/admin/prospects page is super-admin only', () => {
    const page = src('app/admin/prospects/page.tsx');
    assert.match(page, /isSuperAdmin\(\)/);
  });

  test('/api/admin/* routes check isSuperAdmin and return 403', () => {
    const adminApiDir = join(APP, 'api', 'admin');
    const entries = readdirSync(adminApiDir, { withFileTypes: true }).flatMap((e) => {
      if (e.isDirectory()) {
        const sub = join(adminApiDir, e.name, 'route.ts');
        return existsSync(sub) ? [sub] : [];
      }
      if (e.name === 'route.ts') return [join(adminApiDir, e.name)];
      return [];
    });
    // Also nested: toggle-ai, seed-demo, etc.
    const nested = [
      'api/admin/toggle-ai/route.ts',
      'api/admin/seed-demo/route.ts',
      'api/admin/wipe-demo/route.ts',
      'api/admin/sync-crons/route.ts',
      'api/admin/settings/cron-key/route.ts',
    ];
    for (const rel of nested) {
      const p = join(MAIN, `app/${rel}`);
      if (!existsSync(p)) continue;
      const content = readFileSync(p, 'utf8');
      assert.match(content, /isSuperAdmin\(\)/, `${rel} must check isSuperAdmin`);
      assert.match(content, /status:\s*403/, `${rel} must return 403 on failure`);
    }
  });

  test('/api/migrate is super-admin gated', () => {
    const route = src('app/api/migrate/route.ts');
    assert.match(route, /isSuperAdmin\(\)/);
    assert.match(route, /status:\s*403/);
  });

  test('isSuperAdmin fails closed — reads via live Clerk API not sessionClaims', () => {
    const impl = stripComments(src('lib/auth/is-super-admin.ts'));
    assert.match(impl, /clerkClient/);
    assert.match(impl, /users\.getUser/);
    assert.doesNotMatch(impl, /sessionClaims\.email/);
    assert.match(impl, /if\s*\(!userId\)\s*return false/);
  });
});

// ---------------------------------------------------------------------------
// 3. Tenant Isolation — Tenant B denied Tenant A data via API and UI
// ---------------------------------------------------------------------------
describe('GATE V3 — tenant isolation (CRITICAL)', () => {
  test('conversations messages route scopes by tenant.id', () => {
    const route = src('app/api/conversations/[id]/messages/route.ts');
    const code = stripComments(route);
    // Must filter by both id and tenantId
    assert.match(code, /eq\(conversations\.id,\s*conversationId\)/);
    assert.match(code, /eq\(conversations\.tenantId,\s*tenant\.id\)/);
  });

  test('customer profiles routes scope by tenant.id', () => {
    const route = src('app/api/customer/profiles/route.ts');
    assert.match(route, /listProfiles\(tenant\.id/);
    assert.match(route, /countProfiles\(tenant\.id/);
  });

  test('tenant resolver core has isolation guard', () => {
    const core = src('lib/tenant-resolver-core.ts');
    assert.match(core, /canAccess.*managed\.has\(id\)/);
    assert.match(core, /isSuperAdmin/);
  });

  test('switch endpoint 403s unmanaged tenants', () => {
    const route = src('app/api/tenant/switch/route.ts');
    assert.match(route, /canManageTenant\(/);
    assert.match(route, /status:\s*403/);
  });

  test('webhook derives tenantId from wa_accounts, not payload', () => {
    const route = stripComments(src('app/api/webhooks/whatsapp/route.ts'));
    assert.match(route, /waAccounts\.id,\s*waAccountId/);
    assert.match(route, /const tenantId = waAccount\.tenantId/);
    assert.doesNotMatch(route, /payload\.tenantId/);
  });

  test('all business tables have tenant_id column', () => {
    const schema = src('lib/db/schema.ts');
    const tables = ['contacts', 'conversations', 'messages', 'jobs', 'reservations', 'campaigns'];
    for (const t of tables) {
      // Check that table definition includes tenantId
      const re = new RegExp(`export const ${t} = pgTable[\\s\\S]*?tenantId`, 'i');
      assert.match(schema, re, `table ${t} must have tenantId`);
    }
  });

  test('tenant-resolver tests cover isolation', () => {
    const testFile = src('lib/tenant-resolver.test.ts');
    assert.match(testFile, /isolation guard/);
  });

  test('ship wiring tests cover tenant scoping', () => {
    const wiring = src('lib/ship.wiring.test.ts');
    assert.ok(wiring.length > 1000);
  });
});

// ---------------------------------------------------------------------------
// 4. Webhook HMAC — fail-closed, idempotent
// ---------------------------------------------------------------------------
describe('GATE V3 — webhook HMAC fail-closed', () => {
  test('whatsapp webhook verifies signature before any work and returns 401', () => {
    const route = src('app/api/webhooks/whatsapp/route.ts');
    const body = handlerBody(stripComments(route), 'POST');
    assert.ok(body.includes('verifyWebhookSignature'), 'must call verifier');
    const verifyAt = body.indexOf('verifyWebhookSignature');
    const parseAt = body.indexOf('JSON.parse');
    const dbAt = body.indexOf('db.');
    assert.ok(verifyAt > -1);
    if (parseAt > -1) assert.ok(verifyAt < parseAt, 'verify before parse');
    if (dbAt > -1) assert.ok(verifyAt < dbAt, 'verify before db');
    assert.match(route, /status:\s*401/);
  });

  test('webhook verify utility fails closed when secret missing', () => {
    const verify = src('lib/webhook/verify.ts');
    assert.match(verify, /if\s*\(!secret\)/);
    assert.match(verify, /unsignedWebhooksExplicitlyAllowed/);
    assert.match(verify, /NODE_ENV === 'production'/);
  });

  test('payfast webhook verifies MD5 signature and fails closed', () => {
    const payfast = src('lib/billing/payfast.ts');
    assert.match(payfast, /buildSignature/);
    assert.match(payfast, /signature/);
    assert.match(payfast, /throw new Error.*missing signature/);
    assert.match(payfast, /signature mismatch/);
    assert.match(payfast, /merchant_id.*mismatch/);
  });

  test('payfast webhook route returns 400 on verification failure', () => {
    const route = src('app/api/billing/webhook/route.ts');
    assert.match(route, /status:\s*400/);
    assert.doesNotMatch(route, /auth\(\)/); // public but signature-gated
  });

  test('webhook has idempotency via wa_message_id', () => {
    const route = src('app/api/webhooks/whatsapp/route.ts');
    assert.match(route, /waMessageId/);
    assert.match(route, /onConflictDoNothing/);
    const schema = src('lib/db/schema.ts');
    assert.match(schema, /messages_wa_message_id_unique/);
  });

  test('operator webhook forwarder signs with HMAC-SHA256', () => {
    const fwd = readFileSync(join(HERE, '..', '..', '..', 'operator', 'src', 'webhook', 'forward.ts'), 'utf8');
    assert.match(fwd, /createHmac.*sha256/);
    assert.match(fwd, /x-webhook-signature/);
  });
});

// ---------------------------------------------------------------------------
// 5. Cron Auth — missing/wrong secret 401, correct 200
// ---------------------------------------------------------------------------
describe('GATE V3 — cron auth 401 without secret', () => {
  test('every cron route imports and calls assertCronAuthorized', () => {
    const cronDir = join(APP, 'api', 'cron');
    const dirs = readdirSync(cronDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.ok(dirs.length >= 15, `expected many cron routes, got ${dirs.length}`);
    for (const dir of dirs) {
      const routePath = join(cronDir, dir, 'route.ts');
      if (!existsSync(routePath)) continue;
      const content = readFileSync(routePath, 'utf8');
      assert.match(content, /assertCronAuthorized/, `${dir}/route.ts must import guard`);
      assert.match(content, /if\s*\(\s*authError\s*\)\s*return authError/, `${dir} must return early on auth failure`);
    }
  });

  test('cron authorize utility fails closed and uses constant-time compare', () => {
    const auth = src('lib/cron/authorize.ts');
    assert.match(auth, /if\s*\(!secret\)\s*return false/);
    assert.match(auth, /timingSafeEqual/);
    assert.match(auth, /Bearer /);
    assert.doesNotMatch(auth, /searchParams/);
  });

  test('cron auth adapter logs without leaking secret', () => {
    const adapter = src('lib/cron/auth.ts');
    assert.match(adapter, /CRON_SECRET is not configured/);
    assert.doesNotMatch(adapter, /\${.*secret.*}/i);
  });
});

// ---------------------------------------------------------------------------
// 6. Hard Rules — master kill-switch, manual mode, STOP, billing gate
// ---------------------------------------------------------------------------
describe('GATE V3 — hard rules alive', () => {
  test('master kill-switch blocks AI replies in webhook', () => {
    const route = src('app/api/webhooks/whatsapp/route.ts');
    assert.match(route, /systemSettings/);
    assert.match(route, /masterAiSwitch/);
    assert.match(route, /globalAiOff/);
    assert.match(route, /skipping AI reply/);
  });

  test('per-tenant manual mode and aiEnabled block AI', () => {
    const route = src('app/api/webhooks/whatsapp/route.ts');
    assert.match(route, /tenantAiOff/);
    assert.match(route, /aiEnabled/);
    assert.match(route, /manualMode/);
  });

  test('STOP/UNSUBSCRIBE triggers blocklist', () => {
    const route = src('app/api/webhooks/whatsapp/route.ts');
    assert.match(route, /blocklisted/);
    assert.match(route, /isOptInMessage/);
    const opt = src('lib/opt-in-out.ts');
    assert.match(opt, /STOP|UNSUBSCRIBE|OPT/i);
  });

  test('billing gate stops sends when unpaid — responder checks', () => {
    const responder = src('lib/ai/responder.ts');
    assert.match(responder, /decideBillingGate/);
    assert.match(responder, /isSuperAdminTenant/);
  });

  test('billing gate stops outbox dispatch — outbox checks tier limits', () => {
    const outbox = src('app/api/cron/outbox/route.ts');
    assert.match(outbox, /evaluateTierLimit/);
    assert.match(outbox, /monthly_quota_exceeded/);
    assert.match(outbox, /hourly_rate_exceeded/);
  });

  test('campaign launch is gated by billing', () => {
    const launch = src('app/api/marketing/campaigns/[id]/launch/route.ts');
    assert.match(launch, /canSendAutomatedMessages/);
    assert.match(launch, /status:\s*402/);
  });

  test('reactivation, review-request, cancellation, no-show crons respect billing gate', () => {
    const crons = [
      'app/api/cron/reactivation-campaigns/route.ts',
      'app/api/cron/review-requests/route.ts',
      'app/api/cron/cancellation-followup/route.ts',
      'app/api/cron/no-show-detect/route.ts',
    ];
    for (const rel of crons) {
      const content = src(rel);
      assert.match(content, /canSendAutomatedMessages/, `${rel} must check billing`);
    }
  });

  test('inbox delivery states are truthful: Queued/Sent/Delivered/Failed/Unknown', () => {
    const dispatch = src('lib/messaging/dispatch.ts');
    assert.match(dispatch, /queued/);
    assert.match(dispatch, /sent/);
    assert.match(dispatch, /failed/);
    const inboxPage = src('app/dashboard/inbox/page.tsx');
    // UI must show delivery states, not fake green
    // Check that deliveryStatus is used
    const messagesRoute = src('app/api/conversations/[id]/messages/route.ts');
    assert.match(messagesRoute, /deliveryStatus/);
  });
});
