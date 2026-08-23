# G1 — Real Restaurant Pilot Readiness

**Branch frozen at:** `bbc6fa17b93e8062c566383a7126bce781c374c0`
**Status:** planning only — no code changes until a test below fails.

**Goal:** prove ONE real restaurant can complete the full WhatsApp
lifecycle — inbound customer message → response dispatched → delivered →
delivery state visible in the dashboard.

> Use environment variable **names** only. Never paste real secret values
> into a chat, an issue, or this file.

---

## Deployment architecture (verified against the repo)

| Component | Where | How it deploys |
|---|---|---|
| Main app (Next.js 14.2.35) | Vercel | `vercel.json`: `npm run build`, framework `nextjs` |
| Operator (Baileys/Express) | Render | `operator/Dockerfile`, multi-stage, `npm ci`, `NODE_ENV=production`, port 3001 |
| Database | Neon Postgres | shared by both services |
| Auth | Clerk | SDK-read env vars |
| Cron | **external scheduler** | `vercel.json` has **no `crons` array** |

Message path:

```
Customer WhatsApp
  -> Operator (Baileys socket)
  -> forwardToMain()            HMAC-SHA256, x-webhook-signature
  -> MAIN_APP_WEBHOOK_URL       POST /api/webhooks/whatsapp
  -> verify signature -> tenant -> AI reply -> jobs (outbox)
  -> GET /api/cron/outbox       Authorization: Bearer CRON_SECRET
  -> operatorClient.sendMessage -> Operator POST /send (x-api-key)
  -> Baileys -> Customer WhatsApp
  -> messages.delivery_status = sent | queued | failed  -> dashboard
```

---

## PHASE 0 — Pre-deployment gates (blocking)

These come from the code as it stands. Skipping any of them produces a
predictable failure.

### 0.1 Run the database migration FIRST ⚠️
The G0.3 code writes `messages.delivery_status` / `delivery_error`. Those
columns are **not** in the drizzle baseline; they are added by the
`/api/migrate` DDL path. Deploying the code first means every outbound
message write fails.

- [ ] Deploy the branch **or** run migration against the same database
- [ ] `GET /api/migrate` while signed in as super admin (it self-gates on
      `isSuperAdmin()` and returns 403 otherwise)
- [ ] Expect `{ ok: true, message: "All Neon database columns and tables synchronized successfully" }`
- [ ] Confirm columns exist: `messages.delivery_status`, `messages.delivery_error`

Ordering note: the endpoint lives in the app being deployed, so either
deploy then immediately migrate before real traffic, or run the equivalent
DDL directly. The statements are all `ADD COLUMN IF NOT EXISTS` — safe to
re-run, and existing rows keep `NULL`.

### 0.2 Environment variables — Vercel (main app)
- [ ] `DATABASE_URL`
- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- [ ] `CLERK_SECRET_KEY`
- [ ] `CRON_SECRET` — **required**; unset means every cron returns 401 and
      the outbox silently stops
- [ ] `ADMIN_EMAIL` and/or `SUPER_ADMIN_EMAILS` — needed to reach
      `/api/migrate` and `/admin`
- [ ] `OPERATOR_URL`
- [ ] `OPERATOR_API_KEY` — must match Render byte-for-byte
- [ ] `WEBHOOK_SECRET` — must match Render byte-for-byte
- [ ] `GROQ_API_KEY` and/or `GOOGLE_GEMINI_API_KEY` — at least one, or no
      AI reply is generated
- [ ] `NEXT_PUBLIC_APP_URL`
- [ ] `ALLOW_UNSIGNED_WEBHOOKS` — **must NOT be set**

### 0.3 Environment variables — Render (operator)
The operator now **refuses to boot** without these (G0.2/G0.3).

- [ ] `DATABASE_URL`
- [ ] `WEBHOOK_SECRET`
- [ ] `OPERATOR_API_KEY`
- [ ] `MAIN_APP_WEBHOOK_URL` — full public URL ending
      `/api/webhooks/whatsapp`. **The Dockerfile sets `NODE_ENV=production`,
      so the loopback guard is active: any localhost/127.0.0.1 value, or an
      unset value, will stop the deploy.** This is intended.

### 0.4 Cron scheduling ⚠️ HIGHEST OPERATIONAL RISK
`vercel.json` has no `crons` array, so an external scheduler (e.g.
cron-job.org) must call all three endpoints. All are `GET`.

**Why this ranks above everything else in Phase 0.** The outbox is the
*only* delivery mechanism. If the scheduler is missing, misconfigured, or
silently stops, then: messages are created successfully, AI generates
successfully, jobs are enqueued successfully, and the dashboard looks
entirely correct — but **nothing is ever delivered to a customer**. Every
signal an operator would normally trust reads green. This failure is
invisible from the UI and must be verified directly.

- [ ] `GET {APP}/api/cron/outbox` — every 1–2 min (drives all delivery)
- [ ] `GET {APP}/api/cron/waitlist`
- [ ] `GET {APP}/api/cron/daily-brief`
- [ ] Each sends header `Authorization: Bearer <CRON_SECRET>`
- [ ] Query-string auth (`?key=`) is rejected by design — header only

