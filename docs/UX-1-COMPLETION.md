# UX-1 Completion — Orderly / Flavourly

Status: engineering completion sweep.

## Rules
- Light theme remains the default; dark mode is opt-in.
- Every owner action names a commercial or operational consequence.
- No dashboard card invents a metric when its data is missing.
- Empty states distinguish "zero" from "not yet measured".
- AI-generated content is visibly separated from verified operational facts.
- Customer-facing automation keeps POPIA opt-out and human takeover visible.

## Surfaces covered
- Overview / Revenue Intelligence
- Inbox
- Customers / VIP
- Menu Manager
- Marketing / Campaigns
- Market Intelligence
- Approvals
- WhatsApp
- Billing
- Staff & Roles
- API Keys / Webhooks

## Anti-AI-slop checks
- Restaurant names, prices, dishes and availability come from tenant data.
- Revenue claims must reference recorded revenue events or verified booking outcomes.
- Market opportunities retain evidence and confidence.
- AI budget exhaustion falls back to deterministic/human handling.
- Public menu copy does not fabricate unavailable items.

## Remaining visual QA
Visual screenshot comparison still belongs in the Playwright/product-design pass after deployment; this document records the engineering guardrails, not a claim that a human visual audit has already been performed.
