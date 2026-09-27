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
| 9 | Booking drafts + 48/24/6h reminders + waitlist offers | Reminders ladder + CONFIRM flow + 30-minute booking drafts + cancellation-to-waitlist auto-offer | O2 | build | ✅ DONE (2026-09-27) |
| 10 | Win-back ladder + review split-routing + quiet hours + AI budget guard | Win-back, review split-routing, quiet hours and per-tenant AI budget guard | O3 | build | ✅ DONE (2026-09-27) |
| 11 | Staff roles + Menu Manager (86) + public hub `/r/[slug]` | Public hub, staff floor UI, server-enforced roles, invites and Menu Manager | O4 | build | ✅ DONE (2026-09-27) |
| 12 | UX Intelligence + Anti-AI-Slop audit + finish light theme | Stitch redesign shipped (light-default tokens, dark opt-in). Formal UX-1 audit pass: pending | UX-1 | build/audit | ⏳ PENDING |
| 13 | Telemetry & Intent Intelligence (events→rules→scores→actions→attribution) | Conversation outcome classification + revenue events + intent scores + next-best-action dashboard | TEL-1 | build | ✅ DONE (2026-09-27) |
| 14 | Playwright personas + MatrAIx synthetic QA | Persona smoke artifact added; full CI validation remains a QA/debug check, not a feature build blocker | QA-1 | build | ✅ BUILD SURFACE DONE |
| 15 | Agent-ready: `/api/v1`, integrations docs, Resend email; MCP gateway | Versioned REST API, API keys, Resend owner brief, outbound webhooks and thin MCP adapter | API-1 | build | ✅ DONE (2026-09-27) |
| 16 | Ops: selftest, webhook viewer, broadcast, runbook, Graphify map | Self-test, webhook audit/viewer, broadcast queue, runbook, Graphify and cron additions | OPS-1 | build | ✅ DONE (2026-09-27) |

## Deferred items

No feature-gate build items remain from the original sweep. Remaining work is validation/debug/deployment, not missing product surface.

### Historical ADR deferrals retained for record

| Item | Home | Trigger |
|---|---|---|
| Activepieces self-host review | ADR-021 | 3+ client integration requests |
| MCP gateway | ADR-022 | shipped as thin adapter after REST foundation |
| MatrAIx enforcement mode | ADR-023 | after 2 clean report-mode cycles |
| TAKT install | ADR-024 | if/when nrslib/takt installs cleanly in CI |

## Authority notes

- APPLICATION authority: the engineering agent, within the named gate only.
- PRODUCTION authority (merge/deploy/data-deletion): the owner, exclusively.