**Exact contract** (verified in `lib/cron/authorize.ts` and
`app/api/cron/outbox/route.ts` — the scheduler must match it exactly):

| Property | Required value |
|---|---|
| Method | `GET` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Prefix | Literal `Bearer ` — case-sensitive, one space |
| Comparison | SHA-256 digest + `timingSafeEqual` (constant time) |
| Secret unset server-side | **Always 401** — fails closed, no bypass |
| Wrong/missing/malformed header | 401 |
| `?key=` / `?secret=` | **Not accepted** (leaks via logs + Referer) |

**Healthy response bodies** — use these to confirm the job is really
running, not just returning 200:

- Idle: `{"ok":true,"processed":0,"reaped":0}`
- Working: `{"ok":true,"processed":N,"succeeded":N,"failed":0,"reaped":0}`

- [ ] Scheduler's own execution history shows **200**, not 401 — a
      scheduler retrying 401 forever looks "active" in its dashboard
- [ ] Confirm `reaped` stays at `0` in steady state. A persistently
      non-zero `reaped` means runs are being killed mid-batch (see 0.5)

**Verified operational caveat — reaped jobs do not consume an attempt.**
The reaper resets stuck `processing` jobs to `pending` *without*
incrementing `attempts`. That is correct (a timeout is not the message's
fault), but it means a job that always dies mid-dispatch can loop
indefinitely and will **never** reach `failed`. So a stalled job is not
guaranteed to surface as a failure in the UI — watch `reaped` and the
`pending` queue depth directly. Not a code change; a monitoring duty.

**Batching:** each run takes at most **50** jobs (`limit: 50`) where
`nextRunAt <= now`. At a 1-minute cadence that is a ceiling of ~50
messages/min. Fine for a pilot; note it before scaling.

**Retry/backoff timeline** (`delayMs = 3^attempt × 10s`, `maxAttempts`
default **5** — computed from the real formula):

| Attempt | Retry after | Cumulative |
|---|---|---|
| 1 | 30s | 0.5 min |
| 2 | 90s | 2 min |
| 3 | 270s | 6.5 min |
| 4 | 810s | 20 min |
| 5 | — | **exhausted → `failed`** |

So a genuinely undeliverable message takes **~20 minutes** to show as
`failed` in the dashboard. Expect this during Phase 5.2 — it is not a
hang. Do not abort the test early and call it a bug.

### 0.5 Vercel plan check
All three cron routes declare `maxDuration = 60`. Hobby caps functions at
**10s**, so a batch of up to 50 outbox jobs can be killed mid-run. The
stuck-job reaper recovers them, but delivery is delayed.

- [ ] Confirm the plan, or accept slower delivery during the pilot

---

## PHASE 1 — Deploy & smoke test

- [ ] Deploy branch to Vercel; build succeeds
- [ ] Deploy operator to Render; **container starts** (a config failure now
      shows as a failed deploy, not a silent one)
- [ ] Render logs show `listening on port` and **no** `Refusing to start`
- [ ] `GET {OPERATOR}/health` → `200 OK`
- [ ] `GET {OPERATOR}/ready` → `200 {"status":"ready"}`; `503 degraded`
      before any WhatsApp account is connected is expected and correct
- [ ] `GET {APP}/` loads
- [ ] `GET {APP}/api/cron/outbox` with **no** auth header → **401**
- [ ] Same with correct Bearer header → **200**
- [ ] `GET {OPERATOR}/status` with no `x-api-key` → **401**

### 1.1 Prove the scheduler is actually firing (not just configured)
Configured ≠ running. Verify the *scheduler itself* reaches the app,
rather than only testing the endpoint by hand.

- [ ] In the scheduler's execution history: last run **200**, on schedule
- [ ] Wait 2 cadence intervals, re-check — timestamp advanced
- [ ] Response body is the `{"ok":true,...}` shape from §0.4, not an error
      page or a Vercel auth wall (deployment protection on a preview URL
      will 401 the scheduler even with a correct Bearer token)
- [ ] Vercel function logs show recurring `/api/cron/outbox` invocations
- [ ] Repeat this check *after* the Phase 4 test — the highest-value
      moment to catch a scheduler that quietly stopped

---

## PHASE 2 — Restaurant onboarding

- [ ] Sign up a test restaurant account via Clerk
- [ ] Tenant row auto-created on first login (`getOrCreateTenant`)
- [ ] `/onboarding` completes; `/dashboard` loads
- [ ] `/dashboard/settings` shows the tenant; save a change successfully
- [ ] Public menu page `/m/<slug>` loads **without** sign-in
- [ ] Confirm defaults: `ai_enabled = true`, `manual_mode = false`,
      `master_ai_switch = true` (all default ON — no action needed)

---

## PHASE 3 — WhatsApp connection

- [ ] `/dashboard/whatsapp` → **Connect**
- [ ] QR renders
- [ ] Scan with the restaurant's WhatsApp
- [ ] Status flips to connected; phone number shown
- [ ] `wa_accounts.is_connected = true`
- [ ] `GET {OPERATOR}/ready` → **200 ready** (a live socket now exists)
- [ ] Restart the Render service; confirm the session resumes **without** a
      new QR scan (`resumeConnectedAccounts` + `wa_auth_keys`)

