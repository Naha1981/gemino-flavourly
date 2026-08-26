# Magic Link / Pre-Configured Demo Tenant Flow

This documents the "Super Admin → Create Prospect → Build Demo Tenant → Magic
Link → Owner Claims → Live Customer" flow used for sales pitches.

## 1. Prospect intake (Super Admin)

`/admin/prospects` (super-admin only — `isSuperAdmin()` fails closed):

- **Add Prospect** form: name, website, owner email, owner phone, city →
  `POST /api/prospects` (creates a `prospects` row, status `queued`).
- **Bulk CSV import**: `POST /api/prospects/import` parses a CSV server-side
  (columns `name,website,owner email,owner phone,city`) into many queued
  prospects. Malformed rows are reported, never silently dropped.
- **Build Demo Tenant**: `POST /api/prospects/[id]/build` runs the Brand
  Intelligence Engine + Google Places enrichment, pre-seeds sample data, and
  generates a magic-link claim token. Sets the prospect to `ready`.
- **Generate Magic Link**: `POST /api/prospects/[id]/magic-link` reuses an
  existing unexpired/unclaimed token or creates one, and returns the link.
- **Retry** (`POST /api/prospects/[id]/retry`): re-queues a `failed` prospect
  only while `retries < 3`, so a busted build is not retried forever.

Prospect statuses: `queued → enriching → ready | failed → claimed`.

## 2. Brand Intelligence Engine

`lib/brand-intelligence`:

- `scraper.ts` — `extractBrandProfile(html)` parses the restaurant site HTML
  for logo URL, brand name, tagline, primary/secondary/background colours,
  font family, menu (JSON-LD or on-page) and operating hours, and computes a
  `confidence` in [0,1]. `scrapeUrl()` is the safe fetch wrapper (10s timeout,
  never throws).
- `google-places.ts` — `fetchGooglePlacesData(name, city)` resolves the place
  via the Places API (New), returning rating, review count, address, hours and
  up to 5 real reviews.
- `seed-data.ts` — turns enrichment into demo rows:
  bookings from real reviewer names (future dates), reviews (real authors),
  campaigns from slow-day + menu, and a KPI estimate
  (avg check × review volume × 0.1).
- `create-demo-tenant.ts` — orchestrates: create tenant
  (`plan='signature'`, `plan_status='trialing'`, `tenant_mode='demo'`), link a
  WhatsApp account, scrape + enrich, seed data, create a claim token.

## 3. Magic link & claim

`lib/brand-intelligence/magic-link.ts` generates an opaque 32-byte token
(`base64url`), expiring 30 days. `assessClaimToken()` is the single answer for
`valid | invalid | expired | claimed`; `assessClaimAttempt()` makes
double-claims idempotent (same user ok, different user rejected).

- **Public page**: `/claim/[token]` — no auth. Loads the tenant + brand
  profile + sample data and injects branding via `ThemeProvider`, with a gold
  **Claim Your App** button. Already-claimed/expired/invalid states handled.
- **Sign-up**: `/sign-up?claim=<token>` stashes the token in a
  `flavourly_claim` cookie (SameSite=Lax, 1h, httpOnly) and sets Clerk's
  `afterSignUpUrl` to `/claim/redeem`.
- **Redeem**: `GET /claim/redeem` (auth) or `POST /api/claim/redeem` reads the
  cookie, and `redeemClaimToken()`:
  1. links `tenant.owner_id` to the user,
  2. flips `tenant_mode='live'`, `plan_status='trialing'`,
     `trial_ends_at = now + 14 days`,
  3. marks the token claimed (`claimed_at`, `claimed_by_user_id`),
  4. flips the source prospect to `claimed`,
  5. stamps the tenant onto the user's Clerk `publicMetadata.tenantId`
     (so onboarding/dashboard resolve to the claimed tenant),
  6. clears the cookie and redirects to `/onboarding`.

## 4. Background processing

`/api/cron/process-prospects` (scheduled every 5 minutes, guarded by
`assertCronAuthorized`) builds up to 5 queued/re-tryable prospects per run:
flip to `enriching`, run `createDemoTenant`, mark `ready` with a token, or
`failed` with `retries++`. A 1s gap between builds rate-limits upstream scrapes.

## 5. Branding injection

`components/theme-provider.tsx` injects CSS variables `--brand-primary`,
`--brand-secondary`, `--brand-background` and the brand font on a wrapper, and
exposes the brand via `useBrandTheme()`. The dashboard layout and `/claim` both
load the tenant's `brand_profiles` row and pass it in; with no profile the
default Flavourly branding is used.

## Security summary

- `/admin/prospects` and all `/api/prospects*` require super-admin.
- `/claim/[token]` is public (opened on a prospect owner's phone).
- `/claim/redeem` and `/api/claim/redeem` require a signed-in user.
- Claim tokens are opaque (no PII), expire after 30 days, and are single-use
  (idempotent on re-claim by the same user).
- All `/claim` sample-data queries are scoped to the token's tenant.
