import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * GATE QA-2 — wiring (source inspection, the repo's convention for
 * structure that runtime tests can't reach from plain `node --test`).
 *
 * Pinned here:
 *   1. schema/migration/runtime-DDL/pg-mem DDL all declare
 *      admin_notifications (four-way parity, same as every other table);
 *   2. the two cron routes are CRON_SECRET-gated and the sweep is
 *      strictly read-only;
 *   3. the alert pipeline owns dedupe/email/row semantics;
 *   4. the Super Admin portal renders the panel + unread badge + a
 *      super-admin-gated mark-read action;
 *   5. the fleet carries qa-sweep every 10 minutes;
 *   6. the persona suite takes credentials ONLY from env (never
 *      hardcoded), and the GitHub workflow runs it on PR + every 6h with
 *      report artifacts and failure alerts;
 *   7. the mobile drawer + logo gestures + bigger logo landed in the
 *      dashboard chrome (owner tasks 2–4).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..', '..');
const REPO = join(MAIN, '..', '..');

function read(rel: string): string {
  const p = join(MAIN, rel);
  assert.ok(existsSync(p), `missing file: ${rel}`);
  return readFileSync(p, 'utf8');
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const alertPolicy = read('lib/qa/alert-policy.ts');
const alerts = read('lib/qa/alerts.ts');
const alertRoute = read('app/api/cron/qa-alert/route.ts');
const sweepRoute = read('app/api/cron/qa-sweep/route.ts');
const adminPage = read('app/(app)/admin/page.tsx');
const adminActions = read('app/(app)/admin/actions.ts');
const notificationsPanel = read('components/admin-notifications.tsx');
const chrome = read('app/(app)/dashboard/dashboard-chrome.tsx');
const gesture = read('components/brand/admin-portal-gesture.tsx');
const themeMode = read('components/theme-mode.tsx');
const schema = read('lib/db/schema.ts');
const migration = read('drizzle/0024_admin_notifications.sql');
const migrateDdl = read('lib/db/migrate-ddl.ts');
const gateDdl = read('lib/gate-mock/ddl.sql');
const journal = JSON.parse(read('drizzle/meta/_journal.json'));
const fleet = JSON.parse(readFileSync(join(REPO, 'scripts', 'cron-fleet.json'), 'utf8'));
const playwrightConfig = readFileSync(join(REPO, 'playwright.config.ts'), 'utf8');
const workflow = readFileSync(join(REPO, '.github', 'workflows', 'qa-persona-suite.yml'), 'utf8');
const vercelJson = readFileSync(join(REPO, 'vercel.json'), 'utf8');
const personaHelpers = readFileSync(
  join(REPO, 'tests', 'e2e', 'personas', 'persona-helpers.ts'),
  'utf8'
);
const personaSpec = readFileSync(join(REPO, 'tests', 'e2e', 'personas', 'personas.spec.ts'), 'utf8');

describe('QA-2 — admin_notifications four-way DDL parity', () => {
  test('schema declares the table with severity/check/message/report_url/read_at', () => {
    const code = stripComments(schema);
    const at = code.indexOf('export const adminNotifications = pgTable(');
    assert.ok(at > -1, 'adminNotifications missing from schema.ts');
    const table = code.slice(at);
    assert.match(table, /text\('severity',\s*\{\s*enum:\s*\['info',\s*'warning',\s*'critical'\]/);
    assert.match(table, /text\('check'\)\.notNull\(\)/);
    assert.match(table, /text\('message'\)\.notNull\(\)/);
    assert.match(table, /text\('report_url'\)/);
    assert.match(table, /timestamp\('read_at'\)/);
  });

  test('drizzle 0024 migration mirrors the schema and the journal lists it', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_notifications/);
    assert.match(migration, /severity text DEFAULT 'info' NOT NULL/);
    assert.match(migration, /"check" text NOT NULL/);
    assert.ok(
      journal.entries.some((e: { tag: string }) => e.tag === '0024_admin_notifications'),
      'journal has no 0024_admin_notifications entry'
    );
  });

  test('runtime /api/migrate DDL (section 29) + pg-mem gate DDL both create the table', () => {
    assert.match(migrateDdl, /29\.\s*GATE QA-2 — Super Admin notification inbox/);
    assert.match(migrateDdl, /CREATE TABLE IF NOT EXISTS admin_notifications/);
    assert.match(gateDdl, /CREATE TABLE IF NOT EXISTS admin_notifications/);
    assert.match(gateDdl, /admin_notifications_check_created_idx/);
  });
});

describe('QA-2 — cron routes: auth + read-only sweep', () => {
  test('both routes fail closed through assertCronAuthorized (CRON_SECRET bearer)', () => {
    for (const route of [alertRoute, sweepRoute]) {
      assert.match(route, /assertCronAuthorized/);
    }
  });

  test('the smoke sweep is READ-ONLY: no business-data writes anywhere in it', () => {
    const code = stripComments(sweepRoute);
    assert.doesNotMatch(code, /db\.insert/, 'sweep must not insert');
    assert.doesNotMatch(code, /db\.update/, 'sweep must not update');
    assert.doesNotMatch(code, /db\.delete/, 'sweep must not delete');
    assert.doesNotMatch(code, /seedDemoData/, 'sweep must never seed');
    // Its only side channel is the alert pipeline itself.
    assert.match(code, /dispatchQaAlert/);
  });

  test('the sweep performs every owner-specified check', () => {
    const code = stripComments(sweepRoute);
    for (const needle of [
      '/pricing',
      '/sign-in',
      '/api/health',
      '/dashboard',
      '/admin',
      'checkHealth', // operator /health = the Render keep-alive ping
      'SELECT 1',
      'verifyWebhookSignature', // HMAC self-test
      'resolveStoredCronJobApiKey', // cron fleet enabled
    ]) {
      assert.ok(code.includes(needle), `sweep must include ${needle}`);
    }
  });

  test('critical failures flip the sweep to 503; warnings alert but stay 200', () => {
    const code = stripComments(sweepRoute);
    assert.match(code, /critical: true/);
    assert.match(code, /critical: false/);
    assert.match(code, /criticalOk \? 200 : 503/);
  });

  test('alert ingestion route validates body shape and severity enum', () => {
    const code = stripComments(alertRoute);
    assert.match(code, /check/);
    assert.match(code, /message/);
    assert.match(code, /SEVERITIES/);
    assert.match(code, /dispatchQaAlert/);
  });
});

describe('QA-2 — alert pipeline semantics', () => {
  test('dedupes by check name within 6 hours before inserting', () => {
    const policy = stripComments(alertPolicy);
    assert.match(policy, /QA_ALERT_DEDUPE_WINDOW_MS = 6 \* 60 \* 60 \* 1000/);
    const code = stripComments(alerts);
    const dedupeAt = code.indexOf('dispatchQaAlert');
    const insertAt = code.indexOf('insert(adminNotifications)');
    const selectAt = code.indexOf('.from(adminNotifications)');
    assert.ok(dedupeAt > -1 && insertAt > -1, 'dispatch + insert must exist');
    // The dedupe SELECT must run BEFORE the insert in the dispatch flow.
    assert.ok(selectAt > -1 && selectAt < insertAt, 'dedupe query must precede the insert');
  });

  test('email leg: Resend REST, mockable transport, never throws into the row insert', () => {
    const policy = stripComments(alertPolicy);
    assert.match(policy, /api\.resend\.com\/emails/);
    assert.match(policy, /QA_ALERT_EMAIL_TRANSPORT === 'mock'/);
    assert.match(policy, /skipped_no_key/);
    // The insert happens BEFORE the email send: the portal row is the
    // guaranteed channel even when email fails.
    const code = stripComments(alerts);
    const insertAt = code.indexOf('insert(adminNotifications)');
    const emailAt = code.indexOf('sendQaAlertEmail(buildAlertSubject');
    assert.ok(insertAt > -1 && emailAt > -1 && insertAt < emailAt, 'row insert must precede email send');
  });

  test('dispatch never throws (a broken DB must not silence the alarm)', () => {
    const code = stripComments(alerts);
    assert.match(code, /catch \(err: any\) \{[\s\S]*?insert-failed/);
  });
});

describe('QA-2 — Super Admin portal rendering', () => {
  test('portal reads notifications + unread count (degrading, never blocking)', () => {
    const code = stripComments(adminPage);
    assert.match(code, /listRecentAdminNotifications/);
    assert.match(code, /countUnreadAdminNotifications/);
  });

  test('unread badge + panel are rendered with stable test ids', () => {
    assert.match(adminPage, /data-testid="qa-unread-badge"/);
    assert.match(adminPage, /data-severity|qa-notifications/);
    assert.match(notificationsPanel, /data-testid="qa-notifications-panel"/);
    assert.match(notificationsPanel, /data-testid="qa-notifications-mark-read"/);
    assert.match(notificationsPanel, /data-testid="qa-notification-row"/);
  });

  test('mark-all-read is a server action re-checked against isSuperAdmin', () => {
    const code = stripComments(adminActions);
    const at = code.indexOf('markNotificationsReadAction');
    assert.ok(at > -1, 'markNotificationsReadAction missing');
    const action = code.slice(at);
    assert.match(action, /isSuperAdmin\(\)/);
    assert.match(action, /markAllAdminNotificationsRead/);
  });
});

describe('QA-2 — cron fleet + scheduling (cron-job.org, NEVER vercel.json)', () => {
  test('fleet carries qa-sweep every 10 minutes with cron-secret auth', () => {
    const job = fleet.jobs.find((j: { key: string }) => j.key === 'qa-sweep');
    assert.ok(job, 'qa-sweep job missing from scripts/cron-fleet.json');
    assert.equal(job.auth, 'cron-secret');
    assert.deepEqual(job.schedule.minutes.sort(), [0, 10, 20, 30, 40, 50]);
    assert.match(job.url, /\{baseUrl\}\/api\/cron\/qa-sweep/);
  });

  test('vercel.json declares no crons (owner spec: schedule on cron-job.org)', () => {
    assert.doesNotMatch(vercelJson, /crons/i);
  });

  test('GitHub workflow: PR + every-6h schedule, report artifacts, failure alert', () => {
    assert.match(workflow, /pull_request/);
    assert.match(workflow, /cron: '20 \*\/6 \* \* \*'/);
    assert.match(workflow, /actions\/upload-artifact@v4/);
    assert.match(workflow, /api\/cron\/qa-alert/);
    assert.match(workflow, /if: failure\(\)/);
    // The GATE_MOCK job always runs; production is secrets-gated.
    assert.match(workflow, /GATE_MOCK: '1'/);
    assert.match(workflow, /secrets\.QA_EMAIL/);
    assert.match(workflow, /secrets\.QA_PASSWORD/);
  });
});

describe('QA-2 — persona suite discipline', () => {
  test('credentials come ONLY from env vars (QA_EMAIL / QA_PASSWORD), never literals', () => {
    assert.match(personaHelpers, /process\.env\.QA_EMAIL/);
    assert.match(personaHelpers, /process\.env\.QA_PASSWORD/);
    // No hardcoded credential-looking literals anywhere in the suite.
    const specFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|mjs)$/.test(entry.name)) specFiles.push(p);
      }
    };
    walk(join(REPO, 'tests', 'e2e'));
    for (const file of specFiles) {
      const src = readFileSync(file, 'utf8');
      assert.doesNotMatch(
        src,
        /(password|secret)\s*[:=]\s*['"][^'"\n]{6,}['"]/i,
        `${file}: suspicious hardcoded credential`
      );
    }
  });

  test('playwright config discovers both spec trees', () => {
    assert.match(playwrightConfig, /tests\/e2e\/\*\*\/\*\.spec\.ts/);
    assert.match(playwrightConfig, /e2e\/\*\*\/\*\.spec\.ts/);
  });

  test('the six owner-specified personas are all covered', () => {
    for (const persona of ['visitor', 'newOwner', 'returningOwner', 'prospectMagicLink', 'superAdmin', 'tenantBNegative']) {
      assert.ok(personaSpec.includes(`'${persona}'`), `persona ${persona} missing from the suite`);
    }
  });
});

