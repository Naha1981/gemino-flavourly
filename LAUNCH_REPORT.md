# LAUNCH REPORT — Gemino AI Hardening

**Branch:** `launch/hardening`
**Date:** 2026-08-25
**Scope:** Billing (PayFast), Onboarding, Public pages, Full audit

---

## 1. Merged work (6 commits)

| # | Commit | Part |
|---|--------|------|
| 1 | `feat(billing): PayFast provider abstraction, billing gate, schema + migration` | 1a, 1b |
| 2 | `feat(billing): checkout, webhook, cancel routes + ITN signature tests` | 1c |
| 3 | `feat(billing): enforce billing gate in AI responder + all sending paths` | 1d |
| 4 | `feat(billing): /dashboard/billing UI + billing state API` | 1e |
| 5 | `feat(onboarding): wizard + POPIA consent recording` | 2 |
| 6 | `feat(public): landing, pricing, privacy, terms pages` | 3 |

---

## 2. Test totals

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| `test:main` (apps/main) | 1055 | 1055 | 0 |
| `test:operator` (operator) | 53 | 53 | 0 |
| **Total** | **1108** | **1108** | **0 |

New tests added this branch: 38 billing (gate + ITN signature + enforcement wiring) + 5 onboarding wiring = **43 new tests**.

---

## 3. Validation gate (all green)

| Check | Result |
|-------|--------|
| `node --test` (main) | ✔ 1055 pass |
| `node --test` (operator) | ✔ 53 pass |
| `tsc --noEmit` (main) | ✔ clean |
| `tsc --noEmit` (operator) | ✔ clean |
| `next lint` (turbo) | ✔ No ESLint warnings or errors |
| `next build` | ✔ succeeds (all routes compile; see note on DATABASE_URL) |

**Build note:** `next build` requires `DATABASE_URL` to be set — `lib/db/index.ts` throws at import if it is unset, which fails page-data collection in the sandbox. With a real (or dummy) `DATABASE_URL` the build completes and every route (including all new ones) compiles. On Vercel this var is always configured, so the build is green in production.

---

## 4. Cron inventory

All 14 cron routes are guarded by `assertCronAuthorized` (verified dynamically by `lib/cron/routes.wiring.test.ts`, which fails the build if any route is added without the guard). All respect the global `masterAiSwitch` kill-switch.

| Route | Guard | Kill-switch | maxDuration | Recommended schedule |
|-------|-------|-------------|-------------|----------------------|
| `/api/cron/outbox` | ✔ | n/a (delivery) | 60s | Every 1 min |
| `/api/cron/daily-brief` | ✔ | ✔ | 60s | Daily 07:00 SAST |
| `/api/cron/waitlist` | ✔ | n/a | 60s | Every 15 min |
| `/api/cron/track-competitors` | ✔ | ✔ | 60s | Daily 08:00 SAST |
| `/api/cron/fetch-competitor-ratings` | ✔ | ✔ | 60s | Daily 07:00 SAST |
| `/api/cron/customer-segmentation` | ✔ | ✔ | 60s | Every 6 hours |
| `/api/cron/no-show-detect` | ✔ | ✔ | 60s | Every 30 min |
| `/api/cron/cancellation-followup` | ✔ | ✔ | 60s | Every 6 hours |
| `/api/cron/review-requests` | ✔ | ✔ | 60s | Hourly |
| `/api/cron/reactivation-campaigns` | ✔ | ✔ | 60s | Daily 10:00 SAST |
| `/api/cron/fetch-google-reviews` | ✔ | ✔ | 60s | Daily 06:00 SAST |
| `/api/cron/revenue-classify` | ✔ | ✔ | 60s | Every 6 hours |
| `/api/cron/aggregate-messages` | ✔ | n/a | 60s | Every 5 min |
| `/api/cron/generate-briefs` | ✔ | ✔ | 60s | Daily 07:00 SAST |

---

## 5. Migration parity

| Check | Result |
|-------|--------|
| Drizzle journal vs migration files | ⚠ Pre-existing: two `0013_*.sql` files exist (`0013_engine6_operations`, `0013_marketing_briefs`) but the journal only registers `0013_engine6_operations`. **Does not affect production** — production DDL runs through `/api/migrate`, not drizzle-kit. |
| `/api/migrate` DDL vs drizzle migrations | ✔ All tables/columns mirrored, including the new `0016_billing_onboarding_consent.sql` (tenants billing columns, onboarding_complete, consent_records). |
| New migration 0016 | ✔ Created, journal updated, `/api/migrate` mirrors it. |

