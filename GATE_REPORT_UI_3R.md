# GATE REPORT — UI-3R: Dashboard Truthfulness & Clarity, All Pages

**Date:** 2026-09-01 (Africa/Johannesburg)
**Branch:** `fix/ui-3r-dashboard-truthfulness`
**Verdict:** **PASS — ready for owner review. NOT MERGED (per directive).**

- test:main **1778/1778 green** (was 1699 before the gate; +79 new UI-3R tests)
- `tsc --noEmit` **clean**
- `next build` (GATE_MOCK=1 harness) **green** — 41/41 pages
- **96 Playwright screenshots** (16 pages × 1280/768/390 × 2 states): **zero console errors, zero horizontal overflow** (even at 390px)
- **41 SSR content assertions** across both states: **ALL PASS**
- DB row counts: the live database was **never connected to** (harness runs pg-mem; no Neon credentials existed in this environment). Nothing to mutate — trivially identical.

---

## 1. Root causes (owner-verified symptoms traced to source)

| Symptom | Root cause (file:line before fix) | Fix |
|---|---|---|
| **S2 — "R500 verified revenue" while disconnected** | `seed-store.ts` seeds six demo "platform tenants" (**Marble**, Gemelli, SUD, AURUM, Saint, Zioux — `deadId('tenant', 1..6)`) with `deadbeef-`-prefixed revenue rows. The super-admin tenant switcher offered them, and `dashboard/page.tsx` read `revenueEvents` **with no demo-row exclusion** — sample data wearing live clothes. | F2 `liveRowsOnly()` guard on every live query |
| **S13 — "25 000" 30-day revenue, zero channels** | Same class: `lib/analytics/store.ts` summed all tenant rows including deadbeef seed rows. | F2 scope threaded through `fetchAllEngineSeries` |
| **S1 — "AI BOOKINGS 0" vs "4 tables booked today"** | Two numbers from **two queries**: all-time `conversations.outcome='converted'` vs today's `reservations` count. | F1 single-source `aiBookingsCard(todayBookings)` |
| **S5/S15 — trend badges with no number** | `wowUp` was a bare boolean; `TrendBadge` rendered "—" for null pct. | F1/F7 real-%-or-nothing (`revenueWowBadge`, `trendBadgeLabel`) |
| **S6 — green "AI Revenue Employee Active" while disconnected** | Badge text **hardcoded** in `inbox/page.tsx` — never read `waAccounts`. | F4 live `waAccounts.isConnected` read |
| **S7 — "Great retention!" with zero profiles** | Empty state had no condition on total profiles. | F5 `customersAtRiskEmptyState(total)` |
| **S8 — 0% gold bars** | Bar track always rendered; `totalCounted \|\| 1` masked zeros. | F5 `segmentShare()` → null at zero, bar hidden |
| **S9/S24 — double-active nav** | `dashboard-chrome.tsx isActive()` used `startsWith` — every ancestor lit up. | F8 `resolveActiveNavHref` (longest match wins) |
| **S11 — "No draft yet — press Regenerate"** | Drafts only generated **on ingest** (review-sync Gate #12); reviews predating that path never got one. | F6 `ensureReviewDrafts` backfill on page load |
| **S12 — identical seed sentences** | `generateReviews` cycled 6 praise texts across 36 reviews. | F7 per-review composed texts — **all 40 distinct** |
| **S14 — "25 000"/"3571.4", "$" icon** | `analytics-tabs.tsx` used raw `toLocaleString()`/`toFixed(1)` + `DollarSign` icon. | F7 `lib/format/rand.ts` + `Banknote` icon |
| **S16 — "Operations" jargon** | Engine name rendered verbatim. | F7 label map → "Conversations" |
| **S17–S26** | Honest-copy / dead-link / API-talk gaps in Market, Calendar, Channels, Approvals. | F9/F10/F11/F5 (see per-page table) |

**R500/25 000 source (owner's #1 question):** the deadbeef demo seed's platform tenants. Marble is `deadbeef-0100-4000-8000-000000000001` — a *seeded demo tenant*, viewed live through the super-admin switcher. Live views now exclude every `deadbeef-%` row; those rows render only in Demo Mode (amber banner + SAMPLE chips).

---

## 2. Per-page findings table (all 16 sidebar surfaces)

| Page | Symptoms found | Fixed | Live state (evidence) | Demo state |
|---|---|---|---|---|
| Overview | S1, S2, S3, S4, S5 | F1, F2, F3, F7 | R0, honest subtexts, empty-chart copy, no bare-arrow badge ✓ | banner + SAMPLE chips + seed data ✓ (demo tenant honestly redirects to WhatsApp page — never connected) |
| Inbox | S6 | F4 | amber "Idle — connect WhatsApp to start" + honest right pane ✓ | banner + demo threads ✓ |
| Customers | S7, S8 | F2, F5 | "No guests yet…", no 0% bars, "—" for empty segments ✓ | banner + SAMPLE chip + seed profiles ✓ |
| VIP Today | S9, S10 | F8 | exactly one active sidebar item ✓ | banner ✓ |
| Reputation | S11, S12 | F6, F7 | empty state; live backfill (kill-switch aware) ✓ | drafts ready (labelled), varied texts ✓ |
| Analytics | S13, S14, S15, S16 | F2, F3, F7 | Rand values, Conversations label, honest tab empty states ✓ | banner + SAMPLE chips + seed series ✓ |
| Approvals | S17 | F5 | teaches flag rules (discounts/dietary-medical/complaints) + resolved-history note ✓ | banner ✓ |
| Market Intelligence | S18, S19 | F9 | no 8am promise, links hidden at zero data ✓ | banner ✓ |
| Calendar | S20, S21, S22, S23 | F4, F10 | blocked-until-connected chip, offer→Approvals link, no "To: —" ✓ | banner ✓ |
| Channels | S25, S26 | F4, F11 | live WA status, Connect CTA, coming-soon copy, no API talk ✓ | banner ✓ |
| **Marketing** (audited) | fabricated `Math.max(2,…)` est-tables floor | F12 | honest 0-floor ✓ | banner ✓ |
| **Campaigns** (audited) | none beyond class fixes (statuses already DB-driven) | — | clean ✓ | banner ✓ |
| **Events** (audited) | none found (dates always present, empty state honest) | — | clean ✓ | banner ✓ |
| **WhatsApp** (audited) | none (GATE 1 round 2 already made states truthful) | — | clean ✓ | banner ✓ |
| **Billing** (audited) | none (Rand + R prefix already correct; tier data from API) | — | clean ✓ | banner ✓ |
| **Settings** (audited) | none (no jargon, no dead links, forms live) | — | clean ✓ | banner ✓ |

**BOOK keyword (S22): verified, not changed** — `lib/ai/responder.ts:308` routes any message containing "book" into the booking flow, so "Reply BOOK to reserve" copy is truthful and was kept (per F10: keep only if the dispatcher handles it — it does).

---

## 3. Files changed

**Pages (display layer):** `dashboard/page.tsx`, `dashboard/layout.tsx`, `dashboard/dashboard-chrome.tsx`, `dashboard/inbox/page.tsx`, `dashboard/customers/page.tsx`, `dashboard/customers/vip-today/page.tsx`, `dashboard/reputation/page.tsx`, `dashboard/analytics/page.tsx`, `dashboard/analytics/analytics-tabs.tsx`, `dashboard/marketing/calendar/page.tsx`, `dashboard/marketing/page.tsx`, `dashboard/market/competitors/page.tsx`, `dashboard/market/opportunities/page.tsx`, `dashboard/operations/approval-requests/page.tsx`, `dashboard/operations/channel-configs/page.tsx`

**Lib (new):** `lib/nav/active-route.ts`, `lib/dashboard/kpi.ts`, `lib/format/rand.ts`, `lib/demo/query-scope.ts`, `lib/reputation/draft-policy.ts`, `lib/reputation/ensure-drafts.ts`

**Lib (modified, query-scope threading only):** `lib/analytics/store.ts`, `lib/analytics/aggregate.ts`, `lib/customer/profile-store.ts`, `lib/customer/segmentation-store.ts`

**Seed (data only):** `lib/demo/seed-generators.ts` (review text variety)

**Gate harness (test-only):** `lib/gate-mock/personas.ts`, `lib/gate-mock/pgmem-db.ts`, `lib/gate-mock/clerk-server.mock.ts` (persona C)

**Tests:** new `lib/dashboard/{active-route,kpi,query-scope,ensure-drafts,ui-truthfulness.wiring}.test.ts`, `lib/format/rand.test.ts`; updated 3 legacy wiring tests that pinned the old (buggy) behavior.

**Files NOT touched (per directive):** `middleware.ts`, `lib/auth/*`, `lib/tenant-resolver*.ts`, `lib/billing/*`, operator workspace, `lib/ai/responder.ts` (read-verified only), campaign send paths, `lib/demo/seed-store.ts` (DB safety contract intact — wipe remains the only demo-row writer), `lib/webhook/*`, all API route auth.

---

## 4. Evidence table (failing-first)

| Fix | Test (red → green) | Runtime proof |
|---|---|---|
| F1 | `kpi.test.ts` "subtext NEVER claims activity at 0" + wiring "ONE query" | S1/S2/S5 content assertions PASS |
| F2 | `query-scope.test.ts` (predicate + demo opt-out) | S2/S13 gone; SAMPLE chips + banner assertions PASS |
| F3 | `kpi.test.ts` empty-chart copy + wiring | S3 assertion PASS (message renders) |
| F4 | wiring "waAccounts read" | S6/S20/S25 assertions PASS (connected + disconnected personas) |
| F5 | `kpi.test.ts` zero-states + share-null | S7/S8/S17 assertions PASS |
| F6 | `ensure-drafts.test.ts` shouldDraft/fallback + wiring | S11 assertion PASS (textarea carries draft) |
| F7 | `rand.test.ts` + seed-variety tests | S4/S12/S14/S15/S16 assertions PASS |
| F8 | `active-route.test.ts` 9 routes | S9/S24 assertions PASS (aside aria-current = 1, correct href) |
| F9–F11 | wiring tests | S18/S19/S23/S25/S26 assertions PASS |
| F12 | wiring "no Math.max(2,…)" | marketing page clean at 390px |

**Full suite before/after:** 65/67 new tests RED on the unmodified branch → 79/79 GREEN after (10 pre-existing green seed assertions included); total 1778/1778.

**Screenshots:** `download/ui-3r-screenshots/{live-disconnected,demo-mode-on}/{1280,768,390}-<page>.png` (96 files) + `evidence-index.json` (per-page overflow + console-error log). Both states for every touched page; zero console errors; zero horizontal overflow at 390px.

---

## 5. Known harness limitations (transparent, not gate-blocking)

1. **pg-mem seed partiality:** the demo seed POST 500s inside the gate harness at the bookings INSERT (pg-mem cannot evaluate `DEFAULT` clauses in large multi-row inserts for newer columns like `reminder48_sent_at`). Production Neon is unaffected (same code path ran on the real DB in prior gates). Consequence: Demo-Mode DB pages show the seeded tenants/customers/revenue; inbox + reputation demo views use their static demo datasets; campaigns/calendar render honest empty states in demo mode. All 16 pages still shot in both states.
2. **The demo tenant's Overview redirects to the WhatsApp page** in Demo Mode — honest pre-existing behavior (that tenant never connected); SAMPLE-chip proof therefore runs on Analytics + Customers.
3. Screenshots were produced with real Chromium (v1234, already provisioned in this sandbox) against the GATE_MOCK=1 dev server — Clerk and Neon swapped for the documented gate mocks; all authorization, tenant resolution and query code is the real production code.

---

## 6. Ship state

- Branch `fix/ui-3r-dashboard-truthfulness` pushed; **PR opened, NOT merged.**
- Conventional commits: 9 commits (`feat(ui): …`, `fix(ui): …`, `fix(reputation): …`, `test(…): …`).

**END: AWAITING OWNER APPROVAL TO MERGE.**