describe('QA-2 — dashboard chrome: logo, drawer, gestures (owner tasks 2–4)', () => {
  test('logo is bigger (h-12 sidebar / h-9 mobile) with the admin gesture mounted', () => {
    const code = stripComments(chrome);
    assert.match(code, /<LogoChip className="h-12" \/>/);
    assert.match(code, /<LogoChip className="h-9" \/>/);
    // Three gesture mounts: sidebar, mobile header, drawer header.
    assert.equal((code.match(/<AdminPortalGesture/g) ?? []).length, 3);
    const chip = stripComments(themeMode);
    assert.match(chip, /className = 'h-11'/);
  });

  test('hamburger drawer exposes EVERY sidebar destination + tenant switcher + account', () => {
    const code = stripComments(chrome);
    assert.match(code, /data-testid="mobile-menu-button"/);
    assert.match(code, /aria-label="Main menu"/);
    assert.match(code, /aria-modal="true"/);
    // The drawer maps over the SAME SIDEBAR_LINKS array as the sidebar.
    const drawerAt = code.indexOf('role="dialog"');
    assert.ok(drawerAt > -1);
    const drawer = code.slice(drawerAt);
    assert.match(drawer, /SIDEBAR_LINKS\.map/);
    assert.match(drawer, /<TenantSwitcher/);
    assert.match(drawer, /<UserButton/);
    // ESC + body-scroll lock + route-change close.
    assert.match(code, /'Escape'/);
    assert.match(code, /document\.body\.style\.overflow/);
    assert.match(code, /setDrawerOpen\(false\)/);
  });

  test('drawer shows the Super Admin entry only behind the server-computed adminHint', () => {
    const code = stripComments(chrome);
    assert.match(code, /adminHint &&/);
    assert.match(code, /data-testid="drawer-admin-link"/);
  });

  test('the gesture component implements 3s touch-hold + double-click, mouse excluded', () => {
    const code = stripComments(gesture);
    assert.match(code, /ADMIN_GESTURE_HOLD_MS = 3000/);
    assert.match(code, /onDoubleClick/);
    assert.match(code, /pointerType === 'mouse'/);
    assert.match(code, /router\.push\('\/admin'\)/);
  });

  test('layout computes adminHint WITHOUT a Clerk API call (staff-row fast path only)', () => {
    const layout = stripComments(read('app/(app)/dashboard/layout.tsx'));
    assert.match(layout, /staffMembers\.role, 'super_admin'/);
    assert.doesNotMatch(layout, /clerkClient/, 'layout must not make a Clerk API call per render');
  });
});