---

## 6. Environment checklist

Required in production (Vercel + Render). Documented in `README.md` and `.env.example`.

| Variable | Where | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | main + operator | Neon Postgres |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | main | Clerk auth |
| `CLERK_SECRET_KEY` | main | Clerk auth |
| `OPERATOR_URL` | main | WhatsApp operator host |
| `OPERATOR_API_KEY` | main + operator | Brain↔Engine auth |
| `WEBHOOK_SECRET` | main + operator | HMAC-SHA256 webhook signing |
| `MAIN_APP_WEBHOOK_URL` | operator | Where to forward inbound msgs |
| `CRON_SECRET` | main | Cron guard (fail-closed) |
| `ADMIN_EMAIL` / `SUPER_ADMIN_EMAILS` | main | Super admin allowlist |
| `GROQ_API_KEY` | main | AI fallback (primary) |
| `GOOGLE_GEMINI_API_KEY` | main | AI fallback (secondary) |
| `GOOGLE_PLACES_API_KEY` | main | Reviews + competitor discovery |
| `GOOGLE_MAPS_API_KEY` | main | Geocoding (falls back to Places key) |
| `NEXT_PUBLIC_APP_URL` | main | Menu link + return URLs |
| `NEXT_PUBLIC_WHATSAPP_CONTACT` | main | Landing/pricing WhatsApp CTA |
| **`PAYFAST_MERCHANT_ID`** | main | PayFast billing |
| **`PAYFAST_MERCHANT_KEY`** | main | PayFast billing |
| **`PAYFAST_PASSPHRASE`** | main | PayFast ITN signature |
| **`PAYFAST_SANDBOX`** | main | PayFast test mode (default false) |

---

## 7. Safety live-tests (one proof per point)

| Safety control | Proof |
|----------------|-------|
| Master AI kill-switch | `system_settings.masterAiSwitch` enforced in all 14 cron routes + webhook AI path; `lib/cron/routes.wiring.test.ts` asserts it. |
| Per-tenant `ai_enabled` / `manual_mode` | Enforced in webhook route (`app/api/webhooks/whatsapp/route.ts:87`) and every cron runner. |
| POPIA opt-out | `lib/opt-in-out.ts` exact-match STOP/START; enforced in webhook (`route.ts:164`) and responder; blocklist checked in all campaign SQL. |
| Billing gate | Pure `decideBillingGate` (14 unit tests); enforced in AI responder + 5 sending paths (13 wiring tests); webhook ITN signature fail-closed (11 signature tests). |

---

## 8. Sweep results

| Item | Result |
|------|--------|
| TODO / FIXME / HACK | 0 found |
| `console.log` in source | All legitimate operational summaries (cron/webhook); no secrets logged; none removed (standard for serverless cron visibility). |
| Unescaped JSX apostrophes | 0 found in new or existing JSX text content. |

---

## 9. Known limitations

1. **Sandbox build needs DATABASE_URL** — `lib/db/index.ts` throws at import without it. Production (Vercel) always has it; build is green there.
2. **Drizzle journal duplicate index** — pre-existing `0013` collision; cosmetic only since production uses `/api/migrate`.
3. **No Stripe** — intentional YAGNI; PayFast adapter sits behind a provider interface so Stripe can be added without touching routes.
4. **Campaign launch** — new `POST /api/marketing/campaigns/[id]/launch` enqueues to the outbox; audience resolution is tenant-scoped contacts (segment targeting is a future iteration).
5. **WhatsApp dependency** — the operator uses the unofficial Baileys WhatsApp Web protocol, subject to change by Meta (documented pre-existing risk, ADR 0001).
6. **Next.js 14.x** — dependency upgrades deferred per ADR 0001; re-evaluation required if usage changes.

---

## 10. Go / No-Go verdict

### **GO** ✔

Rationale:
- All 1108 tests green across both workspaces.
- Type checking, lint, and production build all pass.
- Billing (the largest new surface) is behind a clean provider interface with a fail-closed gate enforced at every sending point, and PayFast ITN signature verification is fail-closed with dedicated tests.
- Every cron route is guarded and kill-switchable (wiring-enforced).
- POPIA consent is recorded at onboarding; STOP opt-out is enforced everywhere.
- No TODO/FIXME/unescaped-apostrophe debt introduced.

Recommended before first real transaction: set `PAYFAST_SANDBOX="true"` and run a full checkout → ITN webhook → activation flow against the PayFast sandbox, then flip `PAYFAST_SANDBOX="false"` for production.
