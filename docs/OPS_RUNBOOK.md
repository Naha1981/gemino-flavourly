# Flavourly Operations

Primary recovery path:
1. /api/health
2. Super Admin → Self-test
3. Cron Fleet Manager
4. WhatsApp Operator health
5. Outbox status
6. Webhook Viewer
7. AI master switch / tenant AI / daily AI budget
8. Last READY Vercel deployment

Do not create a second WhatsApp/Baileys transport inside this application.
