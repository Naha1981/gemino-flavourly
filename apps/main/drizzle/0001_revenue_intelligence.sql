ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "outcome" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "estimated_value_cents" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "outcome_classified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "outcome_classifier" text;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "conversation_id" uuid;
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN IF NOT EXISTS "conversation_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revenue_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"conversation_id" uuid,
	"estimated_value_cents" integer DEFAULT 0 NOT NULL,
	"realized_cents" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reservations" ADD CONSTRAINT "reservations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revenue_events" ADD CONSTRAINT "revenue_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "revenue_events" ADD CONSTRAINT "revenue_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_outcome_tenant_idx" ON "conversations" USING btree ("tenant_id","outcome","outcome_classified_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_events_tenant_occurred_idx" ON "revenue_events" USING btree ("tenant_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revenue_events_conversation_idx" ON "revenue_events" USING btree ("conversation_id");
