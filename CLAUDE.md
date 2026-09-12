# CLAUDE.md — Agent Instructions (gemino-flavourly)

Mirror of `.cursorrules` for Claude Code sessions. The constitution is
`docs/NAHALABS_ENGINEERING_STANDARD.md` — read it before any code changes.

## Repo facts (verify, never assume)

- `apps/main` = Next.js 14 (App Router) + Tailwind + Drizzle, deployed on **Vercel**.
- WhatsApp transport is **not** hosted in this repository. Gemino is a consumer of the shared NahaLabs WhatsApp Operator at `https://my-own-whatsapp-2z5h.onrender.com`.
- Database: Neon Postgres via `DATABASE_URL`. Production migrations run through `GET /api/migrate` (super-admin gated) — NOT drizzle-kit.
- Auth: Clerk (`pk_`/`sk_` keys, sign-in `/sign-in`, sign-up `/sign-up`, post-auth `/dashboard`). Public pages must survive with NO Clerk config (see `lib/auth/route-guard-core.ts`).
- Cron: **NEVER `vercel.json` cron.** The canonical fleet is `scripts/cron-fleet.json` (mirrored into `lib/cron/canonical-fleet.embedded.ts` via `node scripts/gen-fleet-snapshot.mjs`); every `/api/cron/*` route must call `assertCronAuthorized`.
- Tests: `npm run test:main`. Typecheck: `npx tsc --noEmit`. Build: `next build`.

## WhatsApp architecture (critical)

Gemino owns business/application logic: tenants, authentication, CRM, conversations, AI, approvals, billing, campaigns, STOP/START, manual takeover, and the outbox.

The central NahaLabs WhatsApp Operator owns transport: WhatsApp sessions, Baileys sockets, QR and phone-number pairing, connection lifecycle, outbound delivery, and signed inbound webhooks.

Gemino communicates with it only through the server-side client in `apps/main/lib/whatsapp/central-operator.ts`.

Gemino MUST NOT:
- import `@whiskeysockets/baileys`;
- create `makeWASocket()` or another WhatsApp socket;
- maintain a WhatsApp socket registry;
- generate or persist its own WhatsApp QR;
- add another WhatsApp server/provider.

Gemino's local `wa_accounts.id` is not the central Operator `waAccountId`. The mapping is maintained in the existing `wa_account_bindings` table and resolved server-side from the authenticated tenant.

## Session protocol

1. Read `worklog.md` if present, recent git history, relevant docs, and tests before editing.
2. Pick one bounded gate and declare objective/scope/non-goals in the PR.
3. Fail closed: missing secret = deny; invalid webhook = reject; no production backdoors.
4. Evidence before done: run the full main test suite, `npx tsc --noEmit`, and `next build`.
5. Never commit secrets or `.env` files.

## Gate report format

```markdown
# GATE REPORT: [Gate Name]
## Objective & Scope
## Baseline
## Files Changed
## Evidence Table
| Check | Result |
|---|---|
| Tests | Pass/Fail |
| Typecheck/Lint | Pass/Fail |
| Build | Pass/Fail |
| WhatsApp Seam | Pass/Fail |
## Defects Fixed / Architecture Decisions
## Remaining Risks / Non-Goals Deferred
## Commit & Remote Verification
## Verdict: PASS / FAIL / CONDITIONAL PASS
```
