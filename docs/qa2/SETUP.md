# GATE QA-2 — Setup Guide: Self-Testing App, Failure Alerts & Render Keep-Alive

**Audience:** the platform owner (naha.thabiso@gmail.com).
**What this buys you:** the app checks itself every 10 minutes (cheap sweep — which
also keeps the free Render operator awake) and every 6 hours (full human-like
Playwright run). When anything breaks you get an **email** *and* a red **unread
badge in your Super Admin portal**, naming the exact failing check with an
evidence/report link — deduped to once per 6 hours per check so a flapping
failure never spams you.

---

## 1. The moving parts (already in the repo)

| Part | Where | Cadence |
|---|---|---|
| Smoke sweep | `GET /api/cron/qa-sweep` (CRON_SECRET bearer) | every 10 min (cron-job.org) |
| Persona suite | `tests/e2e/personas/` (6 personas, all nav, console errors, screenshots) | every PR + every 6h (GitHub Actions) |
| Alert pipeline | `lib/qa/alert-policy.ts` + `lib/qa/alerts.ts` → email + `admin_notifications` row | on any failure |
| Portal inbox | `/admin` → **QA Failure Alerts** panel + unread badge | always visible |
| Alert ingestion | `POST /api/cron/qa-alert` (CRON_SECRET bearer) | GitHub Actions posts failures here |
| Render keep-alive | the sweep's operator `/health` probe + the `Keep Operator Awake` fleet job (5 min) | continuous |

**Render keep-alive note:** free Render services sleep after ~15 min of
inactivity. The sweep pings the operator every 10 minutes, which keeps it
awake; the pre-existing `keep-operator-awake` fleet job pings every 5 minutes.
These pings are a well-known workaround, not an officially supported
mechanism — the only guaranteed always-on option is a paid Render plan.

---

## 2. One-time setup (15 minutes)

### 2.1 Vercel — add the alert email variables

In Vercel → your project → Settings → Environment Variables:

| Variable | Value | Required? |
|---|---|---|
| `RESEND_API_KEY` | a key from https://resend.com | Recommended — without it, alerts still land in the portal but no email is sent |
| `QA_ALERT_TO` | `naha.thabiso@gmail.com` (the default) | Optional |
| `QA_ALERT_FROM` | `Flavourly QA <onboarding@resend.dev>` (the default) until you verify a domain | Optional |

Then redeploy Vercel. `CRON_SECRET`, `OPERATOR_URL`, `OPERATOR_API_KEY` and
`WEBHOOK_SECRET` are already required by the existing fleet — the sweep and the
alert route reuse them.

### 2.2 cron-job.org — schedule the 10-minute sweep

**Easiest (one click):** open `/admin` → **Cron Fleet Manager** → save your
cron-job.org account API key → *Sync fleet*. This creates/updates **all 24
canonical jobs**, including the new **QA Smoke Sweep** (every 10 minutes).
The manager + the hourly system watchdog keep the fleet healed automatically.

**Manual alternative:**

1. Create a free account at [cron-job.org](https://cron-job.org).
2. **Create cronjob** → URL
   `https://gemino-flavourly-whatsapp.vercel.app/api/cron/qa-sweep`
3. Schedule → **every 10 minutes**.
4. Advanced → Request headers → add
   `Authorization: Bearer <your CRON_SECRET>`.
5. Save + enable. (Enable "save responses" so failures keep a body.)

> ⚠️ Never put the CRON_SECRET in the URL query string — the app rejects
> query-string auth by design (it leaks into logs). Header only.
> ⚠️ The schedule must live on cron-job.org — **never** in `vercel.json`
> (owner rule; the repo's `vercel.json` intentionally declares no crons).

### 2.3 GitHub — secrets for the 6-hourly production run

In the repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `QA_EMAIL` | the QA account's sign-in email (e.g. your own) |
| `QA_PASSWORD` | the QA account's **password** — enable password sign-in for that account in Clerk first |
| `CRON_SECRET` | same value as Vercel's `CRON_SECRET` — lets the workflow post failures to the alert pipeline |

The workflow (`.github/workflows/qa-persona-suite.yml`) then:

- runs the **full persona suite on every PR** (GATE_MOCK build, always, no
  secrets needed);
- every 6h adds a **production run** (read-only by design — no button writes
  against live data) when the secrets exist;
- uploads the **Playwright HTML report** as an artifact on every run;
- on failure, posts the failing check to `/api/cron/qa-alert` → email + portal
  badge, deduped 6h.

### 2.4 Apply the database table (one GET)

The alert rows live in a new `admin_notifications` table. As super admin, open
`https://gemino-flavourly-whatsapp.vercel.app/api/migrate` **once** after
merging/deploying — the idempotent runtime migration creates it
(same flow as every previous gate).

---

## 3. How to read a failure

1. **Email:** subject `Flavourly QA broken: <check>` — e.g.
   `Flavourly QA broken: qa-sweep/database`. Body: what failed + evidence link.
2. **Portal:** `/admin` → red **"N unread alerts"** badge next to the title →
   **QA Failure Alerts** panel: severity chip (CRITICAL/WARNING/INFO), check
   name, message, report link, age. **Mark all read** clears the badge.
3. **Sweep response** (if you want the raw JSON):
   `curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/qa-sweep`
   — HTTP 200 = all critical checks green (warnings allowed); HTTP 503 =
   something critical broke (cron-job.org also marks the run failed).

Dedupe rule: the *same* check re-alerts at most once per 6 hours, no matter
how many runs fail in that window. Different checks alert independently.

---

## 4. Safety model (what the self-tests are allowed to do)

- The **sweep is read-only**: no business-data writes; its only write is an
  alert row when a check *fails*.
- The **persona suite writes only to a QA database**: in GATE_MOCK mode that is
  the in-memory pg-mem store; production runs are **read-only** (they never
  click write-buttons).
- **No real WhatsApp sends, no PayFast live calls, no deletes of production
  data** are ever performed by the QA suite.
- Credentials travel via env vars / GitHub secrets only — the suite
  source-scans itself to enforce that.

---

## 5. Quick reference

| Question | Answer |
|---|---|
| Why is my sweep alerting "operator unreachable"? | Render was down/asleep for >10 min or `OPERATOR_URL` is wrong. The alert self-clears when the next sweep passes. |
| How do I stop the emails but keep the portal badge? | Remove `RESEND_API_KEY` from Vercel (alerts become `skipped_no_key`). |
| Where are the Playwright reports? | GitHub Actions → the run → Artifacts → `playwright-gate-mock-report` / `playwright-production-report` (30-day retention). |
| How do I run the persona suite locally? | `bash scripts/qa2-evidence-run.sh` (boots the GATE_MOCK app + mock operator, runs the whole suite, screenshots included). |
| Does the sweep cost anything? | No — cron-job.org free tier, Resend free tier, GitHub Actions free minutes all cover this volume comfortably. |
