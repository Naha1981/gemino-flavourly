# CLAUDE.md — Agent Instructions (gemino-flavourly)

Mirror of `.cursorrules` for Claude Code sessions. The constitution is
`docs/NAHALABS_ENGINEERING_STANDARD.md` — read it before any code changes.

## Repo facts (verify, never assume)

- Monorepo: `apps/main` = Next.js 14 (App Router) + Tailwind + Drizzle, deployed on **Vercel**. `operator/` = Express + Baileys (WhatsApp Web), deployed on **Render** (root directory `operator`).
- Database: Neon Postgres via `DATABASE_URL`. Production migrations run through `GET /api/migrate` (super-admin gated) — NOT drizzle-kit.
- Auth: Clerk (`pk_`/`sk_` keys, sign-in `/sign-in`, sign-up `/sign-up`, post-auth `/dashboard`). Public pages must survive with NO Clerk config (see `lib/auth/route-guard-core.ts`).
- Cron: **NEVER `vercel.json` cron.** The canonical fleet is `scripts/cron-fleet.json` (mirrored into `lib/cron/canonical-fleet.embedded.ts` via `node scripts/gen-fleet-snapshot.mjs`); every `/api/cron/*` route must call `assertCronAuthorized`.
- Tests: `npm run test:main` (apps/main), `npm run test:operator`. Typecheck: `npx tsc --noEmit` in each workspace. Build: `next build`.

## Session protocol

1. **Phase 0 first (Iron Rule 1):** read the worklog (`worklog.md` if present), `git log --oneline -10`, `git status`, the relevant `docs/` reports, and the tests around the area you will touch. Read-only.
2. **Bounded gates (Iron Rule 2):** pick ONE gate. Write its Objective / Scope / Non-Goals in the PR description. Do not absorb extra scope silently — list it as deferred.
3. **Conventions:** logic/store split (pure module + `-store.ts` Drizzle adapter + thin route); additive migrations mirrored in `lib/db/migrate-ddl.ts` and the drizzle journal; every new cron route joins the canonical fleet and regenerates the snapshot.
4. **Money/state rules are deterministic (Iron Rule 4):** ledgers use idempotency keys (`ref_id` unique indexes); AI never computes balances, distances, or prices.
5. **Fail closed (Iron Rule 3):** missing secret = deny; unknown webhook signature = reject; no dev backdoors in production paths.
6. **Evidence before "done" (Iron Rule 9):** run the full suites, `tsc --noEmit` in both workspaces, and `next build`. Paste counts and exit codes into the gate report — numbers, not adjectives.
7. **Secrets (§3.5 of the standard):** never commit `.env*`, keys, or tokens. If a secret appears in a paste/chat, treat it as compromised and say so.
8. **Stop conditions (§5 of the standard):** production deletion, provider swaps, or scope expansion → STOP and ask the owner.

## Gate report format (mandatory at task end)

```markdown
# GATE REPORT: [Gate Name]
## Objective & Scope
## Baseline (Branch, Local SHA, Remote SHA sync status)
## Files Changed (and explicitly what was NOT changed)
## Evidence Table
| Check | Result |
|---|---|
| Tests (Count) | Pass/Fail |
| Typecheck/Lint | Pass/Fail |
| Build | Pass/Fail |
| Security/Seam Test | Pass/Fail |
## Defects Fixed / Architecture Decisions
## Remaining Risks / Non-Goals Deferred
## Commit & Remote Verification (SHA proof)
## Verdict: PASS / FAIL / CONDITIONAL PASS
```

## Where things live

| Thing | Path |
|---|---|
| Constitution | `docs/NAHALABS_ENGINEERING_STANDARD.md` |
| Build program (16 rows) | `docs/PROGRAM.md` |
| Feature status (30 rows) | `docs/FEATURE_MATRIX.md` |
| Product law (pages & proof) | `docs/PRODUCT_MAP.md` |
| WhatsApp 2-server architecture | `WHATSAPP_ARCHITECTURE.md` |
| Decisions (ADRs) | `docs/decisions/` |
| Cron fleet | `scripts/cron-fleet.json` |
| Migration parity tests | `apps/main/lib/db/migrate-parity.test.ts` |
