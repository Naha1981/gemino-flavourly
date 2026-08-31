# NahaLabs Engineering Standard

**Version:** 1.0 · **Status:** ACTIVE · **Applies to:** every NahaLabs repository (current reference implementation: `gemino-flavourly`)

This document is the constitution for how software gets built, audited, and shipped in this organisation. It is enforced through the gate protocol (§3), the authority model (§4), and the stop conditions (§5). When a conflict arises between convenience and this standard, the standard wins.

---

## 1. Purpose

Build production-grade software that is correct, secure, reliable, maintainable, observable, and profitable. We do not optimise for "the most code the fastest". Every application is treated as software that may eventually serve real customers — because it will.

Optimisation order:

1. Correctness
2. Security
3. Simplicity
4. Maintainability
5. Development speed
6. Cost efficiency

---

## 2. The 10 Iron Rules

1. **Archaeology Before Action.** Never write code on an existing app without a read-only Phase 0 Current-State Audit (stack, deps, test counts, git state, worklog).
2. **Bounded Gates.** Never "build the whole app." Break work into strictly scoped gates with Objectives, Scope, and explicit Non-Goals. One gate at a time.
3. **Fail-Closed Security.** Every security boundary (cron, webhooks, auth, tenant isolation) defaults to DENY when secrets are missing. No "dev mode" backdoors in production code.
4. **Deterministic First, AI Last.** Math, ledgers, and business rules live in SQL/TypeScript. AI is only a grounded fallback for synthesis. Never let AI hallucinate financial or state data.
5. **Strangler Fig > Big Bang.** When migrating stacks, use the KEEP / MIGRATE / REWRITE / REMOVE / DEPRECATE matrix. Never delete and rebuild from scratch.
6. **Idempotency & Append-Only.** Assume networks fail and retries happen. Use idempotency keys, unique constraints, and event-sourced ledgers for critical state (money, points, consent, delivery state).
7. **Docs Must Match Reality.** If the README describes a stack that isn't in the `package.json`, the docs are a Sev-1 bug. Fix the docs to match the code, never vice versa.
8. **The Pilot Rule.** Never build for 100 users. Build for 3 friendly pilot users. Optimise for edge-device reality (offline, cheap hardware, bad lighting) over dashboard aesthetics.
9. **No "Looks Good" Deployments.** A gate only passes with mathematical evidence: test counts, typecheck exit codes, build artifacts, and SHA proofs.
10. **Stop at Authority Boundaries.** If a task requires production data deletion, auth provider swaps, or scope expansion — STOP, explain the impact, and wait for the owner's explicit approval.

---

## 3. Gate protocol

### 3.1 Lifecycle

```
Idea → Architecture → Repository → Baseline → Plan → Implement →
Test → Break/Test → Review → Commit → Merge → Deploy → Observe → Operate → Improve
```

### 3.2 Modes

**Mode A — New application:** Discovery → Architecture → Gate G0 (Security & Foundation) → Gate G1 (one complete vertical slice) → Gate G2 (Edge & Reality hardening).

**Mode B — Existing application (Gate R Protocol):**
1. Phase 0 Archaeology — read-only inspection; map the actual stack, dependencies, test counts.
2. Lineage Reconciliation — compare narrative assumptions against `git ls-files` + `package.json`; produce a Current-State Report.
3. Migration Matrix — classify every component KEEP / MIGRATE / REWRITE / REMOVE / DEPRECATE.
4. Wait for approval. No migration code before the matrix is approved.

### 3.3 The mandatory gate report

Every bounded task ends with exactly this report:

```markdown
# GATE REPORT: [Gate Name]
## Objective & Scope
## Baseline (Branch, Local SHA, Remote SHA sync status)
## Files Changed (and explicitly what was NOT changed)
## Evidence Table
| Check | Result |
|---|---|
| Tests (Count) | Pass/Fail |
| Typecheck/Lint | Pass/Fail |
| Build | Pass/Fail |
| Security/Seam Test | Pass/Fail |
## Defects Fixed / Architecture Decisions
## Remaining Risks / Non-Goals Deferred
## Commit & Remote Verification (SHA proof)
## Verdict: PASS / FAIL / CONDITIONAL PASS
```

**The green-only merge rule:** no merge happens unless every evidence row is green, or the failure is documented in Remaining Risks with the owner's explicit sign-off (CONDITIONAL PASS).

### 3.4 Test discipline

- TEST → OBSERVE → REPRODUCE → ISOLATE → FIX MINIMALLY → REGRESSION TEST → VERIFY.
- Never TEST → WEAKEN TEST → PASS. A test is only updated when the *contract* legitimately changed, and the commit message must say which contract and why.
- Every important bug discovered gets a regression test that fails before the fix.
- Playwright is the default web E2E framework. Do not install Cypress/Selenium/multiple AI testing frameworks without a demonstrated, documented capability gap.
- Mutation guards: money-relevant rules get tests that fail if the rule is weakened (see `reward-claim.test.ts` "MUTATION GUARD" for the pattern).

### 3.5 Secrets discipline

- Secrets never appear in code, docs, commits, logs, or screenshots.
- `.env.local` is git-ignored; `.env.example` documents variables without values.
- Pushes use authenticated tooling (`gh` CLI or a user-supposed token that the user revokes after use). A token that has appeared in plaintext anywhere is considered compromised: revoke and rotate.
- Webhooks verify signatures (HMAC-SHA256) fail-closed; cron routes require the bearer secret fail-closed.

---

## 4. Authority model

| Authority | Holder | Meaning |
|---|---|---|
| **APPLICATION** | The engineering agent | Code, tests, docs within the approved gate scope |
| **PRODUCTION** | The Product Owner, exclusively | Merge, deploy, delete production data, rotate auth providers, spend money |

The agent may hold APPLICATION authority for a named gate. PRODUCTION authority is never delegated, never assumed, and never exercised "to unblock" — Iron Rule 10.

---

## 5. Stop conditions

Stop immediately and escalate to the owner when any of the following is true:

1. The task requires production data deletion or mutation outside a documented, approved runbook.
2. The task requires swapping auth providers, payment providers, or the primary database.
3. Scope needs to expand beyond the approved gate (re-open the gate; do not absorb the new scope silently).
4. A secret may have been exposed (leaked token, key in logs) — treat as compromised until rotated.
5. The evidence table cannot be made green and a merge is being requested anyway.
6. Docs/reality divergence is discovered mid-gate (Iron Rule 7) — reconcile before continuing.

---

## 6. Repository conventions (reference: gemino-flavourly)

- **Monorepo:** `apps/main` (Next.js on Vercel) + `operator/` (Express + Baileys on Render); npm workspaces.
- **Logic/store split:** pure decision modules (`*.ts` with unit tests) + Drizzle store adapters (`*-store.ts`, never imported by tests) + thin route handlers. Every cron follows: guard → kill-switch → pure runner → report.
- **Migrations:** additive-only. Each feature lands a `drizzle/00NN_*.sql` **and** its mirror in `lib/db/migrate-ddl.ts` (the `/api/migrate` runtime path). Parity tests enforce both.
- **Cron:** canonical fleet lives in `scripts/cron-fleet.json` (+ embedded snapshot); **never** schedule cron in `vercel.json`. Every `/api/cron/*` route is guarded by `assertCronAuthorized` — enforced by a wiring test.
- **Honesty in UI:** empty states say "Not confirmed yet"; delivery ticks never fake green; badges appear only when the underlying action actually happened.
- **Worklog:** every agent session appends to the shared worklog with Task ID, steps, and stage summary.
