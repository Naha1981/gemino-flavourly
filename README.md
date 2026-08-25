# Gemino — Multi-Tenant WhatsApp AI Platform (Direct Baileys Architecture)

Production-ready, multi-tenant WhatsApp AI SaaS built using the **Universal Direct WhatsApp Architecture (No Twilio / No Cloud API fees)**.

---

## 🏛️ System Architecture

```
                                  ┌────────────────────────────────────────┐
                                  │      WhatsApp Web Network (Meta)       │
                                  └───────────────────▲────────────────────┘
                                                      │ Persistent WebSockets
                                                      ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 THE ENGINE: WhatsApp Operator (Render/Docker)                          │
│  - Express.js + @whiskeysockets/baileys                                                                │
│  - Multi-tenant Socket Manager (Map<waAccountId, WASocket>)                                            │
│  - Neon Postgres Session Credential Persistence (survives restarts)                                    │
│  - Inbound Message Forwarder with HMAC-SHA256 Signatures                                              │
│  - REST API: POST /start (QR generation), POST /send (instant deliver), GET /health                    │
└───────────────────────────────────────────────┬────────────────────────────────────────────────────────┘
                                                │ HMAC-SHA256 Webhooks (Inbound)
                                                │ REST API /send (Outbound Worker)
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 THE BRAIN: Next.js 14 App (Vercel Serverless)                          │
│  - App Router, React 18, Tailwind CSS, Lucide Icons, Shadcn-style Zinc Theme                           │
│  - Clerk Auth (Multi-tenant metadata & Admin role verification)                                        │
│  - Drizzle ORM + Neon Serverless PostgreSQL                                                            │
│  - Outbox Pattern Engine (jobs table + /api/cron/outbox for guaranteed message delivery)               │
│  - AI Automation (Keyword matching, POPIA STOP opt-out, Gemini/Groq AI integration)                    │
│  - Dashboards:                                                                                         │
│    1. Super Admin Dashboard (/admin): Global metrics, MRR, all tenants, emergency master switch        │
│    2. Operations / Tenant Dashboard (/dashboard): QR code connect, conversations, waitlist, loyalty    │
│    3. Conversations UI (/dashboard/conversations): Live message thread viewer & manual reply mode     │
│    4. Waitlist & Reservations (/dashboard/reservations)                                                │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Monorepo Structure

```
gemeli-whatsapp-app/
├── apps/
│   └── main/                        # Next.js 14 Brain (Vercel)
│       ├── app/
│       │   ├── admin/page.tsx       # Super Admin Dashboard (MRR, Tenants, Kill-switch)
│       │   ├── dashboard/           # Tenant Operations & QR pairing
│       │   │   ├── conversations/   # Live WhatsApp thread viewer
│       │   │   ├── waitlist/        # Waitlist queue dispatcher
│       │   │   ├── loyalty/         # Points ledger & rewards
│       │   │   ├── market/          # Market Intelligence (#15-#18)
│       │   │   │   ├── competitors/ # Discovery + menu/promotion tracking
│       │   │   │   ├── opportunities/ # Detected market gaps
│       │   │   │   └── positioning/ # Price / rating / menu positioning
│       │   │   └── settings/        # AI prompt, hours, address, menu
│       │   └── api/
│       │       ├── webhooks/whatsapp/ # HMAC-SHA256 verified inbound webhook
│       │       ├── cron/outbox/       # Guaranteed outbox pattern worker
│       │       ├── cron/track-competitors/ # Daily market sweep (08:00)
│       │       ├── market/            # Competitors, opportunities, positioning
│       │       └── whatsapp/connect/  # QR code generation trigger
│       ├── lib/
│       │   ├── db/schema.ts         # Drizzle PostgreSQL schema
│       │   ├── db/index.ts          # Neon serverless client
│       │   ├── operator-client.ts   # HTTP client to Render operator
│       │   ├── market/              # Geolocation, scraper, detectors, analyzers
│       │   └── ai/responder.ts      # Keyword detection & LLM fallback
│       └── package.json
├── operator/                        # Persistent Baileys Engine (Render/Docker)
│   ├── src/
│   │   ├── whatsapp/index.ts        # Baileys socket lifecycle & reconnection
│   │   ├── webhook/forward.ts       # HMAC signed webhook forwarder
│   │   ├── db/client.ts             # Postgres session persistence
│   │   └── index.ts                 # Express REST API (/start, /send, /health)
│   ├── Dockerfile                   # Multi-stage container
│   └── package.json
├── .github/workflows/
│   └── synthetic-monitor.yml        # Synthetic uptime checks
├── WHATSAPP_ARCHITECTURE.md         # Core engineering specification
├── vercel.json                      # Vercel deployment & cron config
├── turbo.json                       # Turborepo pipeline
└── package.json                     # Monorepo root
```

---

## 🚀 Quickstart & Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local` in `apps/main` and `.env` in `operator`:
```bash
# In apps/main/.env.local:
DATABASE_URL="postgresql://user:pass@ep-host.region.aws.neon.tech/neondb?sslmode=require"
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
OPERATOR_URL="http://localhost:3001"
OPERATOR_API_KEY="your-operator-api-key"
WEBHOOK_SECRET="your-webhook-secret"
ADMIN_EMAIL="you@yourdomain.com"
GOOGLE_GEMINI_API_KEY="AIzaSy..."

# In operator/.env:
PORT=3001
DATABASE_URL="postgresql://user:pass@ep-host.region.aws.neon.tech/neondb?sslmode=require"
MAIN_APP_WEBHOOK_URL="http://localhost:3000/api/webhooks/whatsapp"
WEBHOOK_SECRET="your-webhook-secret"
OPERATOR_API_KEY="your-operator-api-key"
```

