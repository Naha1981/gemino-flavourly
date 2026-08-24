-- Gate #10: VIP Recognition.
--
-- Additive CREATE TABLE. One row per VIP customer who walks in (the first
-- message of a new conversation). `sent_at` is the moment the staff-facing
-- alert was raised. `served_at` and `note` support the quick actions on the
-- VIP-today dashboard ("Mark as served" / "Add note") without dispatching
-- anything to the customer.
CREATE TABLE IF NOT EXISTS "vip_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	"customer_phone" text NOT NULL,
	"customer_name" text,
	"total_visits" integer NOT NULL,
	"total_spend_cents" integer NOT NULL,
	"last_visit_at" timestamp NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"served_at" timestamp,
	"note" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vip_alerts_tenant_idx" ON "vip_alerts" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vip_alerts_phone_idx" ON "vip_alerts" ("customer_phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vip_alerts_sent_idx" ON "vip_alerts" ("sent_at");
