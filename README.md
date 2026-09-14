# Gemino / Flavourly — Multi-Tenant Restaurant WhatsApp AI Platform

Gemino is the tenant-aware business brain for Flavourly. It handles restaurant conversations, AI, customer intelligence, campaigns, loyalty, reputation, analytics, billing and operational workflows. WhatsApp transport is provided by the shared **NahaLabs Central WhatsApp Operator**.

## Architecture

```text
WhatsApp Web / Baileys
        │
        ▼
┌───────────────────────────────────────────────┐
│ NahaLabs Central WhatsApp Operator            │
│ Render · shared transport · multi-account     │
│ QR/pairing · send · status · inbound webhook   │
└──────────────────────┬────────────────────────┘
                       │ HMAC-signed webhook / REST
                       ▼
┌───────────────────────────────────────────────┐
│ Gemino / Flavourly Next.js app                │
│ Vercel · multi-tenant business brain          │
│ Clerk · Drizzle · Neon · AI · CRM · billing  │
│ campaigns · AutoPost · analytics · outbox     │
└───────────────────────────────────────────────┘
```

**There is no local `operator/` application in this repository.** Do not add a second Baileys engine here. The canonical transport is the shared central Operator documented in `WHATSAPP_ARCHITECTURE.md`.

## Repository layout

```text
gemino-flavourly/
├── apps/main/                         # Next.js application
│   ├── app/(app)/dashboard/           # tenant product surfaces
│   ├── app/(app)/admin/               # Super Admin platform controls
│   ├── app/api/webhooks/whatsapp/     # HMAC-verified central Operator webhook
│   ├── app/api/cron/                  # secured scheduled jobs
│   └── lib/                           # DB, AI, WhatsApp client, billing, CRM, etc.
├── apps/main/lib/whatsapp/             # central Operator client + contracts
├── scripts/cron-fleet.json             # canonical external cron fleet
├── .github/workflows/                  # CI / persona QA
├── WHATSAPP_ARCHITECTURE.md            # transport specification
├── CLAUDE.md                           # engineering and release gates
├── .env.example                        # environment contract
└── package.json
```

## Local development

### Install

```bash
npm install
```

### Configure

Copy the environment contract from `.env.example` into `apps/main/.env.local` and provide local/test values for the services you use.

The important application variables are:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon/Postgres connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Clerk authentication |
| `CRON_SECRET` | Authenticates scheduled cron routes |
| `ADMIN_EMAIL` / `SUPER_ADMIN_EMAILS` | Platform administration |
| `OPERATOR_URL` | Central NahaLabs WhatsApp Operator URL |
| `OPERATOR_API_KEY` | Server-to-server Operator authentication |
| `WEBHOOK_SECRET` | HMAC verification for inbound Operator webhooks |
| `APP_ID` | Application identity sent to the central Operator (`gemino`) |
| `APP_URL` | Public Gemino callback base URL |
| `GROQ_API_KEY` / `GOOGLE_GEMINI_API_KEY` | AI providers |
| `GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` | Market intelligence / Google Places |
| `OPENPOST_BASE_URL` / `OPENPOST_API_TOKEN` / `OPENPOST_WORKSPACE_ID` / `OPENPOST_SOCIAL_ACCOUNT_IDS` | AutoPost integration |
| `RESEND_API_KEY` / `QA_ALERT_TO` / `QA_ALERT_FROM` | QA alerting |
| `CRONJOB_API_KEY` | cron-job.org fleet management |
| `PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY` / `PAYFAST_PASSPHRASE` / `PAYFAST_SANDBOX` | South African billing |

### Start the app

```bash
npm run dev
```

The tenant dashboard is available at `/dashboard`; the Super Admin console is at `/admin` for authorized administrators.

## WhatsApp setup

Gemino talks to the shared Operator through `apps/main/lib/whatsapp/central-operator.ts`. The server-side client sends the required application, tenant and Operator credentials; local tenant `wa_accounts` IDs are mapped to central Operator account IDs.

For connection flows, the app supports central QR payloads and pairing codes. A Render cold start is represented explicitly as a transient **waking** state rather than a fake disconnected/unlinked success.

Inbound WhatsApp events must arrive at:

```text
POST {APP_URL}/api/webhooks/whatsapp
```

The webhook is HMAC-verified and resolves the tenant from the central account binding; it must not trust a tenant identifier supplied in the message body.

## Outbound messaging

Customer-facing sends use the `jobs` outbox and the central Operator. The outbox owns retries, stuck-job reclamation, delivery-state reconciliation and tenant billing limits.

Automated customer messages marked with `automated: true` are restricted to the **07:00–20:00 Africa/Johannesburg** send window. Manual staff replies and normal inbound AI responses are not delayed by this campaign send-window rule.

## Scheduled jobs

`scripts/cron-fleet.json` is the canonical external schedule. It is designed for cron-job.org / the in-app Cron Fleet Manager and includes the central Operator keep-alive plus the application jobs.

The fleet must not be duplicated in `vercel.json`. The runtime loader prefers `scripts/cron-fleet.json` and falls back to the embedded snapshot in `apps/main/lib/cron/canonical-fleet.embedded.ts`; a test fails when the two drift.

The current fleet includes campaign-attribution reconciliation as well as the QA smoke sweep and system watchdog.

## AutoPost / OpenPost

Flavourly remains the restaurant business and revenue brain. OpenPost is an external publishing layer for connected social accounts. Campaign publishing requires explicit owner approval before the integration is called.

## AI and safety controls

AI processing is tenant-scoped and guarded by billing, the per-tenant AI setting, manual takeover state, the global Super Admin AI kill-switch and POPIA opt-out handling. `STOP`, `UNSUBSCRIBE` and related opt-out requests block automated follow-up.

AI answers are deterministic-first where possible and can fall back to Groq/Gemini. Keep provider credentials server-side.

## Billing

PayFast is the billing system of record for subscription activation. The Super Admin Estimated MRR uses the currently active plan prices in ZAR; trialing and cancelled tenants are excluded from the live MRR KPI.

## Production deployment

### Vercel — Gemino application

Deploy this repository as the Next.js application. Configure the variables in `.env.example`, including the **central** `OPERATOR_URL` and `APP_URL`.

### Central Operator — separate repository

The WhatsApp transport is maintained separately in the NahaLabs central Operator repository. This Gemino repository must not deploy or recreate a local Baileys Operator.

### External cron fleet

Use `scripts/cron-fleet.json` as the source of truth when syncing cron-job.org or the in-app Cron Fleet Manager. Scheduled routes use `Authorization: Bearer <CRON_SECRET>` unless the job is explicitly documented as unauthenticated, such as the central Operator `/health` keep-alive.

## Release gates

Before onboarding restaurants, run the native unit tests plus the GATE_MOCK Playwright persona suite. The repository's automated QA also exercises authentication, tenant isolation, Super Admin access, WhatsApp connection states, mobile navigation, demo mode and alert handling.

```bash
npm test
npm run test:e2e
```

For production-only checks that depend on real Clerk/PayFast/AI credentials, provide the corresponding QA secrets in the scheduled GitHub workflow rather than committing credentials.

## Documentation

`WHATSAPP_ARCHITECTURE.md` is the authoritative WhatsApp transport design. `.env.example` is the authoritative environment-variable contract. `docs/FEATURE_MATRIX.md` tracks implemented, partial and deferred product features.
