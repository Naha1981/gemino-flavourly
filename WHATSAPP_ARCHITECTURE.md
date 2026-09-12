# WhatsApp architecture

Gemino-Flavourly uses the shared NahaLabs WhatsApp Operator. There is deliberately **one WhatsApp engine**, shared by NahaLabs applications.

```text
Gemino-Flavourly
  │
  │ HTTPS + X-API-Key + X-App-Id + X-Tenant-Id
  ▼
NahaLabs central WhatsApp Operator
  https://my-own-whatsapp-2z5h.onrender.com
  │
  ├─ WhatsApp account lifecycle
  ├─ Baileys sessions and Signal credentials
  ├─ QR and phone-number pairing
  ├─ Outbound send/message operations
  └─ Signed inbound webhooks
  │
  ▼
WhatsApp
```

## Responsibility boundary

**Gemino** retains authentication, tenants, CRM, inbox/conversations, AI responses, approvals, billing/message limits, campaigns, loyalty, VIP recognition, booking/rebooking, STOP/START, manual takeover, audit/history, and the outbound outbox.

**Central Operator** owns all WhatsApp transport and session state. Gemino never imports Baileys, creates a socket, owns a QR generator, or persists WhatsApp session credentials.

## Identity mapping

A Gemino `wa_accounts.id` is a local business record. It is **not** assumed to be the central Operator account id. The trusted mapping is `wa_account_bindings(tenant_id, app_id, wa_account_id, webhook_url)`, resolved only after Gemino authentication.

## Pairing

QR: `POST /accounts/:id/connect` then poll `GET /accounts/:id/qr` about every 3 seconds. The Operator's `data:image/png` is rendered directly and is never cached, transformed, stored in localStorage, or treated as success until `/status` returns `isConnected=true`.

Phone pairing: `POST /accounts/:id/pairing-code`, then continue polling `/status` until connected. A pairing code itself is never treated as successful connection.

## Inbound

The central Operator signs normalized message events with the shared `WEBHOOK_SECRET`. Gemino verifies HMAC first, resolves tenant from its binding table, de-duplicates the WhatsApp message id, then executes the existing business/AI pipeline.

## Rule for future changes

Do not reintroduce a local WhatsApp server. Transport changes belong in `Naha1981/my-own-whatsapp`; business changes belong here.
