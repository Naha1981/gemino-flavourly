-- Gate #9: Reactivation Campaigns.
--
-- Additive CREATE TABLE. One row per reactivation message queued to a
-- dormant / at-risk customer; `sent_at` is NULL from creation until the
-- message is handed to the outbox, and `responded` is flipped by the
-- inbound webhook when the customer replies.
CREATE TABLE IF NOT EXISTS "reactivation_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	"customer_phone" text NOT NULL,
	"segment" text NOT NULL,
	"message_text" text NOT NULL,
	"sent_at" timestamp,
	"responded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reactivation_campaigns_tenant_idx" ON "reactivation_campaigns" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reactivation_campaigns_phone_idx" ON "reactivation_campaigns" ("customer_phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reactivation_campaigns_pending_idx" ON "reactivation_campaigns" ("tenant_id","sent_at") WHERE "sent_at" IS NULL;
