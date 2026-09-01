# GATE REPORT — QA-2: Self-Testing App + Failure Alerts, Owner Demo Experience, Mobile & Logo

**Repo:** Naha1981/gemino-flavourly · **Branch:** `feat/qa2-selftesting-mobile` (off `origin/main` @ 9226cc5)
**Owner requests covered (2026-09-01 message):** 1) verify the WhatsApp QR works well · 2) seed-filled dashboards for naha.thabiso@gmail.com + Super Admin portal behind logo double-click / 3-second mobile long-press with a demo↔live toggle inside the portal · 3) bigger, clearly readable app logo · 4) mobile optimization with a dropdown menu exposing every feature · 5) Render keep-alive (10-minute ping) · 6) GATE QA-2 (persona suite, smoke sweep, scheduled runs, alert pipeline, PR-only ship).
**Principle:** EVIDENCE OVER NARRATIVE — every claim below was reproduced against running systems before it was written.

---

## TASK 1 — "Check if the QR code for WhatsApp works well" — ✅ PASS

### What was verified

| Layer | Assertion | Evidence |
|---|---|---|
| Unit — client policy | Freshness phases, auto-kick rate limits, engine-error persistence | `lib/whatsapp/qr-freshness.test.ts` 12/12 (unchanged, green) |
| Unit — operator engine | Linking-phase backoff caps (15s), zombie-socket eviction, never-evict guards | `operator/test/linking-policy.test.ts` 10/10 via `test:operator` 69/69 |
| Unit — route wiring | `/api/whatsapp/status` + `/connect` must provision legacy tenants | `lib/whatsapp/wiring.test.ts` 2/2 |
| Browser — render + decode | **jsQR decoded the rendered 288×288 canvas** (237-char pairing payload `2@…`) — machine-readable = phone-scannable, the same proof the 2026-08-31 gate used against a live Baileys socket | `qa2-artifacts/qr-decode.json` + `qr-decode-1.png` |
| Browser — auto-refresh | Decoded payload **CHANGED** across a 22s window (`2@000002…` → `2@000003…`), page phase stayed `fresh` — the "new one every ~20s" contract is live | same |
| Live — production operator | `GET /health` → **200 OK in 1.64s** (awake, healthy); `/status` without key → **401** (auth intact) | curl logs in session transcript |
| Live — production app | Landing 200, `/api/health` 200 | curl |

### Defect found and fixed while verifying (real, shipped in this PR)

The status route only echoed the **DB** row, but pairing codes rotate every ~20s and the operator persists them on its own cadence — a poll could serve a stale code. Now, while an account is NOT connected, `/api/whatsapp/status` **merges the operator's live `/status` snapshot** (bounded: `operatorClient.getStatus` gained a 5s `AbortSignal.timeout`, so a slow engine can never hang the 3s poll — unreachable engine falls back to the DB row, the round-2 behaviour). This is what made the rotation proof above possible end-to-end, and it keeps the displayed code as fresh as the engine itself in production.

**Owner action after merge:** none required for QR. (A real phone scan is by nature a human step; the machine-scannability + cadence + recovery paths are what code can prove, and they are green.)

---

## TASK 2 — Demo/seed dashboards + Super Admin portal gestures — ✅ PASS

### What was built

1. **Portal gestures (owner spec):** the app logo now opens the Super Admin portal on **double-click (desktop)** and **3-second press-and-hold (mobile)** — shared component `components/brand/admin-portal-gesture.tsx`, mounted on the dashboard sidebar logo, the mobile header logo, the drawer header logo, and the landing logo. Mouse presses are excluded (mouse users have dblclick); finger drift >12px cancels the hold; the browser's long-press context menu is suppressed while holding. `/admin` still fails closed through its own `isSuperAdmin()` guard, so the gesture grants nothing by itself (same model the landing dblclick has shipped since the Stitch redesign).
2. **Toggle inside the portal:** switching Demo Mode ON now first POSTs the new **`/api/admin/demo-view`** route — super-admin gated (403 otherwise), idempotent — which **loads the busy-restaurant seed (The Grand Bistro + 6 platform tenants, deadbeef-prefixed)** if it is not already loaded. The toggle then flips the proven view cookie + `router.refresh()`. Result: "toggle Demo ON" always means *a filled, busy-restaurant dashboard* — never an amber banner over empty live data. Switching OFF returns to live views; the wipe tool stays separate.
3. **Only for naha.thabiso@gmail.com:** the demo view remains fail-closed through `isSuperAdmin()` (cookie fast-path + ADMIN_EMAIL/staff-row verification), seed rows are only included in views while Demo Mode is ON, and live queries exclude `deadbeef-` rows (UI-3R F2 contract, unchanged).
4. **Mobile drawer "Super Admin" entry:** shown only when the server cheaply determined the user may be a super admin (`adminHint`: demo cookie active OR a `super_admin` staff row — deliberately **no** Clerk API call, which would add an external round-trip to every dashboard render).

