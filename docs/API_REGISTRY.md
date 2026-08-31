# API Registry

External APIs this product calls, and every internal API surface we expose. Purpose: one place to answer "what talks to what" during discovery (the discovery-skill prompts live in `docs/skills/`).

## 1. Outbound (we call these)

| API | Used for | Where | Key env | Failure mode |
|---|---|---|---|---|
| Groq (`api.groq.com`) | Primary AI concierge fallback | `lib/ai/responder.ts` | `GROQ_API_KEY` | logs + falls to Gemini, then polite fallback copy |
| Google Gemini | Secondary AI fallback | `lib/ai/responder.ts` | `GOOGLE_GEMINI_API_KEY` | polite fallback copy (never silence) |
| Google Places | Reviews fetch + competitor discovery + geocoding | `lib/reputation/google-places-client.ts`, `lib/market/geolocation.ts` | `GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` | graceful "not configured" states |
| PayFast | Checkout + tokenized subscriptions + ITN | `lib/billing/payfast.ts` | `PAYFAST_MERCHANT_ID/KEY/PASSPHRASE` | fail-closed signature; gate denies sends |
| Firecrawl (optional) | Prospect menu/site scraping | `lib/brand-intelligence/scraper.ts` | `FIRECRAWL_API_KEY` | falls back to direct fetch scraper |
| cron-job.org | Cron fleet registration + self-heal | `scripts/setup-cronjobs.mjs`, `/api/admin/sync-crons` | `CRONJOB_API_KEY` (AES-GCM at rest) | watchdog reports drift |
| Neon Postgres | Database | both workspaces | `DATABASE_URL` | pool error listener + retry-safe idempotent writes |
| Clerk | Auth + user management | `apps/main` | `NEXT_PUBLIC_CLERK_*`, `CLERK_SECRET_KEY` | public pages survive (route-guard core) |

## 2. Inbound (we expose)

### Internal app API (Clerk-authenticated, tenant-scoped)

`/api/health` · `/api/settings` · `/api/onboarding` · `/api/tenant/*` · `/api/consent` · `/api/analytics/*` · `/api/customer/*` · `/api/operations/*` · `/api/marketing/*` · `/api/reputation/*` · `/api/market/*` · `/api/revenue/*` · `/api/conversations/*` · `/api/prospects/*` · `/api/admin/*` (super-admin) · `/api/billing/checkout|cancel|state` · `/api/loyalty/complete-visit`

### Machine-to-machine (no Clerk session; own auth)

| Route | Auth | Caller |
|---|---|---|
| `/api/webhooks/whatsapp` | HMAC-SHA256 signature (fail-closed) | Operator (Render) |
| `/api/billing/webhook` | PayFast ITN MD5 signature (fail-closed, timing-safe) | PayFast |
| `/api/cron/*` (22 routes) | `Authorization: Bearer <CRON_SECRET>` (fail-closed) | cron-job.org fleet |
| `/api/loyalty/geo-claim/[token]` | single-use claim token (the credential) | guest browser (geo-claim page) |
| `/api/migrate` | super-admin | operator |

### Operator REST (Render, `OPERATOR_API_KEY`)

`POST /start` (QR) · `GET /status` · `POST /send` · `GET /health` — tenant-ownership checks fail-closed on `/start` and `/status`.

### Public pages (no auth)

`/`, `/pricing`, `/privacy`, `/terms`, `/sign-in`, `/sign-up`, `/onboarding`, `/claim/[token]`, `/geo-claim/[token]`, `/m/[slug]`

## 3. Planned (gated, not built)

- `GET/POST /api/v1/*` — versioned public API for customer integrations (gate API-1; ADR-022 defers MCP gateway to the same gate).
- Outbound email via Resend (transactional + owner briefs) — gate API-1.

Discovery of *new* candidate APIs happens through the reference prompts in `docs/skills/` (Figrarium, Awesome-Selfhosted, OpenAlternative, Free-AI-APIs, Public-API arsenal). Adding any dependency requires an ADR naming why an existing registry entry can't do the job.
