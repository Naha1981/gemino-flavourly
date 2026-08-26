# FLAVOURLY S1–S7 SHIP REPORT — session of 2026-08-26

Branch: `arena/01a03e8d-gemino-flavourly` · Commit `e406a7e` (local; push blocked — see Gate 6)

## Per-criterion results

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| S1 | /claim/[token] branding + "Not confirmed yet" + Sample badge; Re-scrape; inline enrichment w/ 10s timeouts + per-source try/catch | **PASS (code + unit/wiring)** | `ship.wiring.test.ts` S1 block (6 tests); `apps/main/app/claim/[token]/page.tsx` (always-render menu/hours, "Not confirmed yet", Sample badge); `google-places.ts` AbortSignal.timeout(10_000) ×2; scraper 10s AbortController |
| S2 | Redeem sets owner_user_id + memberships + cookie + `/dashboard?tenant=<id>` deep-link | **PASS (code + unit/wiring)** | `claim.ts` (ownerUserId, memberships insert onConflictDoNothing, dashboardDeepLink); `api/claim/redeem` + `claim/redeem` routes set `flavourly_active_tenant`; `ship.wiring.test.ts` S2 block |
| S3 | Already-claimed deep links to claimed tenant dashboard | **PASS (code + unit/wiring)** | `claim-states.tsx` (`redirect_url=/dashboard?tenant=<id>`, Go home href); `ship.wiring.test.ts` S3 block |
| S4 | tenant-resolver priority + isolation guard; TenantSwitcher; /api/tenant/switch 403; layout via resolver; schema + /api/migrate + drizzle 0019 | **PASS (code + unit tests)** | `tenant-resolver.test.ts` (21 tests: priority + isolation guard incl. SQLi-style junk); `ship.wiring.test.ts` S4 block; `drizzle/0019_tenant_memberships.sql` + journal + migrate route section 24 |
| S5 | cron-fleet.json (20 + hourly watchdog); canonical-fleet.ts fs-read; /api/admin/sync-crons (super-admin, CRONJOB_API_KEY, dedupe/stale delete, table); setup-cronjobs.mjs shares JSON | **PASS (code + unit tests)** | `canonical-fleet.test.ts` (18 tests: 20 jobs + watchdog, fs source, drift-guard vs embedded snapshot, route coverage vs /api/cron/*); `ship.wiring.test.ts` S5 block |
| S6 | Playwright E2E vs Vercel preview | **BLOCKED** | Suite implemented & parses (8 tests, `npx playwright test --list` = 8). Cannot execute: sandbox blocks Playwright browser CDN (TLS reset), Vercel/Clerk APIs (TLS reset), and provides no VERCEL_TOKEN/CLERK_SECRET_KEY/DATABASE_URL. Evidence of blockage: `curl https://cdn.playwright.dev` → SSL_ERROR_SYSCALL; `https://api.vercel.com` → SSL_ERROR_SYSCALL; `https://api.clerk.com` → SSL_ERROR_SYSCALL |
| S7a | test:main green | **PASS** | `npm run test:main` → **1277 pass / 0 fail** (306 suites), 2026-08-26 |
| S7b | tsc clean | **PASS** | `npx tsc --noEmit` in apps/main → exit 0 (post all edits) |
| S7c | next build clean | **PASS** | `next build` → "✓ Compiled successfully", 39/39 static pages, route table includes /api/admin/sync-crons, /api/cron/system-watchdog, /api/tenant/switch, /api/tenant/list, /claim/[token] (build log /tmp/nextbuild3.log) |
| S7d | PR opened | **FAIL — blocked** | `git push` rejected: "Invalid username or token" (sandbox credential helper injects placeholder token `arena-egress…`; GitHub API also returns 401 for every call incl. anonymous `api.github.com/rate_limit`). GitHub connection in this Arena session needs reconnecting |
| S7e | Preview green | **FAIL — blocked** | Requires push + Vercel integration (api.vercel.app TLS-blocked from sandbox) |

## THEN-ops (automated deployment steps) — status

| Step | Status | Blocker |
|------|--------|---------|
| 1. Vercel env set (CRONJOB_API_KEY + CRON_SECRET) + redeploy | **BLOCKED** | api.vercel.com TLS-reset in sandbox; VERCEL_TOKEN/VERCEL_ORG_ID/VERCEL_PROJECT_ID not provided (`<paste>` placeholders) |
| 2. Run production /api/migrate | **BLOCKED** | Needs deployed target + super-admin Clerk session (api.clerk.com TLS-reset) |
| 3. GET /api/admin/sync-crons → verify 20 jobs + watchdog | **BLOCKED** | Same as 1–2; api.cron-job.org also TLS-reset (only needed for later cron verification via cron-job.org API) |
| 4. curl /api/cron/process-prospects w/ Bearer CRON_SECRET | **BLOCKED** | *.vercel.app unreachable from sandbox |
| 5. Squash-merge only if all green | **NOT MERGED** (per rule — criteria without green evidence exist) | — |

## What ships in commit e406a7e (37 files, +3305/−194)

- S1–S5 implementation + 61 new unit/wiring tests (all green in the 1277 suite)
- S6 automation: `e2e/ship.spec.ts` (8 tests, zero-console-error assertions, failure screenshots via playwright config), `e2e/ship-seed.mjs` (Clerk Backend API + staff_members grant + prospects build API — zero manual steps), `e2e/contracts.spec.ts` (anonymous gates, CI-safe)
- CI: `.github/workflows/ci.yml` (Gate 1 on push/PR; dispatchable contract E2E with artifact upload)
- Ops tooling: `scripts/gen-fleet-snapshot.mjs`, `npm run fleet:snapshot`, `npm run test:e2e:seed`

## Exact missing credentials for the remaining gates

| Env var | Purpose | Status |
|---------|---------|--------|
| `VERCEL_TOKEN` | Vercel API (env vars, deploy) | placeholder `<paste>` — not provided |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | Vercel API targeting | not set |
| `CRONJOB_API_KEY` | cron-job.org fleet sync | placeholder `<paste>` — not provided |
| `DATABASE_URL` | E2E seeding (staff_members grant) | not set |
| `CLERK_SECRET_KEY` | E2E user/session automation | not set (readable from Vercel env once VERCEL_TOKEN works) |
| `CRON_SECRET` | cron bearer auth | **provided** ✓ |

Additionally required: an execution environment whose network permits
`api.vercel.com`, `*.vercel.app`, `api.clerk.com`, `api.cron-job.org`,
`cdn.playwright.dev` (this sandbox TLS-resets all five).