### Evidence

- e2e (`personas.spec.ts`, GATE_MOCK harness): `demo/live toggle lives inside the portal and switches the view` — banner appears within the assert window, KPIs flip to seed values, banner disappears on switch-back. Screenshots `super-admin-demo-mode-on.png` / `-off.png`.
- e2e: `desktop logo gesture: double-click opens the portal` + `mobile logo gesture: 3-second press-and-hold opens the portal` (URL reaches `/admin`; screenshot `super-admin-via-long-press.png`).
- e2e: tenant B has **no** drawer admin entry and is bounced from `/admin` (negative).
- VLM review of `super-admin-demo-mode-on.png`: amber "DEMO DATA — you are viewing deterministic seed data" banner with "Switch to Live Data" button — PASS.
- Unit: `demo-mode.wiring.test.ts` 11/11 (toggle→ensure-seed contract, route gate, fail-closed structure).

---

## TASK 3 — Bigger, readable logo — ✅ PASS

`LogoChip` default height h-9 → **h-11** with enlarged surface padding + subtle ring; the dashboard **sidebar** renders **h-12** (48px — the 579×357 wordmark shows ~78px wide, comfortably readable) and the **mobile header h-9** (up from h-7). Brand wiring contract preserved (`src='/logo.png'` default, `<img src={src}>`). VLM review of the drawer screenshot: *"Top-left logo is visible and legible — PASS."*

## TASK 4 — Mobile optimization + full dropdown menu — ✅ PASS

The mobile header gained a hamburger (`data-testid="mobile-menu-button"`, 40px touch target) opening a **full-navigation drawer**: every one of the 16 sidebar destinations (same `SIDEBAR_LINKS` array — they can never drift), the **tenant switcher**, the **account/UserButton** controls (previously unreachable on mobile), and the conditional Super Admin entry. Drawer behaviour: backdrop tap + ESC + route-change close, body scroll lock, focus on the close button, `role="dialog" aria-modal`. The 5-item bottom bar stays as the quick path.

**Evidence:** e2e `mobile: hamburger drawer exposes EVERY feature + account` asserts all 16 links are present, then **navigates to Billing through the drawer** (`returning-owner-mobile-billing-via-drawer.png`). VLM review: nav items PASS, logo PASS, account row present; the only note was the mock persona email rendering with an ellipsis (long mock address, cosmetic).

## TASK 5 — Render keep-alive — ✅ PASS

