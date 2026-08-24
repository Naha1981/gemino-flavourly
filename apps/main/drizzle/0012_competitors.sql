-- Gate #15-#17 — Local Market Intelligence.
--
-- 1. `competitors` gains the discovery + tracking columns (the table itself
--    shipped in 0011 for rating monitoring; `google_place_id` stays NOT
--    NULL — discovery always has one). The unique (tenant_id, place_id)
--    index makes re-running discovery idempotent: the same nearby
--    restaurant updates its row instead of duplicating.
-- 2. `competitor_menu_snapshots` — one row per daily scrape.
-- 3. `competitor_promotions` — one row per detected promotion mention,
--    fingerprinted by promotion_key for "is this NEW?" checks.
-- 4. `market_opportunities` — detected market gaps (Gate #17), upserted by
--    (tenant_id, opportunity_key) so the tenant's `addressed` flag
--    survives analyzer re-runs.

ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "address" text;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "latitude" numeric;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "longitude" numeric;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "distance_km" numeric;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "rating" numeric;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "price_level" text;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "website_url" text;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "is_self" boolean DEFAULT false NOT NULL;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

CREATE INDEX IF NOT EXISTS "competitors_distance_idx" ON "competitors" ("distance_km");
CREATE UNIQUE INDEX IF NOT EXISTS "competitors_tenant_place_uniq" ON "competitors" ("tenant_id", "google_place_id");

CREATE TABLE IF NOT EXISTS "competitor_menu_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "competitor_id" uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  "menu_url" text,
  "menu_text" text,
  "menu_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "price_range" text,
  "snapshot_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "competitor_menu_snapshots_competitor_idx" ON "competitor_menu_snapshots" ("competitor_id");

CREATE TABLE IF NOT EXISTS "competitor_promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "competitor_id" uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  "promotion_text" text NOT NULL,
  "promotion_key" text NOT NULL,
  "source" text,
  "detected_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "competitor_promotions_competitor_idx" ON "competitor_promotions" ("competitor_id");
CREATE INDEX IF NOT EXISTS "competitor_promotions_key_idx" ON "competitor_promotions" ("competitor_id", "promotion_key");

CREATE TABLE IF NOT EXISTS "market_opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "opportunity_key" text NOT NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "confidence" numeric DEFAULT '0' NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "addressed" boolean DEFAULT false NOT NULL,
  "addressed_at" timestamp,
  "detected_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "market_opportunities_tenant_idx" ON "market_opportunities" ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "market_opportunities_tenant_key_uniq" ON "market_opportunities" ("tenant_id", "opportunity_key");
