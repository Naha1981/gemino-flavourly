-- Gate #11 — Google Review Monitoring.
--
-- Two additive tables: `google_reviews` (one row per Google review pulled by
-- the daily fetch cron; `review_id` is Google's globally-unique review id and
-- the upsert key) and `google_places_config` (one row per tenant: the place
-- to watch + the encrypted API key). Both are tenant-scoped with ON DELETE
-- CASCADE, matching every other tenant-owned table.

CREATE TABLE IF NOT EXISTS "google_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "google_place_id" text NOT NULL,
  "review_id" text NOT NULL UNIQUE,
  "author_name" text NOT NULL,
  "rating" integer NOT NULL,
  "text" text,
  "time" timestamp NOT NULL,
  "sentiment" text DEFAULT 'neutral' NOT NULL,
  "response_text" text,
  "response_sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "google_reviews_tenant_idx" ON "google_reviews" ("tenant_id");
CREATE INDEX IF NOT EXISTS "google_reviews_rating_idx" ON "google_reviews" ("rating");
CREATE INDEX IF NOT EXISTS "google_reviews_time_idx" ON "google_reviews" ("time");

CREATE TABLE IF NOT EXISTS "google_places_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "place_id" text NOT NULL,
  "api_key_encrypted" text,
  "last_fetch_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Unique per tenant (one Google Places configuration each)…
CREATE UNIQUE INDEX IF NOT EXISTS "google_places_config_tenant_uniq" ON "google_places_config" ("tenant_id");
-- …plus the plain tenant index the gate contract names, so both lookups
-- (by-tenant unique check and tenant scan) have a covering index.
CREATE INDEX IF NOT EXISTS "google_places_config_tenant_idx" ON "google_places_config" ("tenant_id");
