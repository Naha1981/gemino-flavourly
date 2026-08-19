# UNIVERSAL WHATSAPP ARCHITECTURE (Direct / No Twilio)

**Role for AI:** You are an expert backend architect building a multi-tenant SaaS with a direct, un-official WhatsApp Web integration. You will **never** use Twilio, Evolution API, 360dialog, or paid WhatsApp Cloud APIs. You will use the "Linked Devices" WebSocket architecture.

## 1. The Two-Component Split (Crucial Rule)
Never put the WhatsApp socket connection in the same codebase/host as the serverless frontend.
* **The Brain (Main App):** Next.js on Vercel (Serverless). Handles UI, Auth (Clerk), Database (Neon/Postgres), Tenant isolation, AI logic, and Webhook receivers.
* **The Engine (Operator):** Node.js + `@whiskeysockets/baileys` on Render/Docker/Fly.io (Persistent). Holds the 24/7 WebSocket connection to WhatsApp. Survives server restarts.

## 2. The Engine (Operator) Responsibilities
* **Auth:** Generates QR codes for Linked Devices. Saves the cryptographic session state (`session_creds`) encrypted into the Main App's database.
* **Listening:** Listens to the WhatsApp WebSocket. When a message arrives, it forwards it to the Main App.
* **Sending:** Exposes a REST API (`POST /send`) so the Main App can tell it to deliver a message.
* **Health:** Exposes `GET /health` for the Main App to monitor uptime.

## 3. The Handshake (Security & Communication)
* **Engine to Brain (Inbound):** The Operator `POST`s inbound messages to the Main App's webhook (`/api/webhooks/whatsapp`). **Must be secured with HMAC-SHA256 signatures (`x-webhook-signature`)** so the Brain knows the message is real and not spoofed.
* **Brain to Engine (Outbound):** The Main App sends messages by calling the Operator's REST API. Secured via a shared `OPERATOR_API_KEY` (`x-api-key`) in the headers.

## 4. Multi-Tenancy & Isolation
* Every business (Tenant) gets its own "Account ID" on the Operator.
* The Operator manages multiple WhatsApp sockets simultaneously (e.g., `main-wa`, `tenant-123-wa`) via an in-memory `Map<string, WASocket>`.
* The Database enforces Row-Level Security (RLS) or strict `tenantId` filtering. Tenant A can never see or send messages on Tenant B's WhatsApp socket.
* Supports **One Shared Operator** across multiple distinct Next.js apps via the `wa_account_bindings` table.

## 5. Safety, Control & Compliance
* **Super Admin Master Switch:** A database-backed toggle (`system_settings` table) that instantly kills AI processing globally without requiring a redeploy.
* **Manual Mode:** A per-tenant toggle (`tenants.manual_mode`). If ON, the system logs messages but the AI is forbidden from replying.
* **POPIA/GDPR Compliance:** The system natively listens for "STOP", "UNSUBSCRIBE", or "OPT-OUT" keywords and instantly flags `contacts.blocklisted = true` for that specific tenant.
