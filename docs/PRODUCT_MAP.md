# Flavourly Product Map

Every page, what it does, what the owner can click, what "success" means, and
the money-proof each page must show. **Product law: if a page can't name its
Rand metric, it doesn't ship.**

---

## A. THE PUBLIC STOREFRONT (sells the product)

### 1. Landing page `/`

- **Purpose:** turn a stranger into a trial signup in under 60 seconds.
- **What the visitor sees:** headline ("Your restaurant, fully booked. While you cook."), SA overline, gold CTA "Start 14-day trial", ghost CTA "See pricing", 6 benefit cards (one per engine, in plain English), "Live in 5 minutes" 3 steps, FLAVOURLY HQ proof card (R recovered / bookings today / 3-sec replies), trust bar (POPIA, any phone, kill-switch), FAQ.
- **Buttons:** Start trial → `/sign-up`; See pricing → `/pricing`; Sign In.
- **Journey:** ad/WhatsApp referral → landing → reads one card that matches their pain → clicks trial.
- **Success =** visitor clicks "Start 14-day trial".
- **Value proof on page:** the HQ card shows real product output (revenue recovered, reply speed) — not claims, evidence.

### 2. Pricing page `/pricing`

- **Purpose:** answer "what does it cost and which one is mine?" without a sales call.
- **What the visitor sees:** 5 tiers in Rand — Starter R499 (kota/takeaway), Casual R1,499, Premium R3,999 (gold-highlighted), Signature R7,999, Group R19,999 + R2,500/location; setup fees; "2 months free on annual"; which engines each tier includes.
- **Buttons:** "Start trial" per tier → signup with that plan pre-selected.
- **Success =** visitor self-selects a tier and starts trial.
- **Value proof:** each tier lists money features ("fills slow Tuesdays", "wins back lost customers") so price is tied to revenue, not tech.

### 3. Privacy `/privacy` + Terms `/terms`

- **Purpose:** trust + POPIA compliance. Restaurant owners (and their customers) must see what data is collected, why, retention, rights, contact.
- **Success =** a prospect's compliance worry is removed; consent checkbox at signup stores a legal consent record.

### 4. Sign up / Sign in (Clerk)

- **Purpose:** account creation with zero custom auth code.
- **Success =** account exists + consent recorded + redirect to `/onboarding`.

---

## B. ONBOARDING `/onboarding` (the 5-minute miracle)

1. **Restaurant profile** (name, hours, avg check, menu link) → gives the AI facts so it never invents prices (grounded answers).
2. **WhatsApp QR connect** → creates the pipe (Operator socket). Works exactly like WhatsApp Web.
3. **Send test message** → owner sees a real AI reply on their own phone = the "wow" moment. **This is time-to-value.**
4. **Kill-switch + POPIA explainer** → trust: "you stay in control, one tap stops everything."
5. **Done** → flag set, dashboard unlocks.

- **Success =** test message answered by AI within 5 minutes of signup. If this happens, the owner almost never churns.

---

## C. THE DASHBOARD (runs the restaurant's money machine)

### 5. Overview `/dashboard`

- **Hosts:** Engine 1 daily brief + KPI summary.
- **Sees:** "Money on the table" card (verified + recovered revenue in Rand), bookings today, unanswered messages, no-shows saved, today's brief.
- **Buttons:** jump-to links (Inbox, VIP, Campaigns).
- **Journey:** owner opens app with morning coffee → 10 seconds → knows yesterday's money and today's priorities.
- **Success =** owner opens it daily (habit formed).
- **Value proof:** Rand figure sourced from PayFast webhooks + rebooking events — real money, not vanity metrics.

### 6. Inbox `/dashboard/inbox`

- **Hosts:** Engine 6 multi-channel inbox + approvals banner + AI responder + manual takeover.
- **Sees:** conversation list with channel icons + filters (WhatsApp/Email/Instagram/Facebook), chat thread, AI draft or sent reply, delivery state (Queued/Sent/Delivered/Failed/Unknown — never fake green).
- **Buttons:** Send reply, Take over (manual mode), Approve/Reject (yellow/red drafts), channel filter.
- **Journey:** customer asks "table for 4 Friday?" → AI books it → owner sees it already handled; owner only steps in when they want.
- **Success =** 0 unanswered messages older than 5 minutes; response rate ~100%.
- **Value proof:** each conversation tagged with outcome (booked / waitlisted / deposit taken) → Rand value per answered message.

### 7. Customers `/dashboard/customers`

