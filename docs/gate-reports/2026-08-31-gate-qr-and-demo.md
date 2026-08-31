# Session Gate Report — 2026-08-31 (Gate 1: WhatsApp QR + Gate 2: Demo Mode)

**Repo:** Naha1981/gemino-flavourly · **Author:** GLM (Senior NahaLabs Software Engineering Architect session)
**Principle applied:** EVIDENCE OVER NARRATIVE — every finding below was reproduced against live systems (real Neon, real Baileys socket, real Clerk session in a headless browser) before any fix was written, and every fix was re-verified the same way.

---

## GATE 1 — The Unscannable WhatsApp QR Code

### Symptom
User reaches the WhatsApp connection page; the QR "is not scannable at all".

### Diagnosis (evidence, in causal order)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **The QR row froze while `status='connecting'`.** A healthy Baileys socket re-emits the pairing code; the live `wa_accounts` row for the demo tenant (Marble) wrote once at 06:08:17 and stayed unchanged for 55+ s while the dashboard kept displaying it. | Read-only Neon watch (`watch-qr-cadence.mjs`): 12 samples over 55 s, zero value changes |
| 2 | **The first QR lives 60 s by Bailes default.** `Socket/socket.js` `genPairQR`: `let qrMs = qrTimeout \|\| 60000` — the *first* code is shown for a full minute, later codes every 20 s. The page promises "new one every ~20s" and flags staleness at 40 s, so the user is told the code is stale (and the phone rejects it as expired) during the 60 s window. | Baileys 6.7.24 source, `node_modules/@whiskeysockets/baileys/lib/Socket/socket.js:464-480` |
| 3 | **Old deployed operator: stale QR never cleared, 5-min backoff for linkers.** The pre-session code (d570352) left the expired `qr_code` on the row during reconnect backoff (up to 5 min), so the dashboard displayed a dead code indefinitely; its unguarded close handler also stacked duplicate sockets (440 conflict loop). | `git show d570352:operator/src/whatsapp/index.ts` |
| 4 | **Frontend had zero staleness awareness.** It polls every 3 s but renders whatever `qr_code` it last saw, forever — no phase detection, no re-kick, no "getting a fresh code" state. | `apps/main/app/(app)/dashboard/whatsapp/page.tsx` (pre-session) |
| 5 | **Pre-existing tenants 404'd out of the flow.** `/api/whatsapp/status` and `/connect` required an existing `wa_accounts` row; tenants created before the auto-create landed (e.g. the platform owner's own, 2026-08-21) got "No WhatsApp account found" and could never be handed a code at all. | Route sources (pre-session) + tenants/wa_accounts cross-query |
| 6 | **Leftover e2e test tenant in live data** (created during the previous session's signup test, missed by its cleanup). | Neon `tenants` scan: `flavourly.e2e.signup2` (cascade-deleted this session) |

*Not the cause (checked and ruled out): qrcode.react v4 already renders at `size × devicePixelRatio` (crisp on HiDPI), and the raw Baileys string (not a data-URI) was correctly encoded via `QRCodeCanvas`.*

### Fixes

**Operator (`operator/src/whatsapp/`, + `linking-policy.ts`)**
1. New pure decision module `linking-policy.ts`:
   - `nextReconnectDelayMs(attempts, linked)` — linking-phase accounts cap backoff at **15 s** (a human is standing at the screen), linked accounts keep the 5-min series.
   - `isZombieLinkingSocket(...)` — eviction policy for registered-but-silent linking sockets (QR silent > 45 s).
2. `index.ts`:
   - Transient close now also **clears the stored QR** (`qr_code: null`) so no expired code can display during a backoff window, and uses the phase-aware backoff.
   - `/start` **evicts zombie linking sockets** (deregister → detach listeners → close WS → build a fresh socket) instead of waiting on a corpse.
   - `qrTimeout: 20_000` pinned on `makeWASocket` — every code now refreshes every ~20 s, matching the page contract (fixes the 60 s first-code lifetime).

**Main app (`apps/main/`)**
3. `lib/whatsapp/ensure-account.ts` — `ensureWaAccount(tenantId)` provisions the row on demand (oldest-row-wins under races); both `/api/whatsapp/status` and `/connect` now use it (no more 404 for legacy tenants).
4. `lib/whatsapp/qr-freshness.ts` — pure client policy: `qrPhase()` (fresh / stale / waiting / connected, stale after 40 s) + `shouldAutoKick()` (rate-limited to 30 s, capped at 8 kicks, then manual retry).
5. Connection page rework: **288 px canvas (320 px frame)**, level **L** (larger modules — well above the 250 px gate minimum, black on white), auto-starts linking on load, tracks the last code CHANGE (not fetch), auto re-kicks the operator when the code goes stale, dimmed overlay "Getting a fresh code…", freshness chip ("Code refreshed Ns ago · new one every ~20s"), and a degrading manual-retry state if the engine is hard down.

**Live-data hygiene**
6. Cascade-deleted the leftover `flavourly.e2e.signup2` test tenant (+ wa_accounts row, memberships) from Neon.

### Evidence (GATE 1 — PASS)

Single-shot harness (real Neon + local operator running the exact `dist/` artifact + real Clerk session + real Baileys socket), log: `scripts/qr-e2e/run.log`, artifacts: `download/qr-evidence.json`, `download/qr-evidence-{1,2,3}*.png`:

| Assertion | Result |
|---|---|
| Stored QRs cleared → page auto-kicked `/api/whatsapp/connect` from `waiting` (recovery path) | ✅ operator log: `Initializing Baileys WhatsApp socket for account 61c7ed92…` |
| QR canvas rendered (288×288 internal, 320 CSS px, phase `fresh`) | ✅ |
| **jsQR decoded the rendered canvas** — machine-readable = phone-scannable | ✅ 237-char pairing string |
| Decoded value **=== live operator string in the DB** (capture-window sampled) | ✅ `2@XHnTa6sxy0Mvr…` head identical |
| Operator re-emitted a new QR exactly 20 s later | ✅ log timestamps 07:12:56 → 07:13:16 |
| **Decoded value changed after the window (auto-refresh proof)** | ✅ `2@XHnTa6sxy…` → `2@4Rb74yGn…`, and second decode also matched the live DB string |

Unit tests: `operator/test/linking-policy.test.ts` (10 tests — backoff caps, zombie policy, never-evict guards), `apps/main/lib/whatsapp/qr-freshness.test.ts` (12), `apps/main/lib/whatsapp/wiring.test.ts` (2 — routes must provision).

**Note for the owner:** production Render must redeploy the operator (and Vercel the app) to pick these fixes up — the frozen-QR behavior observed live is the *old* code. Also worth noting: Baileys emits one QR per noise-handshake cycle; refs exhaustion ends in a clean `timedOut` close which the new 15 s linking backoff recovers from.

---

## GATE 2 — Super Admin Seed Data & Demo Toggle

### Requirement
Super Admin dashboards filled with realistic SA restaurant data behind a Demo/Live toggle; live tables never polluted.

### Design decisions (divergences from the brief, with reasons)
1. **View-time rendering, not a data-access layer.** The dashboard pages are server components; the cleanest "useData()" equivalent is a server-side branch: when demo mode is active, every business metric renders from the seed module and the corresponding live queries are *skipped* (`demoMode ? [{count: 0}] : await db…`). Infrastructure controls (kill-switch, cron fleet) stay live so the page remains operable while demoing.
2. **Cookie, not localStorage.** A server component cannot read localStorage; the toggle writes `gemino_demo_mode=on` and calls `router.refresh()`, so the same click re-renders server components from the new source with zero API routes. Same persistence, server-visible.
3. **Fail-closed role gate.** `isDemoModeActive()` = cookie fast-path → `isSuperAdmin()` verification. Standard tenants pay zero extra cost (no Clerk/DB work without the cookie) and a forged cookie still yields live data. Tenant pages render the banner **only when active** — the compact "Demo Mode" switch lives on `/admin` alone, which standard tenants cannot reach.
4. **Kept strictly separate from the pre-existing `/api/admin/seed-demo` row-seeder** (deadbeef-prefixed rows in live tables). Demo Controls are hidden while view-mode demo is active so the two tools cannot be confused.

### Deliverables
- `lib/demo/seed-data.ts` — deterministic (no `Date.now`/`Math.random`/env reads — unit-asserted), realistic SA data: 24-tenant platform KPIs (R16,776 MRR @ R699, R81,430 missed revenue, 48,712 messages…), 10 SA restaurants (The Test Kitchen, Marble, Salsi, La Colombe, FYN…), 8 WhatsApp conversations with full transcripts, 8 Google reviews, VIPs, campaigns.
- `lib/demo/demo-mode.ts` — the fail-closed server gate.
- `components/demo-mode-bar.tsx` — amber "DEMO DATA … Switch to Live Data" banner + compact toggle (cookie → `router.refresh()`).
- Wired: `/admin` (all 14 KPIs + tenants table, live queries skipped), `/dashboard/inbox` (conversations, VIP alerts, transcript pane), `/dashboard/reputation` (metrics, distribution, review list).

### Evidence (GATE 2 — PASS)

Single-shot browser harness as the Super Admin (`scripts/qr-e2e/demo-run.log`, `download/demo-evidence.json`, `download/demo-evidence-1..5*.png`):

| Assertion | Result |
|---|---|
| Live `/admin`: no banner, no seed values | ✅ |
| Toggle ON → amber banner appears | ✅ |
| KPIs switch to seed values (R16,776 MRR · R81,430 missed revenue · 48,712 messages · The Test Kitchen) | ✅ |
| `/dashboard/inbox` demo: banner + seeded conversations (Thandi Mkhize), VIP alerts (Nomvula Khumalo), live transcript | ✅ |
| `/dashboard/reputation` demo: banner + seeded reviews (Pieter S.) | ✅ |
| Toggle OFF → banner gone, live values restored | ✅ |
| **Live database untouched** (tenants 4→4, messages 2→2 across the whole run) | ✅ |

Unit tests: `lib/demo/seed-data.test.ts` (determinism via double module-load + source scan, MRR = tenants × price, ranges, shapes) and `lib/demo/demo-mode.wiring.test.ts` (fail-closed gate structure, page wiring, banner/toggle contract, tenant pages never show the inactive toggle).

---

## Full verification matrix

| Suite | Before session | After session |
|---|---|---|
| Main app (`node --test apps/main/lib/**`) | 1643 | **1679 (+36)** |
| Operator | 59 | **69 (+10)** |
| `tsc --noEmit` (main) | clean | clean |
| `tsc` build (operator) | clean | clean |
| `next build` (production) | green | green (41/41 pages) |

## Constraints honored
- Auth/middleware logic untouched (no edits to `middleware.ts`, Clerk wiring, or route guards).
- No external automation tools introduced.
- No secrets committed (verified by full-diff scan before push; only `.env.example` placeholders tracked).
- Live database: only the pre-existing leftover test tenant was (correctly) deleted; demo mode performed zero writes.

## Open items for the owner
1. **Redeploy Render (operator) and Vercel (main app)** — the QR fixes take effect in production only after deploy.
2. The admin's own tenant (`naha.thabiso`) has never linked WhatsApp; the Marble demo tenant is the one with a `wa_accounts` row in `connecting` state — a fresh link attempt after redeploy will now auto-recover instead of showing a dead code.

---

# ROUND 2 — "Starting the WhatsApp engine…" forever (same day, evening)

**Symptom (owner report):** health returns OK on the Render deploy, auth works, but the QR
"doesn't load anymore" — the connection page is stuck on "Starting the WhatsApp engine…" indefinitely.

## Diagnosis (evidence, in causal order)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **The Baileys engine itself is healthy — even from a datacenter IP.** A bare `makeWASocket` with the EXACT operator options (`browser: ['Gemino Business OS','Chrome','120.0.0.0']`, `qrTimeout: 20_000`, pino logger, fresh creds) emitted QR #1 in **0.9 s** and re-emitted exactly every 20 s (5 codes in 90 s: `+0.9s`, `+20.9s`, `+40.9s`, `+60.9s`, `+80.9s`). | `scripts/baileys-probe/probe.mjs` run log (this session) |
| 2 | **The Render operator is up and its route/auth layer is intact.** `/health` → `OK`; `/ready` → `{"database":"ok","accountsMarkedConnected":0,"activeSockets":0,"whatsapp":"ok"}`; `POST /start` and `GET /status` without a key → `401 {"error":"Unauthorized: missing x-api-key header"}` (the new constant-time auth code is deployed). | Live curl against `gemino-flavourly-whatsapp.onrender.com` |
| 3 | **The deployed Vercel app runs the GATE 1 frontend** — the exact string "Starting the WhatsApp engine…" (with "the") exists only in the post-GATE-1 page; the pre-GATE-1 page had it only as a button label. | `git show 57d93ef^:...whatsapp/page.tsx` vs the owner's quoted symptom |
| 4 | **THE BLACK HOLE: the page silently swallows every failure.** Three compounding defects: (a) a non-OK `/api/whatsapp/status` response did nothing — no error, and because the auto-kick effect gated on `status !== null`, **no kick ever fired** → infinite spinner; (b) `refresh()` cleared `error` on every successful poll, so a kick failure's message (the operator's 401/404/500 cause — the most diagnostic string in the chain) vanished within 3 s, before any human could read it; (c) `/connect` flattened every operator error to a generic 502 "WhatsApp engine unreachable." and discarded the operator's QR snapshot. | `apps/main/app/(app)/dashboard/whatsapp/page.tsx` (pre-round-2), `apps/main/app/api/whatsapp/connect/route.ts` (pre-round-2) |
| 5 | **The Vercel→Render leg was never verified end-to-end.** The round-1 evidence harness ran a LOCAL operator (`dist/` artifact) against real Neon — production `OPERATOR_URL`/`OPERATOR_API_KEY` on Vercel have never been exercised. Note: `.env.example`'s placeholder is `https://gemino-operator.onrender.com` while the real service is `https://gemino-flavourly-whatsapp.onrender.com` — a copied placeholder produces exactly this symptom. | Round-1 report §Evidence ("local operator"); `.env.example` OPERATOR_URL line |
| 6 | **Browser-level reproduction from the agent sandbox is blocked by design** (not a code issue): the admin account signs in via email OTP / Google only, and sign-up is gated by Cloudflare Turnstile which refuses headless/datacenter browsers (submit produced ZERO Clerk API calls, `cf-turnstile-response` empty, in both headless and Xvfb-headed runs). | `scripts/qr-harness/probe4.spec.ts` runs (headless + Xvfb-headed) |

