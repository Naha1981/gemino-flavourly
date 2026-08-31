# TAKT-Equivalent Workflow Runbook

Replaces `.takt/` workflows per ADR-024 (no unverified tool syntax). Same discipline, prose form. Use these checklists verbatim until TAKT is verified installed (ADR-024 trigger).

## Feature workflow

```
1. gate-boundary     → name the gate (docs/PROGRAM.md row); write Objective / Scope / Non-Goals
2. archaeology       → read worklog + tests around the touched area; run the suites on a clean tree
3. design-seam       → pure logic module + store adapter + thin route; tests named per convention
4. implement         → additive migrations (drizzle + migrate-ddl mirror); no test weakening
5. evidence          → test:main + test:operator + tsc x2 + next build; counts into the gate report
6. report            → fill the PR template (.github/PULL_REQUEST_TEMPLATE.md)
7. review            → owner reviews evidence table; CONDITIONAL PASS needs owner sign-off
8. merge             → green-only; update FEATURE_MATRIX + PROGRAM status rows in the same PR
```

## Bugfix workflow

```
1. reproduce        → failing test FIRST (QA directive: never weaken a test to pass)
2. isolate          → smallest failing case; confirm the root cause in the seam, not the symptom
3. fix-minimally    → one commit, one bug cluster; no drive-by refactors
4. regression-proof → the failing test now passes; mutation guard if money/state involved
5. evidence         → full suites + tsc + build; gate report (small gates may fold into the PR body)
```

## Deployment workflow

```
1. pre-flight       → suites green on the exact merge SHA; journal current; fleet snapshot regenerated
2. migrate          → GET /api/migrate (super-admin) against production; verify appliedStatements count
3. deploy           → Vercel (main app) + Render (operator, root directory `operator`)
4. smoke            → /api/health; landing 200; cron fleet sync status; one operator /health ping
5. observe          → watchdog hourly; first outbox run; error budget noted in the launch report
6. rollback         → redeploy previous SHA (additive migrations make rollback schema-safe by design)
```

## Never

- cron in `vercel.json` (canonical fleet only)
- a test weakened to make a gate green
- a migration that drops data or renames in place (additive only)
- a merge without the evidence table