---

## PHASE 4 — THE CRITICAL TEST: full lifecycle

### 4.1 Inbound
- [ ] Send a WhatsApp message from a **second** phone to the restaurant
- [ ] Operator logs `Forwarded inbound message ... (attempt 1/3)`
- [ ] Row in `contacts`; row in `conversations`
- [ ] Inbound row in `messages` with `wa_message_id` set
- [ ] Message visible in `/dashboard/inbox`

### 4.2 AI reply (outbound)
- [ ] AI reply generated (Groq → Gemini fallback)
- [ ] `send_whatsapp` job created in `jobs`
- [ ] Outbox cron runs; job → `done`
- [ ] **The reply arrives on the customer's phone** ← the core proof
- [ ] Reply visible in the dashboard thread

### 4.3 Manual reply
- [ ] Type a manual reply in `/dashboard/inbox/[id]`
- [ ] It arrives on the customer's phone
- [ ] Shows **✓✓ delivered** (green double-check)
- [ ] `messages.delivery_status = 'sent'`

### 4.4 Idempotency
- [ ] Restart the operator while a conversation is open
- [ ] Confirm **no duplicate** AI reply for the same inbound message
      (`messages_wa_message_id_unique`)

---

## PHASE 5 — Failure paths (proves G0.3)

These verify the reliability work. **Run them on the test tenant only.**

### 5.1 Operator down → queued, then delivered
- [ ] Suspend the Render service
- [ ] Send a manual reply from the dashboard
- [ ] UI shows **⏱ Sending** (amber), `delivery_status = 'queued'`
- [ ] Resume Render; wait for the outbox cron
- [ ] Message arrives; UI flips to **✓✓**, `delivery_status = 'sent'`

### 5.2 Disconnected account → visible failure
- [ ] Log the WhatsApp session out from the phone
- [ ] Send a manual reply
- [ ] After retries exhaust (`max_attempts = 5`, exponential backoff), UI
      shows **⚠ Not delivered** with a reason
- [ ] `delivery_status = 'failed'`, `delivery_error` populated

> **Allow ~20 minutes.** Per the §0.4 timeline this is the expected time
> to exhaustion, and it assumes the scheduler is firing every 1–2 min. If
> the message is still `queued` well past that, suspect the **scheduler**
> before suspecting the retry logic.

### 5.3 No linked account → immediate, honest failure
This is the exact bug G0.3 fixed.
- [ ] Set the conversation's `wa_account_id` to `NULL` (test tenant only)
- [ ] Send a manual reply
- [ ] API returns **502**, not 200
- [ ] UI shows **⚠ Not delivered** — never a green tick

### 5.4 Webhook rejects bad signatures
- [ ] `POST {APP}/api/webhooks/whatsapp` with a wrong/absent
      `x-webhook-signature` → **401**
- [ ] Confirm no row is written

### 5.5 Backward compatibility
- [ ] Messages sent **before** the migration show **no** delivery indicator
      (`NULL`), not a false failure

---

## PHASE 6 — Operational readiness

- [ ] Outbox cron running on schedule; `jobs` not accumulating in `pending`
- [ ] No jobs stuck in `processing` beyond 5 minutes (reaper works)
- [ ] **Queue-depth check** — `pending` jobs with `next_run_at <= now()`
      should stay near zero. A rising count is the earliest signal that
      delivery has stopped, and it appears *before* any customer
      complains. This is the single most valuable number to watch during
      the pilot, because a dead scheduler is otherwise invisible.
- [ ] Agree who checks it, and how often, for the pilot's duration
- [ ] `/admin` reachable by super admin only; non-admin → 403
- [ ] Global AI kill switch toggles and takes effect
- [ ] Update the synthetic monitor's `OPERATOR_URL` / `MAIN_APP_URL`
      repository variables to the real deployment URLs
- [ ] Consider pointing the monitor at `/ready` as well as `/health`

---

## Known risks for the pilot

1. **Baileys is an unofficial WhatsApp client.** Session drops and
   WhatsApp-side blocking are real risks. Pilot with a number the
   restaurant can afford to have interrupted.
2. **Vercel Hobby 10s timeout** vs `maxDuration = 60` — delivery may lag.
3. **Next.js 14.2.x no longer receives security patches** (see
   `docs/decisions/0001`). Schedule the major upgrade as its own gate; it
   need not block the pilot.
4. **Single operator instance** — a Render restart briefly interrupts all
   sockets; `wa_auth_keys` allows resume without re-scanning.
5. **Cron is external** — if the scheduler stops, delivery stops silently.
6. **Secret rotation is still pending** the pre-launch lockdown gate
   (Neon password exposed in git history; the `CRON_SECRET` pasted into
   chat must be regenerated before use).

## Exit criteria

G1 passes when Phase 4 completes end to end on a real phone, **and**
Phases 5.1–5.3 each show the correct delivery state. Only a failure here
justifies new code.
