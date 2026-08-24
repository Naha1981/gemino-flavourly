-- Gate #7: Customer 360 profiles.
--
-- One row per (tenant, customer phone) aggregating visit history, spend,
-- party size and extracted preferences. Additive CREATE TABLE — existing
-- restaurants keep working with an empty profile list until reservations
-- are synced.
CREATE TABLE IF NOT EXISTS "customer_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "customer_phone" text NOT NULL,
  "customer_name" text,
  "total_visits" integer DEFAULT 0 NOT NULL,
  "total_spend_cents" integer DEFAULT 0 NOT NULL,
  "avg_party_size" numeric DEFAULT 0 NOT NULL,
  "last_visit_at" timestamp,
  "first_visit_at" timestamp,
  "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT NOW() NOT NULL,
  "updated_at" timestamp DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_profiles_tenant_idx" ON "customer_profiles" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_profiles_phone_idx" ON "customer_profiles" ("customer_phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_profiles_contact_idx" ON "customer_profiles" ("contact_id");
