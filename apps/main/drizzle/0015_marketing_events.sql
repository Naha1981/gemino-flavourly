-- Engine 5 — Marketing Events.
--
-- Additive CREATE TABLE for time-bound marketing events (special dinners,
-- live music, tastings, workshops, holiday promotions). Distinct from
-- marketing campaigns, which are message-oriented broadcasts.
CREATE TABLE IF NOT EXISTS "marketing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
	"name" text NOT NULL,
	"description" text,
	"event_type" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"location" text,
	"capacity" integer,
	"booked_count" integer DEFAULT 0 NOT NULL,
	"message" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_events_tenant_idx" ON "marketing_events" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_events_tenant_status_idx" ON "marketing_events" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_events_tenant_type_idx" ON "marketing_events" ("tenant_id", "event_type");
