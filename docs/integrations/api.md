# Integration: REST API (/api/v1)

**Status: PLANNED** — gate API-1 (see docs/PROGRAM.md row 15). MCP gateway deferred with it (ADR-022).

Scope when built:
- Versioned JSON REST under /api/v1, per-tenant API keys (hashed at rest).
- Resources: contacts, reservations, campaigns, reviews, loyalty balances.
- Rate limits per tier; idempotency keys required on all POSTs.
- OpenAPI document generated from route handlers (not hand-written).