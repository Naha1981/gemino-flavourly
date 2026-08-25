-- Engine 5 — Marketing Campaigns.
--
-- Additive CREATE TABLE for proactive marketing campaigns (promotions,
-- events, seasonal offers, announcements). Distinct from operational
-- campaigns (reactivation, win-back, VIP reward) which live in `campaigns`.
CREATE TABLE IF NOT EXISTS "marketing_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"target_segment" text,
	"offer" text,
	"message" text NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"launched_at" timestamp,
	"estimated_reach" integer,
	"estimated_revenue_cents" integer,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_campaigns_tenant_idx" ON "marketing_campaigns" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_campaigns_tenant_status_idx" ON "marketing_campaigns" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_campaigns_tenant_type_idx" ON "marketing_campaigns" ("tenant_id", "type");
