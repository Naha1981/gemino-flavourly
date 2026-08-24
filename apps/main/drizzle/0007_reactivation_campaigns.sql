-- Gate #9: Reactivation campaigns.
--
-- One row per win-back WhatsApp message dispatched to a dormant / at-risk
-- customer. `sent_at` doubles as the send state (NULL = pending), and the
-- 90-day anti-spam cooldown in the reactivation cron measures from
-- COALESCE(sent_at, created_at) so a crashed run cannot double-message.
-- Additive CREATE TABLE — existing restaurants simply have an empty campaign
-- history until the daily cron (or a manual dashboard send) runs.
CREATE TABLE IF NOT EXISTS "reactivation_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "customer_phone" text NOT NULL,
  "segment" text NOT NULL,
  "message_text" text NOT NULL,
  "sent_at" timestamp,
  "responded" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reactivation_campaigns_tenant_idx"
  ON "reactivation_campaigns" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reactivation_campaigns_phone_idx"
  ON "reactivation_campaigns" ("customer_phone");
--> statement-breakpoint
-- Partial index for the hot scans: pending-campaign reconciliation and the
-- dashboard's pending count. Sent campaigns are history.
CREATE INDEX IF NOT EXISTS "reactivation_campaigns_pending_idx"
  ON "reactivation_campaigns" ("tenant_id", "sent_at")
  WHERE "sent_at" IS NULL;