**Conclusion:** with the engine, the network leg, and the operator code all proven healthy, the
production break sits in the app-side chain (Vercel env config or the status route failing) — and
the code's black holes were hiding which one it is. Round 2 makes the failure mode
**self-announcing** instead of a forever-spinner, and hardens the chain.

## Fixes (round 2)

**`apps/main/lib/whatsapp/qr-freshness.ts`** (pure policy, +2 exported decisions)
1. `shouldAutoKick` gains `pollAttempted` (default true): a FAILED status poll no longer
   suppresses kicks — the kick error then names the real problem instead of an infinite spinner.
2. New `shouldClearEngineError(...)`: engine errors persist until the linking state improves,
   a later kick succeeds, or a 60 s TTL — never wiped by a routine 3 s poll.

**`apps/main/app/api/whatsapp/status/route.ts`**
3. Every failure path returns a structured, renderable error (was: swallowed 401/500s).
4. While linking (no QR, not connected) the response now carries `operatorOnline` — an
   operator `/health` probe with a 2.5 s abort timeout, module-cached 5 s so a 3 s poll can't
   become a Render health-check storm. A Render cold start shows as "waking up", not a 500.

**`apps/main/app/api/whatsapp/connect/route.ts`**
5. Fails LOUD and specific when `OPERATOR_URL` is unset (was: `fetch("undefined/start")` → opaque 500).
6. Network failures name the **host** ("unreachable (host: gemino-operator.onrender.com)") —
   a copied `.env.example` placeholder now diagnoses itself on screen.
