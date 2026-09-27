# Flavourly / Orderly Feature Matrix — completion sweep

Legend: ✓ built · ◐ partial · ✗ not built. This matrix is evidence-based; deployment/debug status is tracked separately.

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Public Hub + QR | ✓ | `app/m/[slug]` |
| 2 | WhatsApp JOIN + welcome bonus | ✓ | `lib/ai/responder.ts`, reward store |
| 3 | Grounded AI concierge | ✓ | responder deterministic-first + providers |
| 4 | Menu Q&A + dietary answers | ✓ | responder + live menu |
| 5 | RAG knowledge (menus/policies) | ✓ | `lib/knowledge/store.ts`, `/api/knowledge`, PDF/TXT/MD/CSV/JSON upload |
| 6 | Natural-language booking engine | ✓ | booking draft engine + confirmation + reservations workspace |
| 7 | Booking drafts (30-min TTL) | ✓ | `lib/revenue/booking-drafts.ts`, expiry cron |
| 8 | Reminder ladder 48/24/6h | ✓ | existing reminder engine |
| 9 | CONFIRM attendance | ✓ | responder + reservation state |
| 10 | Waitlist cancellation auto-offer | ✓ | `lib/revenue/waitlist-auto-offer.ts`, waitlist cron |
| 11 | Points economy | ✓ | canonical loyalty rules |
| 12 | GPS reward redemption | ✓ | reward events + geo-claim |
| 13 | Rewards catalogue | ✓ | `/api/rewards`, Loyalty dashboard manager |
| 14 | VIP + birthday recognition | ✓ | VIP/birthday engines |
| 15 | Win-back ladder | ✓ | reactivation engine |
| 16 | Fill Quiet Hours campaigns | ✓ | campaign generator |
| 17 | Bring Back Lost / Reward VIP presets | ✓ | campaign types |
| 18 | Audience segmentation + ROI projector | ✓ | campaign segment selector + `/api/marketing/roi-projector` |
| 19 | Campaign attribution | ✓ | attribution reconciliation + dedicated attribution dashboard |
| 20 | Review split-routing | ✓ | reputation engine |
| 21 | Daily WhatsApp brief | ✓ | daily brief cron |
| 22 | Dashboard KPIs + intelligence | ✓ | dashboard + Orderly Intelligence |
| 23 | Menu Manager availability toggles | ✓ | `/dashboard/menu`, menu API |
| 24 | Roles owner/manager/staff | ✓ | server-enforced tenant roles + invites |
| 25 | Complete & Earn | ✓ | complete-visit loyalty path |
| 26 | Multi-tenant isolation | ✓ | tenant resolver + memberships |
| 27 | Webhook audit + self-test | ✓ | audit table/viewer + `/api/v1/selftest` |
| 28 | Quiet hours 07:00–20:00 SAST | ✓ | existing outbox enforcement |
| 29 | Per-tenant AI budget guard | ✓ | `lib/billing/ai-budget.ts` |
| 30 | PayFast billing + 14-day trial | ✓ | existing PayFast gate |

**Feature status: 30 / 30 built.**

## Remaining work
Feature implementation is no longer the blocker. The next pass is debugging/validation: TypeScript, lint, migrations against Neon, Playwright, Vercel deployment, and live smoke checks.
