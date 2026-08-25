-- Gates #15-#18 — Local Market Intelligence Engine.
--
-- #15 discovery extends the EXISTING `competitors` table (created by 0011 for
-- rating monitoring) instead of adding a second competitor table: one business
-- is one competitor, whichever engine is watching it. Every statement here is
-- additive/idempotent so it can run against a database that already has 0011
-- applied, or one that never had it.
--
-- The one non-additive statement is the `DROP NOT NULL` on
-- competitors.google_place_id. It is required: a competitor added by hand from
-- the dashboard (name + address + website) or discovered by the market engine
-- has no Google listing yet, and refusing to insert it would make "Add
-- Manually" impossible. The Gate #14 rating sweep skips rows without a place
-- id (skipped.noPlaceId) rather than calling the Places API with an empty id.

-- ── #15 competitor discovery ────────────────────────────────────────────────
-- Guard: if this file is ever applied to a database that skipped 0011, create
-- the base table first (with google_place_id already nullable) so the ALTERs
-- below have something to act on.
CREATE TABLE IF NOT EXISTS "competitors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "name" text NOT NULL,
  "google_place_id" text,
  "current_rating" numeric DEFAULT '0' NOT NULL,
  "review_count" integer DEFAULT 0 NOT NULL,
  "last_check_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "address" text;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "latitude" numeric;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "longitude" numeric;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "distance_km" numeric;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "website_url" text;
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "phone" text;
-- Google Places metadata captured at discovery: {types, serves, priceLevel}.
-- Cuisine / meal-type gap detection (#17) reads this rather than guessing
-- from a scraped menu.
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "place_data" jsonb DEFAULT '{}'::jsonb NOT NULL;
-- Existing rows get now(): the migration moment is the most honest "last
-- touched" stamp available for a row that predates the column.
ALTER TABLE "competitors" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "competitors" ALTER COLUMN "google_place_id" DROP NOT NULL;

-- competitors_tenant_idx already exists (0011); this one serves the
-- nearest-first ordering of the discovery list.
CREATE INDEX IF NOT EXISTS "competitors_distance_idx" ON "competitors" ("distance_km");

-- Tenant location: discovery searches "restaurants within 5km of ME", and
-- storing the geocoded result keeps the Discover button a single click (and
-- one geocode call) on every later run.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "address" text;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "latitude" numeric;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "longitude" numeric;
-- The tenant's own dish list, published by the owner. Positioning analysis
-- (#18) compares it against competitors' scraped menus; before this column
-- there was no tenant menu anywhere in the schema to compare.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "menu_text" text;

-- ── #16 menu / price / promotion tracking ───────────────────────────────────
-- One row per scrape that CHANGED something: an unchanged menu writes nothing,
-- so this table is a timeline of real edits rather than a daily log.
CREATE TABLE IF NOT EXISTS "competitor_menu_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "competitor_id" uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  "menu_url" text,
  "menu_text" text,
  "price_range" text,
  "snapshot_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "competitor_menu_snapshots_competitor_idx" ON "competitor_menu_snapshots" ("competitor_id");

CREATE TABLE IF NOT EXISTS "competitor_promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "competitor_id" uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  "promotion_text" text NOT NULL,
  "source" text,
  "detected_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "competitor_promotions_competitor_idx" ON "competitor_promotions" ("competitor_id");

-- ── #17 market opportunities ────────────────────────────────────────────────
-- `key` is a stable per-tenant identity for a gap, so a re-run UPDATEs the
-- existing row (fresh confidence + evidence) instead of piling up duplicates —
-- and never silently un-marks an opportunity the tenant already acted on.
CREATE TABLE IF NOT EXISTS "market_opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "key" text NOT NULL,
  "opportunity_type" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "confidence" numeric DEFAULT '0' NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "addressed" boolean DEFAULT false NOT NULL,
  "addressed_at" timestamp,
  "detected_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "market_opportunities_tenant_idx" ON "market_opportunities" ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "market_opportunities_tenant_key_uniq" ON "market_opportunities" ("tenant_id", "key");