### 3. Migrate Database Schema
```bash
npm run db:generate
npm run db:migrate
```

### 4. Run Both Services Simultaneously
```bash
npm run dev
```
- Main App: [http://localhost:3000](http://localhost:3000)
- Super Admin: [http://localhost:3000/admin](http://localhost:3000/admin)
- Tenant Dashboard: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- Operator Engine: [http://localhost:3001/health](http://localhost:3001/health)

---

## 🚢 Production Deployment

### 1. Deploy the Operator to Render
1. Create a new **Web Service** on Render pointing to the `operator` directory.
2. Select **Docker** environment (or Node.js 20).
3. Set environment variables:
   - `DATABASE_URL` = Your Neon Postgres URL
   - `MAIN_APP_WEBHOOK_URL` = `https://your-app.vercel.app/api/webhooks/whatsapp`
   - `WEBHOOK_SECRET` = Random 32+ character hex string
   - `OPERATOR_API_KEY` = Random 32+ character hex string
   - `PORT` = `3001`
4. Deploy and verify `https://your-operator.onrender.com/health` returns `OK`.

### 2. Deploy the Main App to Vercel
1. Import your Git repository into Vercel.
2. The root directory will build using the pre-configured `vercel.json` (100% compatible with Vercel Free Hobby plan).
3. Set environment variables in Vercel project settings:
   - `DATABASE_URL` = Neon Postgres URL
   - `OPERATOR_URL` = `https://your-operator.onrender.com`
   - `OPERATOR_API_KEY` = (Same key from Operator)
   - `WEBHOOK_SECRET` = (Same secret from Operator)
   - `CLERK_SECRET_KEY` & `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `ADMIN_EMAIL` = Your email address
   - `GROQ_API_KEY` = Your Groq API key
4. Deploy.

### 3. Set Up Free External Cron Jobs (cron-job.org)
Since Vercel Hobby limits cron frequencies, set up free external cron triggers on [cron-job.org](https://cron-job.org):
1. **Outbox Message Worker (Every 1 minute)**:
   - URL: `https://your-app.vercel.app/api/cron/outbox`
   - Schedule: Every 1 minute
2. **Daily Analytics Brief (Daily at 07:00 AM)**:
   - URL: `https://your-app.vercel.app/api/cron/daily-brief`
   - Schedule: Every day at 07:00
3. **Waitlist Expiration Cleaner (Every 15 minutes)**:
   - URL: `https://your-app.vercel.app/api/cron/waitlist`
   - Schedule: Every 15 minutes
4. **Keep Render Operator Awake (Every 5 minutes)**:
   - URL: `https://your-operator.onrender.com/health`
   - Schedule: Every 5 minutes
5. **Competitor Market Sweep (Daily at 08:00)**:
   - URL: `https://your-app.vercel.app/api/cron/track-competitors`
   - Schedule: Every day at 08:00
   - Header: `Authorization: Bearer <CRON_SECRET>` (mandatory — the guard fails closed)
   - Scrapes every tracked competitor's menu, diffs it against the stored
     snapshot, scans the same site for promotions, raises inbox alerts for
     real changes, and then recomputes market opportunities from the result.

---

## 🧭 Market Intelligence Engine (Gates #15-#18)

Everything a restaurant can learn about the other restaurants within 5km,
built from data the platform already touches: Google Places for discovery
and public websites for menus and promotions. No model calls, no scraping
infrastructure — the analyzers are pure functions over stored rows, so the
same input always produces the same report.

| # | Capability | Where it lives |
|---|---|---|
| 15 | **Competitor discovery** — geocode the venue, list every restaurant in a 5km radius, track them (name, address, distance, place id, website, phone, Google price band) | `lib/market/geolocation.ts`, `lib/market/competitor-store.ts`, `/api/market/competitors*` |
| 16 | **Menu / price / promotion tracking** — daily scrape, diff against the last snapshot, alert on new items, removals and price moves; detect promotions and dedupe them over a 30-day window | `lib/market/menu-scraper.ts`, `promotion-detector.ts`, `competitor-alerts.ts`, `/api/cron/track-competitors` |
| 17 | **Opportunity detection** — meal, cuisine, price-band and day/time gaps with an additive, explainable confidence score | `lib/market/opportunity-analyzer.ts`, `opportunity-store.ts`, `/api/market/opportunities*` |
| 18 | **Positioning** — price band, Google rating rank, menu overlap and unique dishes vs the tracked set | `lib/market/positioning-analyzer.ts`, `positioning-store.ts`, `/api/market/positioning` |

Tenant-facing pages live under `/dashboard/market/*` (nav: **Market
Intelligence**); the Super Admin dashboard reports competitors tracked,
market opportunities detected and competitor alerts raised this week.

Two design rules worth knowing before extending this:

- **A first scrape is a baseline, not a change.** Otherwise every newly
  tracked competitor announces itself as a menu rewrite and the alert stream
  gets muted.
- **Gaps and positions are only reported when the evidence supports them.**
  An empty market returns no opportunities rather than invented ones, and a
  tenant with no menu on record gets an "unknown" band instead of a
  plausible-looking number.

Required keys are optional by design: without `GOOGLE_MAPS_API_KEY` /
`GOOGLE_PLACES_API_KEY` discovery reports a clear error, but menu and
promotion tracking still run — it reads public websites and needs no Google
key at all. Competitors can also be added by hand (name + website), which is
why `competitors.google_place_id` is nullable.

---

## 🔒 Security & Compliance
- **HMAC-SHA256 Signatures**: All inbound messages from the Operator are cryptographically verified using constant-time equality checks.
- **POPIA / GDPR**: Inbound messages with keywords `STOP`, `UNSUBSCRIBE`, or `OPT OUT` automatically flag contacts as `blocklisted = true` and cease automated responses.
- **Master AI Kill Switch**: Instant global pause toggle in database (`system_settings`) accessible via the Super Admin Dashboard. The market sweep honours it too: it calls no model, but it does fetch third-party websites on a schedule, and an owner who paused automation expects everything to stop.
- **Scraper SSRF guard**: competitor URLs are tenant-supplied, so `lib/market/menu-scraper.ts` refuses anything that is not a public http(s) host before it makes a request — `localhost`, `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, the `169.254.169.254` metadata address, `::1` and non-HTTP schemes. The residual DNS-rebinding limitation is documented in that file rather than glossed over.
- **Cron guards fail closed**: every `/api/cron/*` route requires `Authorization: Bearer <CRON_SECRET>` (constant-time comparison, never from a query string), and `lib/cron/routes.wiring.test.ts` fails the build's test run if a new cron route is added without it.
- **Outbox Pattern**: Outbound messages are written to `jobs` and dispatched with exponential backoff retries.
