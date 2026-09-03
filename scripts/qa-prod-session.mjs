#!/usr/bin/env node
/**
 * Mint a production Clerk session for the QA automation user — no password,
 * no email code, no browser. Output is shell-export lines for the API-level
 * production spec (tests/e2e/personas/whatsapp-qr-prod-api.spec.ts):
 *
 *   eval "$(CLERK_SECRET_KEY=sk_... node scripts/qa-prod-session.mjs)" && \
 *   BASE_URL=https://gemino-flavourly-whatsapp.vercel.app \
 *     npx playwright test tests/e2e/personas/whatsapp-qr-prod-api.spec.ts
 *
 * Why this exists (2026-09-03, first real production run): the deployed app
 * uses a dev-mode Clerk instance (pk_test/sk_test). @clerk/nextjs v5's
 * middleware on such an instance requires the cookie trio
 *   __session (session JWT), __client_uat (<= token iat), __clerk_db_jwt
 * (dev-browser token) — and the instance's "email verification at
 * sign-in" setting adds an email-code second factor that no automation
 * (and, with no mailbox on qa@flavourly.co.za, no human either) can pass.
 * The Backend-API-minted session sidesteps the whole sign-in UI.
 *
 * The FAPI domain is derived from the publishable key so this works for any
 * instance. Session and dev browser are ephemeral (1h); delete the session
 * afterwards with the printed command if you want it gone immediately.
 *
 * NOTE: sign_in_tickets would be the neatest primitive but the endpoint is
 * not available on this instance (404) — hence session + dev browser.
 */
const EMAIL = process.env.QA_EMAIL || 'qa@flavourly.co.za';
const SK = process.env.CLERK_SECRET_KEY;
const PK = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY;

if (!SK) {
  console.error('Need CLERK_SECRET_KEY in the environment (one-time, never committed).');
  process.exit(1);
}

// Derive the FAPI domain from the publishable key (base64url payload before
// the trailing $): "pk_test_<base64>..." decodes to "<slug>.clerk.accounts.dev".
function fapiFromPublishableKey(pk) {
  const m = /^pk_(test|live)_([A-Za-z0-9_-]+)/.exec(pk || '');
  if (!m) return null;
  const b64 = m[2].replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(b64, 'base64').toString('utf8').replace(/\$$/, '');
  } catch {
    return null;
  }
}

const api = (path, init = {}) =>
  fetch(`https://api.clerk.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

async function main() {
  // 1. Resolve the QA user id by email.
  const usersRes = await api(`/v1/users?email_address=${encodeURIComponent(EMAIL)}&limit=5`);
  if (!usersRes.ok) throw new Error(`user lookup -> ${usersRes.status}`);
  const users = await usersRes.json();
  const userId = users[0]?.id;
  if (!userId) throw new Error(`${EMAIL} not found — create the QA user first.`);
  console.error(`# QA user: ${userId} (${EMAIL})`);

  // 2. Create an active session + mint a 1h JWT.
  const sessRes = await api('/v1/sessions', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
  if (!sessRes.ok) throw new Error(`session create -> ${sessRes.status}`);
  const session = await sessRes.json();
  const tokRes = await api(`/v1/sessions/${session.id}/tokens`, {
    method: 'POST',
    body: JSON.stringify({ expires_in_seconds: 3600 }),
  });
  if (!tokRes.ok) throw new Error(`token mint -> ${tokRes.status}`);
  const { jwt } = await tokRes.json();

  // 3. Dev-browser token (required by dev-key instances alongside __session).
  const fapi = fapiFromPublishableKey(PK) || (jwt && JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).iss.replace(/^https?:\/\//, ''));
  if (!fapi) throw new Error('Could not derive the Clerk FAPI domain (set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).');
  const devRes = await fetch(`https://${fapi}/v1/dev_browser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!devRes.ok) throw new Error(`dev_browser -> ${devRes.status}`);
  const { token: devToken } = await devRes.json();

  console.log(`export QA_SESSION_JWT=${JSON.stringify(jwt)}`);
  console.log(`export QA_DEV_BROWSER_TOKEN=${JSON.stringify(devToken)}`);
  console.log(`export QA_SESSION_ID=${JSON.stringify(session.id)}`);
  console.error('# cleanup when done: curl -s -X DELETE -H "Authorization: Bearer $CLERK_SECRET_KEY" \\');
  console.error(`#   https://api.clerk.com/v1/sessions/${session.id}`);
}

main().catch((err) => {
  console.error('qa-prod-session failed:', err.message);
  process.exit(1);
});