- The **QA Smoke Sweep fleet job** (`scripts/cron-fleet.json`, canonical job #23) runs **every 10 minutes** against `/api/cron/qa-sweep`, whose operator `/health` probe pings the Render service — the owner-spec keep-alive. The pre-existing `keep-operator-awake` job (every 5 min) continues unchanged; the two are complementary.
- Scheduling lives on **cron-job.org — never `vercel.json`** (the repo's vercel.json deliberately declares no crons; pinned by a wiring test). One-click setup: `/admin` → Cron Fleet Manager → Sync fleet (24 canonical jobs).
- Live proof the operator is currently healthy: `/health` 200 in 1.64s.
- Honest caveat (documented in `docs/qa2/SETUP.md`): pings are a workaround, not officially supported by Render's free tier; a paid plan is the only guaranteed always-on option.
- Setup guide (cron-job.org steps, GitHub secrets, Vercel vars, how to read failures): `docs/qa2/SETUP.md`.

---

## TASK 6 — GATE QA-2 — Self-testing app + failure alerts — ✅ PASS

### 1. Playwright persona suite (`tests/e2e/`)

Six personas, exactly the owner's list — visitor, new owner (Tenant C: QR-connect journey), returning owner (Tenant A: **every nav item**, 23 routes including the not-in-sidebar loyalty/waitlist/opportunities/positioning/reactivation), prospect magic-link (public claim contract + gated redeem), super admin (portal, notifications, demo toggle, gestures), tenant-B negative (cross-tenant API 404 + no data leakage + no admin access). Every visit asserts: HTTP 200, real visible content, **zero console errors** (filtered list documented), screenshot. Credentials for production runs come **only** from `QA_EMAIL`/`QA_PASSWORD` env vars — never hardcoded; a wiring test source-scans the suite for credential-looking literals. **Result: 53/53 green** (34.9s, GATE_MOCK build).

*Dev-mode note:* the first run (against `next dev`) produced console-error noise (React hydration warnings) on 4 pages under `fullyParallel` cold-compile contention; a direct probe of the built page showed **zero** errors. The harness and CI therefore run against a **GATE_MOCK production build** (`next build` + `next start`) — identical to the GitHub Actions job. Zero flaky tests in the final 3 consecutive runs.

### 2. In-app smoke sweep — `GET /api/cron/qa-sweep` (CRON_SECRET bearer)

Read-only checks, exactly the owner's list: key routes 200 (landing/pricing/sign-in/api-health), auth gating (production redirect shape AND the gate-mock Clerk-protect 404 shape both accepted — the J2.2-pinned semantics), operator `/health` (the keep-alive ping), DB ping (`SELECT 1`), webhook HMAC self-test (real crypto both directions: valid signature accepted, tampered payload rejected), cron fleet enabled (best-effort against cron-job.org with the stored key). Critical failures → HTTP 503 + alert; warnings (operator, fleet) → alert, 200. The route is **read-only by construction** — a wiring test pins it contains no `db.insert/update/delete` and no `seedDemoData`.

### 3. Scheduled full runs — `.github/workflows/qa-persona-suite.yml`

On **every PR**: the full persona suite against a GATE_MOCK build (always runs, zero secrets). Every **6 hours** (schedule, offset to :20): plus a **production run** (read-only by design) when the `QA_EMAIL`/`QA_PASSWORD`/`CRON_SECRET` secrets exist — signed-in journeys **skip loudly** rather than silently pass when secrets are absent. **HTML report + screenshots uploaded as artifacts on every run** (30-day retention).

### 4. Alert pipeline (the core ask)

`lib/qa/alert-policy.ts` (pure: subject/body/dedupe/transport — unit-tested) + `lib/qa/alerts.ts` (db leg) + `POST /api/cron/qa-alert` (CRON_SECRET-gated ingestion for GitHub Actions):

- **Email** to naha.thabiso@gmail.com via Resend — subject exactly `Flavourly QA broken: <check>`, body = failing check + evidence/report link. `RESEND_API_KEY` unset → recorded `skipped_no_key` (the portal row remains the always-on channel); mockable via `QA_ALERT_EMAIL_TRANSPORT=mock` for tests.
- **admin_notifications row** (severity, check, message, report_url, created_at) rendered in the **Super Admin portal** with an **unread badge** (`N unread alerts`) and a super-admin-gated "Mark all read" server action. New table: four-way DDL parity (schema.ts / drizzle `0024_admin_notifications.sql` / `/api/migrate` section 29 / pg-mem gate DDL).
- **Dedupe:** same check → one alert per 6h, not per run (pure decision unit-tested: 10min-ago dedupes, 6h1m-ago does not).
- **Ordering guarantee:** the notification row lands BEFORE the email send (portal never depends on Resend being up); dispatch never throws (a broken DB must not silence the alarm).
- GitHub Actions posts failures to `/api/cron/qa-alert` with the run URL as the report link.

### 5. Failing-first evidence (owner spec: "inject fake failure → assert email mock + notification row created")

| Run | Target | Result |
|---|---|---|
| **RED** | `tests/e2e/personas/qa2-alerts.spec.ts` against an **unmodified origin/main** GATE_MOCK build (git worktree, port 3101) | **8/8 FAILED** (route 404s, panel testids absent) — exit 1 |
| **GREEN** | same spec against this branch | **all pass**: POST qa-alert → `{dispatched:true, emailStatus:'mock-sent'}`; alert renders in `/admin` with unread badge + `data-unread="true"`; second POST same check → `{dispatched:false, reason:'deduped'}`; missing fields → 400; wrong secret → 401; mark-all-read clears the badge; sweep happy path + bad-secret 401 |

### 6. Safety — honoured

Sweep read-only (pinned by test); persona writes only to the in-memory GATE_MOCK QA database; production runs are read-only (no write-button flows); no real WhatsApp sends (the mock operator serves the contract — no Baileys sockets are opened by the suite); no PayFast live; no deletes of production data; credentials env-only (source-scanned); auth/magic-link claim flow/pricing/cron fleet logic untouched.

---

## Full verification matrix

| Suite | main (before) | this branch |
|---|---|---|
| `node --test apps/main/lib/**` | 1852 | **1896/1896** (+44: 17 alert unit, 25 QA-2 wiring, 2 demo-toggle wiring) |
| `tsc --noEmit` (main) | clean | **clean** |
| `next build` GATE_MOCK=1 | — | **green, 41/41 pages** |
| `next build` (normal, dummy DATABASE_URL) | green | **green, 41/41 pages** |
| `test:operator` | 69 | **69/69** |
| Persona suite (GATE_MOCK build) | 8/8 alert spec red (worktree) | **53/53 green** |
| QR decode + rotation proof | — | **PASS** (jsQR, 237-char payload, rotates) |
| Regression: mock specs (app T1/T3 + operator-health) | — | **4/4** |
| Regression: production contracts (read-only) | 5 stale failures | **11/11** |
| VLM visual review (drawer, portal, QR, demo banner) | — | **PASS** (one cosmetic ellipsis note) |

**Stale pins updated with justification** (each documented in-code): fleet job counts 22→23 (canonical-fleet, ship.wiring); journal-latest tag → 0024 (market schema wiring); MIGRATE_TABLES += admin_notifications (parity); `contracts.spec`/`magic-link.spec` anonymous API gates now allow **404** — Clerk v5 `protect()` answers anonymous API calls with 404 (semantics pinned since gate V4/V5 J2.2; the specs predated it and were failing against production); app.spec Test 2 excluded from the GATE_MOCK leg only (needs the real Clerk DOM — documented since UI-5) and covered by the production leg.

## Secrets discipline

`.env.local` is gitignored (verified); the only new env surface is documented placeholders in `.env.example` (`RESEND_API_KEY`, `QA_ALERT_TO`, `QA_ALERT_FROM`, `QA_ALERT_EMAIL_TRANSPORT` [DEV ONLY], `CRONJOB_API_KEY`, `QA_EMAIL`/`QA_PASSWORD` [CI only, commented]). Full-diff scan before push found no credential values. The QA harness runs on placeholder env + pg-mem; the production operator was only touched with read-only GET probes.

## Open items for the owner (after merge)

1. **Vercel:** add `RESEND_API_KEY` (recommended — email alerts; without it, alerts still land in the portal), optionally `QA_ALERT_TO`/`QA_ALERT_FROM`; redeploy.
2. **Once:** as super admin open `/api/migrate` — creates `admin_notifications` (idempotent).
3. **cron-job.org:** `/admin` → Cron Fleet Manager → save API key → Sync (creates the QA Sweep, every 10 min, + keeps Render awake). Or create it manually per `docs/qa2/SETUP.md`.
4. **GitHub secrets:** `QA_EMAIL`, `QA_PASSWORD` (enable password sign-in for that Clerk account), `CRON_SECRET` — activates the 6-hourly production leg + failure alerts from Actions.
5. Migration numbering: PR #48's `0023_pulsemap_simulations` is already merged into main, so this branch's `0024_admin_notifications` slots in cleanly — no renumbering needed.
6. Live phone scan of the production QR is the one step only a human can do; every machine-verifiable layer (render size, decode, 20s rotation, auto-recovery, engine health) is green, and the production operator is healthy right now.

**AWAITING OWNER APPROVAL TO MERGE.**
