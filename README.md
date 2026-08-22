# Flavourly — WhatsApp operations for restaurants

Every restaurant gets a WhatsApp number that answers in seconds, fills tables, runs the waitlist, and turns guests into regulars.

**Brain:** Next.js on Vercel · Clerk · Neon · Groq → Gemini  
**Engine:** Direct Baileys operator on Render (`@whiskeysockets/baileys@6.7.24`)  
**No Twilio. No Evolution. No per-message tax.**

See `docs/PRD.md`, `docs/EXECUTION_PLAN.md`, and `WHATSAPP_ARCHITECTURE.md`.

## Local / Arena preview

```bash
npm install
npm run prove:outbox
cd apps/main && npm run dev
```

With no Clerk or Neon keys the app boots **The Marula Room** (PGlite + demo owner). Open `/dashboard` and send a guest line.

## Production

1. Deploy `operator/` to Render (Docker, single instance). Health: `GET /health` every 5 minutes.
2. Deploy the repo to Vercel (no native crons).
3. Set the env vars in `.env.example`.
4. Hit `GET /api/migrate` as super-admin once.
5. Schedule cron-job.org:
   - `GET /api/cron/outbox` every 1 min (`Authorization: Bearer $CRON_SECRET`)
   - `GET /api/cron/waitlist` every 15 min
   - `GET /api/cron/daily-brief` at 07:00
   - `GET https://<operator>/health` every 5 min

## Tests

```bash
npm run prove:outbox
BASE_URL=http://127.0.0.1:3000 npm run verify:routes
BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/app.spec.ts
BASE_URL=http://127.0.0.1:3000 npm run synthetic:report
```
