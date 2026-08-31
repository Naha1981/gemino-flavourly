# Flavourly Build Program

Every skill from the NahaLabs governance pack lands in ONE named home — a build gate, a repo doc, or a deferred ADR. Nothing vague, nothing forgotten. Status is updated per gate.

**Sequence:** DOC-1 → O1 → O2 → O3 → O4 → UX-1 → TEL-1 → QA-1 → API-1 → OPS-1. One gate at a time; each gate report goes to the owner for review; the owner approves each merge.

| # | Skill(s) | Lands as | Gate | Type | Status |
|---|---|---|---|---|---|
| 1 | Governance V3 + Architect Prompt + Constitution | `docs/NAHALABS_ENGINEERING_STANDARD.md`, `CLAUDE.md`, `.github/PULL_REQUEST_TEMPLATE.md` | DOC-1 | doc | ✅ DONE (2026-08-31) |
| 2 | TAKT v1/v2 | `docs/runbooks/TAKT-EQUIVALENT.md` + ADR-024 (TAKT tool itself not installed — no invented syntax) | DOC-1 | doc/ADR | ✅ DONE |
| 3 | WhatsApp Architecture + Vercel-cron rule | `WHATSAPP_ARCHITECTURE.md` (root) + zero `vercel.json` crons verified | DOC-1 | doc/verify | ✅ DONE (verified: no `crons` key in vercel.json) |
| 4 | Feature matrix + this program | `docs/FEATURE_MATRIX.md` + `docs/PROGRAM.md` | DOC-1 | doc | ✅ DONE |
| 5 | Discovery skills (Figranium, Awesome-Selfhosted, OpenAlternative, Free-AI-APIs, API Arsenal) | `docs/skills/*.md` reference prompts + `docs/API_REGISTRY.md` | DOC-1 | doc | ✅ DONE |
| 6 | Enterprise/Strategy playbook | `docs/ENTERPRISE_PLAYBOOK.md` | DOC-1 | doc | ✅ DONE |
| 7 | OSS-first + Integration-SDK policy | ADR-020 (exclude n8n/Zapier/Make/Trigger.dev), ADR-021 (Activepieces deferred, review trigger: 3+ client integrations) | DOC-1 | ADR | ✅ DONE |
| 8 | **Loyalty + GPS redemption** (Orderly) | Build: `reward_events`, `/geo-claim/[token]`, Haversine ≤500m, JOIN/REDEEM, complete-visit | **O1** | build | ✅ DONE (2026-08-31, migration 0021) |
| 9 | Booking drafts + 48/24/6h reminders + waitlist offers | Reminders ladder + CONFIRM flow: migration 0022 + `/api/cron/booking-reminders`. Booking drafts (30-min TTL) + waitlist auto-offer: deferred (see Non-Goals) | O2 | build | 🟡 PARTIAL |
| 10 | Win-back ladder + review split-routing + quiet hours + AI budget guard | Win-back ✅ (reactivation campaigns), review split-routing ✅ (sentiment routing). Quiet hours + per-tenant AI budget guard: not built | O3 | build | 🟡 PARTIAL |
| 11 | Staff roles + Menu Manager (86) + public hub `/r/[slug]` | Public hub ✅ (`/m/[slug]`), staff schema ✅ (`staff_members` + memberships). Staff floor UI + Menu Manager: not built | O4 | build | 🟡 PARTIAL |
| 12 | UX Intelligence + Anti-AI-Slop audit + finish light theme | Stitch redesign shipped (light-default tokens, dark opt-in). Formal UX-1 audit pass: pending | UX-1 | build/audit | ⏳ PENDING |
| 13 | Telemetry & Intent Intelligence (events→rules→scores→actions→attribution) | Conversation outcome classification + revenue events exist. Full intent-scored next-best-action loop: pending | TEL-1 | build | ⏳ PENDING |
| 14 | Playwright personas + MatrAIx synthetic QA | Personas + storage states shipped in `e2e/` (gate V4/V5). MatrAIx: report-mode-first per ADR-023 | QA-1 | build | ⏳ PENDING |
| 15 | Agent-ready: `/api/v1`, integrations docs, Resend email; MCP gateway | `docs/integrations/` skeleton (this gate). API v1 + Resend + MCP: deferred (ADR-022) | API-1 | build | ⏳ PENDING |
| 16 | Ops: selftest, webhook viewer, broadcast, runbook, Graphify map | `/api/health`, cron fleet manager, watchdog shipped. Selftest/webhook viewer/broadcast/runbook/Graphify: pending | OPS-1 | build | ⏳ PENDING |

## Deferred items (tracked, not forgotten)

| Item | Home | Trigger |
|---|---|---|
| Booking drafts (30-min TTL) | this table, row 9 | O2 follow-up gate |
| Waitlist auto-offer on cancellation | this table, row 9 | O2 follow-up gate (currently: expiry sweep only) |
| Quiet hours (07:00–20:00 SAST send window) | row 10 | O3 follow-up gate |
| Per-tenant AI budget guard | row 10 | O3 follow-up gate |
| Staff floor UI (roles: manager/staff) | row 11 | O4 gate |
| Menu Manager (86 items) | row 11 | O4 gate |
| Activepieces self-host review | ADR-021 | 3+ client integration requests |
| MCP gateway | ADR-022 | API-1 gate |
| MatrAIx enforcement mode | ADR-023 | after 2 clean report-mode cycles |
| TAKT install | ADR-024 | if/when nrslib/takt installs cleanly in CI |

## Authority notes

- APPLICATION authority: the engineering agent, within the named gate only.
- PRODUCTION authority (merge/deploy/data-deletion): the owner, exclusively.
