# Flavourly Feature Matrix — status + evidence

Legend: ✓ built · ◐ partial · ✗ not built. Evidence pointers are file paths (tests are the strongest evidence). Status as of 2026-08-31 after gates O1/O2. Update this file at every gate.

| # | Feature | Status | Evidence |
|---|---|---|---|
| **Capture & first contact** |
| 1 | Public Hub + QR (`/r/[slug]` → shipped as `/m/[slug]`) | ✓ | `apps/main/app/m/[slug]/page.tsx`, `lib/brand/brand.wiring.test.ts` |
| 2 | WhatsApp `JOIN` + 50-pt welcome bonus (idempotent) | ✓ | `lib/ai/responder.ts` (JOIN), `lib/customer/reward-claim-store.ts#awardWelcomeBonusOnce`, `reward-claim.wiring.test.ts` |
| **Answer & convert** |
| 3 | Grounded AI concierge (24/7, deterministic-first) | ✓ | `lib/ai/responder.ts`, `lib/ai/engine.ts`, Groq+Gemini fallback |
| 4 | Menu Q&A + dietary answers | ✓ | responder menu/hours keywords + tenant-grounded prompt |
| 5 | RAG knowledge (uploaded menus/policies) | ◐ | `tenants.menuText` + `systemPrompt` ground the AI; no PDF/upload pipeline |
| 6 | Natural-language booking engine | ◐ | booking intent + reminders + cancellation flows; reservations UI page pending |
| 7 | Booking drafts (multi-message, 30-min TTL) | ✗ | deferred — see `docs/PROGRAM.md` row 9 |
| **Show up** |
| 8 | Reminder ladder 48/24/6h (exactly-once per rung) | ✓ | `lib/revenue/reminder-ladder.ts` + `-store.ts`, `/api/cron/booking-reminders`, `reminder-ladder.test.ts` (O2) |
| 9 | `CONFIRM` attendance | ✓ | responder CONFIRM/YES → `customer_confirmed_at`, `reminder-ladder.test.ts` copy tests |
| 10 | Waitlist auto-offer (cancellation → next party) | ◐ | waitlist keyword + offered/expiry states (`/api/cron/waitlist`); auto-offer on cancellation pending |
| **Return (loyalty)** |
| 11 | Points economy (R1 = 1 pt, 100 = R10 off) | ✓ | `lib/customer/loyalty.ts` (canonical), `loyalty.test.ts` |
| 12 | GPS-gated redemption (≤500m, single-use link) | ✓ | `reward_events` + `/geo-claim/[token]` + Haversine, `reward-claim.test.ts` mutation guard (O1) |
| 13 | Rewards catalog | ◐ | `loyaltyRewards` table + `listRewardCatalog` default fallback; owner CRUD UI pending |
| 14 | VIP + birthday recognition | ✓ | `lib/customer/vip-recognition.ts`, `birthday-rewards.ts` + crons |
| **Reactivate & fill** |
| 15 | Win-back ladder 30/45/60 | ✓ | `lib/customer/reactivation.ts` + campaigns + cron |
| 16 | Fill Quiet Hours campaign | ✓ | campaign type `fill_quiet_hours` in schema + campaign generator |
| 17 | Bring Back Lost / Reward VIPs presets | ✓ | campaign types `win_back` / `vip_reward` |
| 18 | Audience segmentation + ROI projector | ◐ | segmentation engine ✓; campaign segment-targeting deferred (LAUNCH_REPORT §9.4) |
| 19 | Campaign attribution (7-day) | ◐ | `revenue_events` exist; full last-touch attribution screen pending (TEL-1) |
| **Reputation** |
| 20 | Review split-routing (4–5★ → Google, 1–3★ → private) | ✓ | `lib/reputation/response-generator.ts` (sentiment), review-request flow |
| **Run the floor** |
| 21 | Daily WhatsApp brief | ✓ | `/api/cron/daily-brief` |
| 22 | Dashboard KPIs + AI insight | ✓ | `/dashboard`, `/dashboard/analytics`, `lib/analytics/engine.ts` |
| 23 | Menu Manager availability toggles (86) | ✗ | deferred — O4 |
| 24 | Roles (owner/manager/staff, server-enforced) | ◐ | `staff_members` schema + memberships; floor-role enforcement + invites pending (O4) |
| 25 | Complete & Earn (points only on real visits) | ✓ | `/api/loyalty/complete-visit` + `visit:{id}` idempotency (O1) |
| **Platform trust** |
| 26 | Multi-tenant isolation | ✓ | tenant resolver + route guards, gate J5 403/404 proof, `tenant-resolver.test.ts` |
| 27 | Webhook audit + `/api/v1/selftest` | ✗ | deferred — OPS-1 |
| 28 | Quiet hours (07:00–20:00 SAST send window) | ✗ | deferred — O3 |
| 29 | Per-tenant AI budget guard | ✗ | deferred — O3 |
| 30 | PayFast billing + 14-day trial (webhook = truth) | ✓ | `lib/billing/payfast.ts` (signature suite), gate + tier limits, `/api/billing/*` |

**Counts:** ✓ 19 · ◐ 7 · ✗ 5 (of 30). The ✗/◐ rows all have named homes in `docs/PROGRAM.md` — nothing is untracked.

**Honesty rule:** this matrix is updated only with evidence (test or file pointer), never by deleting a row or downgrading a status to make a gate look better.
