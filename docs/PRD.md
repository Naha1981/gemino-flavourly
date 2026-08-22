# PRD v3.0 — Flavourly (Gemino) WhatsApp Operations Platform

**Product:** Flavourly  
**Engine:** Gemino WhatsApp Operator (Direct Baileys, ADR-014)  
**One-line vision:** Every restaurant gets a WhatsApp number that answers in seconds, fills its own tables, runs its own waitlist, and turns one-time guests into regulars — with zero apps for customers to download.

**Status:** Production-ready build. All modules M1–M16 are wired, not stubbed.

---

## 1. Problem

Restaurants already live on WhatsApp. Owners miss messages during service. A missed reply is a table at a competitor. Existing tools (Twilio, Cloud API, Evolution) add per-message fees or a third-party socket they do not own.

## 2. Solution

A two-server system the restaurant owner never has to understand:

1. **Brain (Next.js on Vercel)** — Clerk tenancy, inbox, bookings, waitlist, loyalty, AI concierge, outbox.
2. **Engine (Baileys Operator on Render)** — one persistent WhatsApp Web socket per tenant number. No Twilio. No Evolution. No per-message tax.

They share Neon Postgres. They talk over HMAC-signed webhooks (inbound) and `x-api-key` REST (outbound).

## 3. Who pays

South African independent restaurants and small groups. **R49 / tenant / month** default (`tenants.monthly_fee`). Success path: 5-minute QR onboarding → first AI reply the same evening → owner never turns it off.

Out of scope for this release: automated billing collection, native mobile apps, voice notes, horizontal operator scaling.

## 4. Architecture

```
CUSTOMER PHONE
      │ WhatsApp protocol
      ▼
OPERATOR (Render, single instance)
  Express + TypeScript + @whiskeysockets/baileys@6.7.24
  sockets Map · openAccounts Set · connectingLocks
  Postgres auth state (wa_auth_keys)
  REST /start /send /status · public /health
      │ HMAC POST                    ▲ REST /send
      ▼                              │
MAIN APP (Vercel / Next.js App Router)
  Clerk · Drizzle · Groq → Gemini fallback
  webhook → AI → jobs outbox → cron dispatcher
      ▲
      │ SQL
      ▼
NEON POSTGRES (shared brain)
```

Local / Arena preview with no secrets: PGlite + demo workspace (The Marula Room). Production never uses demo mode when Clerk + DATABASE_URL are set.

## 5. Feature spec (acceptance)

| # | Module | Acceptance |
|---|---|---|
| M1 | Auth & tenancy | Clerk sign-up lands on dashboard; tenant + `wa_accounts` row auto-provisioned; every query is tenant-scoped |
| M2 | WhatsApp wiring | QR via `QRCodeCanvas`, 3s poll, green Connected, `last_connected_at` set **once**, sockets resume after restart |
| M3 | AI concierge | MENU / BOOK / WAITLIST / POINTS / HOURS + LLM fallback; kill switches actually suppress |
| M4 | Inbox & takeover | Split-pane; AI/Staff badges; manual reply via outbox; takeover silences AI for that thread |
| M5 | Bookings | “Book a table for 2 tomorrow 7pm” → `reservations` row + WA confirmation + owner list |
| M6 | Waitlist | “waitlist 4” queued; Table Ready notifies WA; 15m expiry cron |
| M7 | Loyalty | POINTS returns live balance + catalog; award writes ledger; Loyalty page shows top guests |
| M8 | POPIA | Exact commands only (`STOP`, `START`, …) — no substring hijacks |
| M9 | Public menu | `/m/<slug>` public, cached, no auth wall |
| M10 | Daily brief | Last-24h messages + bookings to the linked number via outbox |
| M11 | Overview | Stats + disconnected banner |
| M12 | Settings | Name, hours, personality, prompt, `aiEnabled` / `manualMode` persist and change live replies |
| M13 | Super admin | Double-click logo → `/admin`; ADMIN_EMAIL / staff_members; tenants + connections + volume + MRR |
| M14 | Reliability | Atomic outbox claim; backoff 10/30/90/270s; 5m reaper; persist-then-forward 3 retries; unique partial `wa_message_id`; 10/min rate limit; fail-closed secrets |
| M15 | QA | Playwright smoke; MatrAIx personas; atomic-claim race proof |
| M16 | Nav | Overview, Inbox, Bookings, Waitlist, Loyalty, WhatsApp, Settings — no orphans |

## 6. Non-functionals

- Tenant isolation on every query
- Fail-closed secrets, timing-safe compares, HMAC webhooks
- Header-only operator API key
- Zero secrets in git
- Build survives missing env (lazy DB, demo fallback)
- No Vercel native crons (Hobby). All schedules are public routes + cron-job.org
- Reply latency target < 60s; delivery ≥ 99% via outbox

## 7. Environment

**Operator:** `DATABASE_URL`, `OPERATOR_API_KEY`, `WEBHOOK_SECRET`, `MAIN_APP_WEBHOOK_URL`, `PORT`, `LOG_LEVEL`

**Main app:** same DB + keys, plus `OPERATOR_URL`, Clerk keys, `ADMIN_EMAIL`, `GROQ_API_KEY`, `GOOGLE_GEMINI_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`

## 8. Cron-job.org (copy/paste)

| Job | Method | URL | Header | Schedule |
|---|---|---|---|---|
| Outbox | GET | `https://<app>/api/cron/outbox` | `Authorization: Bearer $CRON_SECRET` | Every 1 min |
| Waitlist expiry | GET | `https://<app>/api/cron/waitlist` | same | Every 15 min |
| Daily brief | GET | `https://<app>/api/cron/daily-brief` | same | 07:00 SAST |
| Operator keep-alive | GET | `https://<operator>/health` | — | Every 5 min |

## 9. Monetisation

- Default **R49 / tenant / month** (`monthly_fee`)
- Super admin MRR = `SUM(monthly_fee)` of live tenants
- Billing automation is explicitly out of scope; the metric is real so sales conversations are not fiction
