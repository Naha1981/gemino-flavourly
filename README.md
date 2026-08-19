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
│       │   │   └── settings/        # AI system prompt & trading hours
│       │   └── api/
│       │       ├── webhooks/whatsapp/ # HMAC-SHA256 verified inbound webhook
│       │       ├── cron/outbox/       # Guaranteed outbox pattern worker
│       │       └── whatsapp/connect/  # QR code generation trigger
│       ├── lib/
│       │   ├── db/schema.ts         # Drizzle PostgreSQL schema
│       │   ├── db/index.ts          # Neon serverless client
│       │   ├── operator-client.ts   # HTTP client to Render operator
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
2. The root directory will build using the pre-configured `vercel.json`.
3. Set environment variables in Vercel project settings:
   - `DATABASE_URL` = Neon Postgres URL
   - `OPERATOR_URL` = `https://your-operator.onrender.com`
   - `OPERATOR_API_KEY` = (Same key from Operator)
   - `WEBHOOK_SECRET` = (Same secret from Operator)
   - `CLERK_SECRET_KEY` & `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `ADMIN_EMAIL` = Your email address
   - `GOOGLE_GEMINI_API_KEY` = Your Gemini API key
4. Deploy. Vercel Crons will automatically trigger `/api/cron/outbox` every minute.

---

## 🔒 Security & Compliance
- **HMAC-SHA256 Signatures**: All inbound messages from the Operator are cryptographically verified using constant-time equality checks.
- **POPIA / GDPR**: Inbound messages with keywords `STOP`, `UNSUBSCRIBE`, or `OPT OUT` automatically flag contacts as `blocklisted = true` and cease automated responses.
- **Master AI Kill Switch**: Instant global pause toggle in database (`system_settings`) accessible via the Super Admin Dashboard.
- **Outbox Pattern**: Outbound messages are written to `jobs` and dispatched with exponential backoff retries.
