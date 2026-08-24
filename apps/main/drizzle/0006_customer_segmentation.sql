-- Gate #8: Customer Segmentation.
--
-- Additive columns on the Gate #7 customer 360 profile. Existing profiles
-- start as `new` and are classified by the six-hour segmentation cron.
ALTER TABLE "customer_profiles"
  ADD COLUMN IF NOT EXISTS "segment" text DEFAULT 'new' NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_profiles"
  ADD COLUMN IF NOT EXISTS "segment_confidence" numeric DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_profiles"
  ADD COLUMN IF NOT EXISTS "segment_updated_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_profiles_segment_idx"
  ON "customer_profiles" ("segment");
