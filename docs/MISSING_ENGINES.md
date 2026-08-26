# Gate 4 — Missing Engines & Features

This documents the features added to close the gaps found in the Gate 1 audit.
Most engines (revenue intelligence, segmentation, reputation, market,
marketing, multi-channel inbox, analytics, loyalty UI, event detector) already
existed and are **not** re-implemented here. These are the genuinely-missing
pieces, each with its data model, API/UI, tests and wiring.

## 1. Approval workflow enforcement (Engine 6)

**Before:** `approvalRequests` table + store + listing page existed, but
`createApprovalRequest` had **no callers** and the webhook auto-sent every AI
reply. Nothing ever gated sending on GREEN/YELLOW/RED.

**Now:**
- `lib/operations/approval-classifier.ts` — pure `classifyMessageRisk(text)`
  → `green | yellow | red` and `decideApprovalAction(risk)`:
  - GREEN → `auto_send`
  - YELLOW / RED → `require_approval` (owner controls)
- The WhatsApp webhook (AI auto-send path) now classifies every AI reply:
  - GREEN replies are enqueued to the outbox as before.
  - YELLOW/RED replies are recorded (outbound message row, honest
    `delivery_status = null` with a "held for approval" error) and an
    `approval_requests` row is created instead of sending.
- `lib/operations/approval-request-store.ts#dispatchApprovedRequest` — approving
  a request now resolves the conversation's WhatsApp account + contact phone
  and **hands the held message to the outbox** (previously "Approve" only
  flipped the row). Rejection leaves it unsent.
- The `/dashboard/operations/approval-requests` page gained Approve/Reject
  actions.

**Signals:** RED = refund / money-back / legal / food-safety / escalation.
YELLOW = discount / promo / offer / apology. GREEN = booking / menu / hours /
loyalty replies.

## 2. Per-tier message quota + rate limiting

**Before:** no per-tier limits anywhere; a Starter tenant could send without
bound.

**Now:**
- `lib/billing/tier-limits.ts` — pure per-tier `TierLimits`:
  - Starter R499: 500 msgs/mo, 100/hr, 1 competitor, Engine 1
  - Casual R1,499: 2,000/mo, 250/hr, 3 competitors, Engines 1-3
  - Premium R3,999: 10,000/mo, 500/hr, 5 competitors, Engines 1-5
  - Signature R7,999: 50,000/mo, 1,000/hr, 10 competitors, all engines
  - Group R19,999: unlimited/mo, 2,000/hr, unlimited competitors, all engines
- `checkTierSendAllowed()` returns `allowed | monthly_quota_exceeded |
  hourly_rate_exceeded`.
- `lib/billing/tier-limits-store.ts#evaluateTierLimit` — counts a tenant's
  outbound messages in the current month / last hour and applies the gate.
- The **outbox dispatcher cron** now enforces it:
  - hourly rate hit → **defers** the job ~10 min (message stays pending, not lost)
  - monthly quota hit → **fails** the job visibly ("renew to resume")

## 3. Birthday rewards (Rewards/Loyalty)

**Before:** no birthday field, no detection, no campaign.

**Now:**
- `contacts.birthday` (MM-DD) column (additive migration in
  `drizzle/0018_missing_engines.sql` + runtime `/api/migrate`).
- `lib/customer/birthday-rewards.ts` — pure `daysUntilNextBirthday()`,
  `isBirthdayInWindow()` (next 7 days, handles Dec→Jan wrap), 
  `buildBirthdayReward()` (personalised offer + WhatsApp copy).
- `/api/cron/birthday-rewards` (daily 07:00) — for each tenant, generates a
  reward + queues it through the outbox. POPIA: blocklisted contacts never
  targeted.
- Demo-tenant seeding now writes a in-window birthday on ~half the contacts so
  the sales pitch shows a live example.

## 4. VIP alerts daily 07:00 brief (Engine 2)

**Before:** VIP alerts were raised only when a VIP sends a first message
(event-driven); there was no scheduled morning brief.

**Now:**
- `lib/customer/vip-daily-brief.ts` — pure `buildVipDailyBrief()` producing a
  staff-facing morning summary + a suggested action for the top VIP.
- `/api/cron/vip-alerts` (daily 07:00) — for each tenant, reads today's VIP
  alerts and sends the brief over WhatsApp via the outbox (logs only when no
  connected account).

## 5. Loyalty rules correction

**Before:** the WhatsApp loyalty reply offered "100 pts: Dessert / 250 pts:
R100" — a mismatch with the PRD (R1 spent = 1 point, 100 points = R10 off).

**Now:** `lib/customer/loyalty.ts` holds the canonical rules and message
(`pointsForSpend`, `rewardsRedeemable`, `loyaltyBalanceMessage`); the AI
responder uses it.

## Hard-coded rules already present (verified, not rebuilt)

- Master AI kill-switch (`systemSettings.masterAiSwitch` + `/admin` toggle)
- Per-tenant manual mode / `ai_enabled` (enforced in the webhook)
- POPIA opt-out (`STOP`/`UNSUBSCRIBE` handled in the webhook + responder;
  `contacts.blocklisted` enforced in every sending path)
- Billing gate (`decideBillingGate`, enforced in responder + cron sends)
- SA holidays in the event detector (Heritage/Braai/Freedom/Youth/Women's/
  Reconciliation Day, etc.)

## Tests

- `lib/operations/approval-classifier.test.ts` + `approval.wiring.test.ts`
- `lib/billing/tier-limits.test.ts` + `tier-limits.wiring.test.ts`
- `lib/customer/birthday-rewards.test.ts` + `birthday.wiring.test.ts`
- `lib/customer/vip-daily-brief.test.ts` + `vip-daily-brief.wiring.test.ts`
- `lib/customer/loyalty.test.ts`
- `e2e/missing-engines.spec.ts` (auth-gating + cron bearer contract)
- Full `npm run test:main` → **1207 passed / 0 failed.**
