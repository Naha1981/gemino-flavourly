# UNIVERSAL WHATSAPP ARCHITECTURE (Direct / No Twilio)

Flavourly implements this exactly.

## Split

- **Brain:** Next.js on Vercel. UI, Clerk, Neon, AI, webhooks, outbox.
- **Engine:** Node + `@whiskeysockets/baileys@6.7.24` on Render. One process, N sockets.

## Handshake

- Engine → Brain: `POST /api/webhooks/whatsapp` with `x-webhook-signature: HMAC-SHA256(secret, rawBody)`.
- Brain → Engine: `POST /start|/send` and `GET /status` with `x-api-key`. Fail closed if the key is unset.

## Reliability

- `connectingLocks` prevent dual sockets (device conflict).
- `openAccounts` separates “socket object exists” from “handshake open”. `/send` waits up to 15s.
- Capped exponential reconnect. Stops on `loggedOut`.
- `resumeConnectedAccounts()` on boot.
- Creds + Signal keys in `wa_accounts.session_creds` + `wa_auth_keys`.
- Inbound: persist `platform_events`, then forward with 3 retries on 5xx/network.
- Outbound: atomic claim on `jobs`. Reaper after 5 minutes stuck in `processing`.

## Gotchas (already paid for)

- `QRCodeCanvas`, never SVG.
- Tenant from `wa_accounts`, never payload.
- Filter `@s.whatsapp.net` only.
- Unique partial index on `wa_message_id`.
- `last_connected_at` set once.
- Keep-alive `GET /health` every 5 minutes or Render sleeps.
