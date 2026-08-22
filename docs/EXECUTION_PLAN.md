# Execution Plan — Flavourly Production Build

This session ships the full platform (M1–M16), not a gate-sliced MVP. Gates remain the test scripts owners use after deploy.

## Done in this build

1. **Constitution + PRD + architecture docs** committed under `docs/` and repo root.
2. **Reliability**
   - Atomic outbox claim (`UPDATE … AND status='pending' RETURNING`)
   - Stuck-job reaper (5 min)
   - Backoff 10 / 30 / 90 / 270s
   - Persist-then-forward inbound with 3 retries
   - Unique partial index on `(tenant_id, wa_message_id)`
   - `last_connected_at` written once
   - `/send` verifies the WhatsApp account belongs to the job’s tenant
   - HMAC + operator API key fail-closed, timing-safe, header-only
3. **Product**
   - Bookings actually persist and confirm
   - POPIA exact-command opt-out / opt-in
   - Settings kill switches rendered and persisted
   - Nav: Overview, Inbox, Bookings, Waitlist, Loyalty, WhatsApp, Settings
   - Loyalty award ledger
   - Super admin MRR from `monthly_fee`
4. **Preview / local**
   - PGlite when `DATABASE_URL` is unset
   - Demo workspace (The Marula Room) when Clerk keys are unset
   - Simulated inbound so the inbox and AI path can be exercised without a second phone
5. **QA**
   - `scripts/prove-atomic-claim.mjs`
   - Playwright smoke against the running app
   - `e2e/verify-routes.mjs`
   - `synthetic-testing/` MatrAIx layer

## Owner test scripts (after production deploy)

| Gate | What you do with a second phone |
|---|---|
| 1 | Sign up → QR → scan → one inbound → exactly one AI reply |
| 2 | Inbox thread → manual reply arrives → AI silent |
| 3 | Personality “witty” → reply witty → AI OFF → silence → ON → reply |
| 4 | “Book table for 2 tomorrow 7pm” → confirmation + row |
| 5 | “waitlist 4” → Table Ready → guest notified → expiry |
| 6 | “points” → award in UI → balance + ledger |
| 7 | “menu” → `/m/<slug>` opens; 7am brief arrives |
| 8 | All sidebar tabs; `/admin` tenants + MRR |
| 9 | Read MatrAIx report; spot-check 2 scenarios |

Do not start a “next gate” rewrite. This codebase is the product.
