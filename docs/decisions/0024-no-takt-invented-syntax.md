# ADR-024: No TAKT installation — runbook equivalent instead

**Status:** ACCEPTED · **Date:** 2026-08-31

## Context

The governance pack asks for TAKT (nrslib/takt) workflows for feature/bugfix/deployment tracking. Installing it requires a devDependency whose documented syntax and runtime we have **not verified against this repo's toolchain**, and the TAKT docs may not match the current package. The Iron Rules forbid inventing workflow syntax that looks official but isn't (docs must match reality — Iron Rule 7 — applies to tooling too).

## Decision

1. TAKT is **not installed**. No `.takt/` directory with speculative YAML.
2. The equivalent workflow is codified as a runbook: `docs/runbooks/TAKT-EQUIVALENT.md`.
3. Install trigger: someone verifies TAKT installs cleanly (`npm i -D @nrslib/takt` resolves, `--version` runs) **in a throwaway branch** and documents the exact commands; then this ADR is superseded by a new one with the verified commands.

## Consequences

- (+) No unverified dependency in the repo; no invented syntax.
- (+) The workflow discipline (feature → bugfix → deployment checklists) still exists, as prose.
- (−) No tooling enforcement of the workflow — mitigated by the PR template + gate reports, which are enforced at review time.
