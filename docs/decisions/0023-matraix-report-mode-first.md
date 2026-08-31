# ADR-023: MatrAIx synthetic QA runs report-mode-first

**Status:** ACCEPTED · **Date:** 2026-08-31

## Context

MatrAIx (synthetic QA persona suite, per the QA directive) generates realistic multi-tenant traffic to hunt defects. Running it in **enforcement mode** (fails the build on any finding) from day one would make the suite a blocker built on unproven expectations: false positives would either be "fixed" blindly (Iron Rule violation) or the suite would be weakened to pass (worse).

## Decision

1. MatrAIx lands in **report mode first**: findings are logged, triaged, and turned into regression tests only after a human confirms the defect is real.
2. Promotion to enforcement mode requires **two consecutive clean report cycles** on main.
3. Findings never justify weakening an existing test (QA directive: never TEST → WEAKEN TEST → PASS).

## Consequences

- (+) Defect signal arrives early without destabilising the merge gate.
- (+) The promotion criteria are objective and time-boxed, not vibes.
- (−) Some real defects may merge before promotion — mitigated by the existing 1600+ unit/wiring suite and the Playwright personas already in `e2e/`.
