CREATE TABLE IF NOT EXISTS competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, google_place_id text NOT NULL, current_rating numeric(3,2) NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0, last_check_at timestamp, created_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS competitors_tenant_idx ON competitors (tenant_id);
CREATE TABLE IF NOT EXISTS competitor_rating_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competitor_id uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  rating numeric(3,2) NOT NULL, review_count integer NOT NULL, recorded_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS competitor_rating_history_competitor_idx ON competitor_rating_history (competitor_id);