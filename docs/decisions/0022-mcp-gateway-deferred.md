# ADR-022: MCP gateway deferred to gate API-1

**Status:** ACCEPTED (deferred) · **Date:** 2026-08-31

## Context

An MCP (Model Context Protocol) gateway would let agent platforms operate a restaurant's Flavourly data directly ("book a table for me at…"). Tempting for the AI narrative; but today it means: a new always-on endpoint, tool-schema governance, per-tenant auth for agents, and abuse controls — all before a single customer asks.

## Decision

1. MCP gateway is **deferred and assigned to gate API-1** (`docs/PROGRAM.md` row 15).
2. Gate API-1 first ships the boring, complete foundation: versioned REST `/api/v1`, per-tenant keys, rate limits, OpenAPI docs, outbound webhooks.
3. MCP, if it ships in API-1, is a **thin adapter over the same REST surface** — never a second business-logic path. Tools map 1:1 to REST resources; no MCP-only mutations.

## Consequences

- (+) One business-logic path (testable, rate-limited, audited) — MCP can never diverge from REST behaviour.
- (+) Deferral removes agent-auth complexity from the current gates.
- (−) Agent-platform customers wait for API-1; acceptable — none exist yet.
