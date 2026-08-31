# Flavourly Enterprise Playbook

How we sell, price, and keep restaurant SaaS honest. Companion to `docs/PRODUCT_MAP.md` (the product law) and `docs/FEATURE_MATRIX.md` (the truth).

## 1. The pitch (one sentence)

> "Flavourly is the employee who answers every message in 3 seconds, reminds every guest so they show up, rewards them only when they're physically in your restaurant, wins them back when they drift, and then shows you the exact Rand it recovered — every week."

## 2. The Empty Chair Principle (how every conversation is framed)

An empty seat earns R0. Every feature does one of four things: **Capture** a missed booking, **Show up** (kill no-shows), **Return** (bring guests back), **Grow** (find new revenue) — and then **proves it in Rand** on one screen, so the owner never asks "is this worth it?"

## 3. The 7 CFO questions (and the honest answers)

| # | Question | Answer |
|---|---|---|
| 1 | "What exactly do I pay?" | Fixed monthly: R499–R7,999 by tier (+R2,500/location for groups). Setup fee is quoted up front, once. No per-message surprises: tier quotas are published. |
| 2 | "What is my ROI?" | The dashboard prints **verified** recovered revenue (PayFast + rebooking events), not estimates. Pilot dashboard replaces illustrative math with the restaurant's own numbers after 30 days. |
| 3 | "What if the AI says something wrong?" | GREEN/YELLOW/RED approval routing: risky replies (refunds, legal, food safety) never send without a human. Owner can kill all AI in one tap. |
| 4 | "Is it POPIA compliant?" | Consent recorded at onboarding; STOP = instant blocklist enforced in every sending path; quiet-send windows planned (O3); data per-tenant isolated. |
| 5 | "What happens to my WhatsApp number?" | It stays yours — we connect as a linked device (like WhatsApp Web). Cancel anytime; the number and the guest database leave with you. |
| 6 | "What if you disappear?" | Exportable guest database (contacts + loyalty ledger). The operator is a separate, replaceable component (ADR-014 two-server architecture). |
| 7 | "Why not just hire someone?" | 5 recovered tables/week at ±R550 ≈ R11k/mo; a part-timer costs more and doesn't reply in 3 seconds at 22:00. |

## 4. Pricing mechanics

- 5 tiers, Rand, gold-highlighted anchor (Premium R3,999), each tier mapped to a customer size (kota shop → group).
- 14-day trial, no card. Trial → PayFast tokenized subscription; **the ITN webhook is the only truth** for activation (browser redirects never count).
- Setup fees (R2,500–R75,000 by tier) cover onboarding cost. Annual = 2 months free.
- Failure/cancel → PayFast dunning → `past_due` → `canceled`; the billing gate stops every sending path (dashboard stays readable — the owner can always see their data).

## 5. The success-fee model (for enterprise/lighthouse deals)

For a flagship (e.g. Marble/Gemelli class): base fee + 10–20% of **verified** recovered revenue above a baseline measured over the first 30 days. Only payable on the same attribution screen the owner sees — never on our own spreadsheet. Cap the fee at 2× the tier price so the deal never feels like a shakedown.

## 6. The honest status report pattern (used in every QBR)

1. **What worked** — with Rand figures from the dashboard (campaigns sent → booked → recovered).
2. **What didn't** — messages unanswered, campaigns under-performed, ratings flat. Named, not hidden.
3. **What we're doing about it** — one owner action we need (approve drafts, connect Google).
4. **What we will NOT promise** — future features ship when the gate report is green (see `docs/NAHALABS_ENGINEERING_STANDARD.md`), not when a sales deck needs them.

## 7. Churn defence (the retention ladder)

1. **Activation < 10 min** — onboarding test message (the "wow") is the anti-churn moment.
2. **Weekly habit** — daily brief + morning dashboard = the app becomes the coffee companion.
3. **Proof cadence** — monthly "recovered R18,400 — you pay R1,499" screen in Billing.
4. **Kill-switch trust** — owners who feel in control leave the AI on.
5. **Win-back on ourselves** — the same reactivation ladder that saves their guests runs on *their* engagement drop (planned TEL-1).

## 8. Red lines

- Never quote unverified numbers as verified; illustrative math is labelled illustrative until the pilot dashboard replaces it.
- Never promise a ✗/◐ feature row from `FEATURE_MATRIX.md` in a live deal; the matrix is the source of truth for what exists.
- Never ship a feature to unblock a sale without its gate report.
