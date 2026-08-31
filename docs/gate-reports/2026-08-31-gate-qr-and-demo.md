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
3. Baileys pairing refs exhaust after several minutes per socket; the operator's linking backoff (15 s) recycles sockets automatically, but a phone must eventually scan within a code's ~20 s window.
