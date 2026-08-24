-- Gate #14 — Competitor Rating Monitoring.
--
-- `competitors`: the restaurants a tenant watches. `competitor_rating_
-- history`: one row per daily check, so trends are visible and a 0.2+ star
-- drop can be detected against the previous reading. Both cascade with
-- their owner.

CREATE TABLE IF NOT EXISTS "competitors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "name" text NOT NULL,
  "google_place_id" text NOT NULL,
  "current_rating" numeric DEFAULT '0' NOT NULL,
  "review_count" integer DEFAULT 0 NOT NULL,
  "last_check_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "competitors_tenant_idx" ON "competitors" ("tenant_id");

CREATE TABLE IF NOT EXISTS "competitor_rating_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "competitor_id" uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  "rating" numeric NOT NULL,
  "review_count" integer NOT NULL,
  "recorded_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "competitor_rating_history_competitor_idx" ON "competitor_rating_history" ("competitor_id");
