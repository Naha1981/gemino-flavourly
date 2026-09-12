# Retired local WhatsApp operator

This workspace is intentionally retired.

Gemino-Flavourly no longer runs a local Baileys/WhatsApp socket engine. All WhatsApp transport is provided by the central NahaLabs WhatsApp Operator:

https://my-own-whatsapp-2z5h.onrender.com

Do not add `makeWASocket`, socket registries, QR generation, or another WhatsApp server here. Business logic stays in `apps/main`; transport stays behind the server-side central Operator client.