- **Hosts:** Engine 2 segmentation + profiles + loyalty.
- **Sees:** segment counts (VIP / Regular / At-risk / Dormant), searchable list, per-customer profile: visits, spend, last visit, segment history, opt-out status.
- **Buttons:** open profile, view reactivation suggestions.
- **Success =** owner can name their top 10 customers without thinking.
- **Value proof:** lifetime value per customer shown in Rand — proves who the whales are.

### 8. VIP Today `/dashboard/customers/vip-today`

- **Hosts:** Engine 2 VIP alerts (Gate #10).
- **Sees:** gold cards: "Thabo (VIP, R4,200 lifetime) booked tonight 19:00" + suggested action (welcome message / comp dessert / owner greet).
- **Buttons:** Send welcome, Mark handled.
- **Journey:** 16:00 daily check → staff prepped before service.
- **Success =** every VIP walk-in gets white-glove treatment → repeat frequency up.
- **Value proof:** VIP visits this week + their spend vs average guest (whales spend 3–5×).

### 9. Reputation `/dashboard/reputation`

- **Hosts:** Engine 3 review monitoring + response drafting + review requests.
- **Sees:** total/average rating, sentiment split, review feed with AI-drafted replies (editable), "Sent" badges; sub-pages: review-requests stats, competitor ratings.
- **Buttons:** Send Response, Regenerate, Edit.
- **Journey:** new 1-star review at 22:00 → drafted apology ready at 08:00 → owner edits one word → sends → damage contained.
- **Success =** 100% of reviews answered within 48h; average rating trending up.
- **Value proof:** rating trend line + "reviews answered" count — Google rating directly drives covers.

### 10. Market Intelligence `/dashboard/market/*`

- **Hosts:** Engine 4 (competitors, menu/promo tracking, opportunities, positioning).
- **Sees:** competitor list with distance/rating/trend; menu change alerts ("Nando's added 2 items, prices +5%"); promotion alerts; opportunities ("No one offers Sunday brunch within 5km — score 0.85"); positioning (your price band vs market).
- **Buttons:** Discover competitors, Add manually, Mark opportunity addressed, View menu history.
- **Success =** owner launches one offer per month taken from an opportunity card.
- **Value proof:** "gaps competitors left open" count + promotions you caught early.

### 11. Marketing `/dashboard/marketing`

- **Hosts:** Engine 5 daily social briefs.
- **Sees:** today's brief: 3–5 post ideas (topic, audience, message, CTA, visual suggestion); history.
- **Buttons:** Generate New Brief.
- **Success =** owner posts 3×/week with zero thinking.
- **Value proof:** briefs are built from slow-day data + events → posts target empty tables, not random content.

### 12. Campaigns `/dashboard/marketing/campaigns`

- **Hosts:** Engine 5 campaign generator + launch (WhatsApp sends via outbox, POPIA-safe).
- **Sees:** campaign list (draft/launched/completed), target segment, offer, estimated reach/revenue.
- **Buttons:** Generate Campaign, Launch, view results.
- **Journey:** "Win back 43 dormant regulars with 10% off Tuesday" → Launch → 43 WhatsApps go out → bookings appear in Inbox.
- **Success =** launched campaigns show recovered Rand (attributed bookings).
- **Value proof:** recovered revenue per campaign — the single most money-making page in the app.

### 13. Events `/dashboard/marketing/events`

- **Hosts:** Engine 5 event detector (SA holidays next 30 days).
- **Sees:** "Heritage Day in 12 days — suggestion: family braai platter" + Create Campaign button.
- **Success =** no holiday rush ever surprises the owner.
- **Value proof:** events converted into campaigns → campaign revenue.

### 14. Calendar `/dashboard/marketing/calendar`

- **Hosts:** Engine 5 content calendar (7-day plan).
- **Sees:** one post per day, mixed types; Mark as Posted.
- **Success =** 7/7 posted weeks → consistent presence → discovery.
- **Value proof:** posting streak vs bookings trend side by side.

### 15. Analytics `/dashboard/analytics`

- **Hosts:** Engine 6 analytics (all engines aggregated) + forecast + cohorts.
- **Sees:** tabs per engine; KPI cards with WoW/MoM arrows; revenue area chart; bookings bars; segment donut; 30-day forecast; cohort retention.
- **Success =** owner makes one decision per week from a chart (e.g., "Tuesdays still low → launch Tuesday campaign").
- **Value proof:** forecast + trend deltas in Rand — shows direction of the business.

### 16. Channels `/dashboard/operations/channel-configs`

- **Hosts:** Engine 6 multi-channel setup.
- **Sees:** WhatsApp (connected), Email/Instagram/Facebook (enable + credentials + test connection).
- **Success =** all customer channels flow into one Inbox.
- **Value proof:** messages-per-channel count → shows revenue sources beyond WhatsApp.

### 17. Approvals `/dashboard/operations/approval-requests`

- **Hosts:** Engine 6 risk workflow (green auto / yellow approve / red owner-controls).
- **Sees:** pending AI drafts with risk badge + conversation context.
- **Buttons:** Approve (sends via outbox), Reject (discards).
- **Success =** pending count = 0 each night; owner feels control without effort.
- **Value proof:** complaints/refunds handled by a human = protected reputation.

### 18. WhatsApp `/dashboard/whatsapp`

- **Hosts:** the pipe (Operator connection).
- **Sees:** QR to connect, connection status, test message button.
- **Success =** status "Connected" always green; re-scan rare.
- **Value proof:** uptime of the connection = uptime of revenue.

### 19. Billing `/dashboard/billing`

- **Hosts:** PayFast subscriptions.
- **Sees:** current plan, trial days left, upgrade buttons per tier, manage/cancel.
- **Success =** trial → paid conversion; owner never confused about cost.
- **Value proof:** shows "recovered this month: R X" next to "you pay: R499" — the ROI sentence that prevents churn.

### 20. Settings `/dashboard/settings`

- **Hosts:** restaurant profile, hours, menu, AI personality, Google Places config, manual mode, POPIA data controls.
- **Success =** AI answers match reality (hours/prices never wrong).
- **Value proof:** fewer corrections = more trust in AI = more automation left on.

---

## D. SUPER ADMIN (you = the SaaS operator)

### `/admin`

- **Sees:** platform KPIs (tenants, messages, verified revenue across all restaurants), each tenant's plan + status, per-tenant toggles (ai_enabled, manual_mode), **master AI kill-switch**.
- **Buttons:** toggle tenant AI, global kill-switch, view tenant.
- **Success =** you can stop every AI message in the platform in one tap (safety), and see platform revenue grow.
- **Value proof:** platform verified revenue = your revenue.

### `/admin/analytics`

- **Sees:** tenant comparison table, feature adoption, totals.
- **Success =** you know which tenants are about to churn (low usage) and which features sell.

---

## E. HOW PRICING WORKS (the SaaS money mechanics)

1. **Trial 14 days** `plan_status = trialing` — no card required; owner experiences value first.
2. **Upgrade** → `/api/billing/checkout` → PayFast Checkout (ZAR, tokenized subscription) → owner pays on PayFast (local, trusted).
3. **Truth = webhook:** PayFast ITN hits `/api/billing/webhook` (signature-verified) → plan flips to `active`. Browser redirect never counts.
4. **Billing gate:** every sending path (AI replies, campaigns, review requests, follow-ups) checks the gate. Unpaid → sending stops, dashboard stays readable with "Renew to resume" banner. You never give away the product for free.
5. **Failure/cancel** → PayFast retries (dunning) → `past_due` → `canceled`.
6. **Setup fees** (R2,500–R75,000) cover your onboarding cost per tier — charged on first invoice.
7. **Annual = 2 months free** — cash upfront, lower churn.

### SaaS pricing page standards (and Flavourly's compliance)

- ✅ 3–5 tiers with a highlighted anchor (Premium, gold)
- ✅ Local currency (Rand), prices ending in 99/99-style psychology
- ✅ Each tier mapped to a customer size (kota → group)
- ✅ Feature inclusion list per tier (engines included)
- ✅ Trial CTA on every tier, no "Contact sales" wall for small tiers
- ✅ Setup fee transparency, annual discount visible
- ✅ FAQ + POPIA/trust signals near the price
- ⬜ Add later: monthly/annual toggle, comparison table, testimonials with numbers (once you have pilot results)

### SaaS application standards (what "real SaaS" means)

Multi-tenant isolation · Clerk auth · subscription billing + dunning + gate · onboarding time-to-value < 10 min · self-serve signup→paid · per-tenant kill switches · POPIA consent + STOP opt-out · webhooks as truth · observability (health + cron proof) · docs/privacy/terms · cancel flow that works · retention metrics (activation, churn, LTV). **Flavourly has all of these built.**

---

## F. THE OWNER'S WEEKLY RHYTHM (how the pages chain into money)

- **Daily (2 min):** Overview → Inbox → VIP Today → Approvals
- **Weekly (15 min):** Marketing brief → Calendar → Campaigns → Events
- **Monthly (30 min):** Analytics → Reputation → Market Intelligence → Billing

Every page either **captures money** (Inbox, Campaigns, VIP), **protects money** (Approvals, Reputation, Settings), or **shows money** (Overview, Analytics, Billing).
