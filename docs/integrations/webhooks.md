# Outbound Webhooks

## Status
Implemented.

Restaurants can register HTTPS endpoints from Dashboard → Settings → Webhooks.

Events use HMAC-SHA256 in:
\`X-NahaLabs-Webhook-Signature\`

Delivery is retried with exponential backoff and moves to \`dead\` after eight failed attempts.

The shared event model is designed for booking, campaign, review, subscription and future revenue events.
