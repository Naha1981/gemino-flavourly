# NahaLabs Engineering Standard (Flavourly)

This file is the constitution for this repository. Deviations require an ADR in `docs/adr/`.

## Prime directive

One repo. One database. One auth provider (Clerk). One AI abstraction. One WhatsApp platform (custom Baileys operator). Two deploy targets only because sockets are stateful: Vercel (brain) + Render (engine).

## Hard rules

1. Never build custom auth in production. Clerk is identity. Demo mode exists only when Clerk keys are absent (local / Arena).
2. Never send WhatsApp inline. Always `jobs` outbox → atomic claim → operator `/send`.
3. Never trust webhook `tenantId`. Resolve tenant from `wa_accounts`.
4. Never use Evolution API, Twilio, or Cloud API.
5. Never add Vercel native `crons`. Hobby plan. Use `/api/cron/*` + cron-job.org.
6. Fail closed on missing `OPERATOR_API_KEY` and `WEBHOOK_SECRET`.
7. Timing-safe compares. Header-only API keys.
8. Tenant scope every business query.
9. QR pairing uses `QRCodeCanvas`, never `QRCodeSVG`.
10. POPIA commands are exact-match, not substring.

## Stack

Next.js App Router · TypeScript strict · Tailwind · Clerk · Drizzle · Neon (PGlite locally) · Vercel AI-style provider calls (Groq → Gemini) · Baileys 6.7.24 operator · Playwright.

## Module ownership

`lib/ai` owns replies. `lib/db` owns schema. `lib/operator-client` is the only file that talks to the operator. Dashboard pages do not import Baileys.
