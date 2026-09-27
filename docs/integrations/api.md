# Orderly REST API

## Status
Implemented in \`/api/v1\`.

## Authentication
Create a tenant-scoped API key in Dashboard → Settings → API Keys.

Send:
\`Authorization: Bearer flv_live_...\`

Keys are stored as SHA-256 hashes and are rate-limited to 120 requests/minute per key.

## Resources
- \`GET /api/v1/me\`
- \`GET /api/v1/contacts\`
- \`GET /api/v1/reservations\`
- \`GET /api/v1/campaigns\`
- \`GET /api/v1/reviews\`
- \`GET /api/v1/loyalty/:contactId\`
- \`GET /api/v1/selftest\` — Super Admin only

All resources are tenant-scoped from the API key. A caller cannot choose another tenant in the request.

## MCP adapter
\`POST /api/mcp\` exposes a thin JSON-RPC adapter over the same tenant-authenticated data:
- \`restaurant.get\`
- \`contacts.list\`
- \`reservations.list\`
- \`loyalty.get\`

MCP contains no separate business logic.