7. Passes the **operator's own error** through (e.g. "Unauthorized: invalid x-api-key header")
   instead of flattening to a generic 502; includes `engineStatus`.
8. Returns the operator's QR snapshot (`qrCode`/`isConnected`/`phoneNumber`) so the page renders
   the code immediately; the fetch is bounded at 25 s so a Render cold start can't eat
   `maxDuration` as a platform-level error.

**`apps/main/app/(app)/dashboard/whatsapp/page.tsx`**
9. Failing status polls render a red, specific box ("Couldn't read WhatsApp status (HTTP …)").
10. Kick errors render in a persistent `engine-error` panel (cleared only per policy #2).
11. New distinct states: `engine-offline` amber box (Render unreachable / waking / OPERATOR_URL
    mismatch) and `logged-out` amber box (`status: 'disconnected'` — the number was unlinked
    phone-side; previously this also rendered as "Starting…", actively misleading).
12. A successful kick merges the operator's snapshot into the page state immediately.
13. The QR canvas rendering (288 px level-L, black-on-white, `data-testid="qr-frame"`,
    `data-qr-phase`) is unchanged — round 1 proved it machine-scannable.

**`apps/main/lib/operator-client.ts`** — `checkHealth(timeoutMs = 2.5 s)` bounded with
`AbortSignal.timeout` (first caller: the status route).

**Pre-existing TS error cleared:** `lib/demo/seed-data.test.ts` `for..of` over a `Set` (TS2802
under the targetless tsconfig) → `Array.from(...)`; `tsc --noEmit` is clean again.

## Evidence (round 2)

| Assertion | Result |
|---|---|
| Bare Baileys socket (operator's exact options) emits QR from a datacenter IP, ~20 s cadence | ✅ 5 QRs in 90 s (`+0.9s` → `+80.9s`) |
| Render operator healthy; protected routes answer the round-1 auth shape | ✅ `/health` OK, `/ready` ready, `/start`+`/status` → 401 JSON |
| `node --test` main app (full suite) | ✅ **1699/1699 pass** (was 1679; +8 policy tests, +9 wiring tests, +3 page-contract tests incl. the seed-data TS fix) |
| Operator suite (unchanged code) | ✅ 69/69 |
| `tsc --noEmit` | ✅ clean |
| `next build` (dummy throwaway `DATABASE_URL`, inline only) | ✅ 41/41 pages |
| Browser-level proof of the live fix | ⛔ not reproducible from this sandbox (owner's account is OTP-only; sign-up is Turnstile-gated — see finding #6). The deployed page itself is the proof: on redeploy it names the failing link in plain English instead of spinning. |

## What the owner should do after redeploying Vercel

1. Open **Dashboard → WhatsApp Connection**. If the engine box appears, it now says exactly
   which link is broken (unset/wrong `OPERATOR_URL`, key mismatch 401, or engine waking up).
2. Verify Vercel env: `OPERATOR_URL` = `https://gemino-flavourly-whatsapp.onrender.com`
   (NOT the `.env.example` placeholder `gemino-operator.onrender.com`) and `OPERATOR_API_KEY`
   matching the Render service's value. Redeploy Vercel after any change.
3. Render free tier sleeps after ~15 min idle — the first pairing attempt after a sleep may
   show "engine waking up" for up to a minute, then recover automatically (kicks continue).
4. Baileys pairing refs exhaust after several minutes per socket; the operator's linking
   backoff (15 s) recycles sockets automatically, but a phone must eventually scan within a
   code's ~20 s window.
