# Central WhatsApp Operator Migration

Gemino-Flavourly uses the shared NahaLabs WhatsApp transport at:

`https://my-own-whatsapp-2z5h.onrender.com`

Gemino owns the business/application layer: tenants, contacts, conversations, AI, approvals, billing, POPIA, campaigns, inbox and outbox. The central Operator owns WhatsApp transport, sessions, QR/pairing, delivery and WhatsApp-side events.

## Account identity mapping

Gemino's `wa_accounts.id` is a Gemino-local identifier. The central Operator's `waAccountId` is a different identifier. The mapping is stored in Gemino's existing `wa_account_bindings` table with `app_id = gemino` and the authenticated tenant id. The server resolves this mapping from the Gemino session/database; browser-supplied tenant/account ids are never authorization inputs.

## Server environment

Required for WhatsApp:

- `OPERATOR_URL=https://my-own-whatsapp-2z5h.onrender.com`
- `OPERATOR_API_KEY=<server-side secret matching the central Operator>`
- `WEBHOOK_SECRET=<server-side HMAC secret matching the central Operator>`
- `APP_ID=gemino`
- `APP_URL=https://gemino-flavourly-whatsapp.vercel.app`

No `NEXT_PUBLIC_*` WhatsApp credentials are used. No browser storage is used for Operator credentials or temporary pairing codes.

## Pairing

QR pairing calls the central Operator's `/accounts/:id/connect` and polls `/accounts/:id/qr` until `isConnected=true`. Gemino never generates or stores its own QR.

Phone-number pairing uses `/accounts/:id/pairing-code`. A pairing code is pending, not proof of connection; the dashboard must continue polling status until `isConnected=true`.

## Webhooks

The central Operator sends signed schema-versioned events to `/api/webhooks/whatsapp`. Gemino verifies HMAC before parsing business data, resolves the local tenant from `wa_account_bindings`, de-duplicates message ids, and then runs the existing AI/business pipeline.

## Retirement rule

The old `operator/` Baileys implementation is retired. Do not add `makeWASocket`, a socket registry, local QR generation, or another WhatsApp server to this repository. All future WhatsApp transport work belongs in the central Operator repository.
