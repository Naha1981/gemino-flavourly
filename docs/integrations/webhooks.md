# Integration: outbound webhooks

**Status: PLANNED** — gate API-1/OPS-1.

Scope when built:
- Events: booking.created, booking.confirmed, booking.no_show, review.received, campaign.completed, subscription.activated.
- HMAC-SHA256 signed (same scheme as the operator webhook), retries with exponential backoff, dead-letter viewer in super admin.
- Note: inbound PayFast ITN + operator webhook already shipped (see docs/API_REGISTRY.md).