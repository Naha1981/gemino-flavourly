CREATE TABLE IF NOT EXISTS google_places_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  place_id text NOT NULL, api_key_encrypted text, last_fetch_at timestamp, created_at timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS google_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  google_place_id text NOT NULL, review_id text NOT NULL UNIQUE, author_name text NOT NULL, rating integer NOT NULL,
  text text, time timestamp NOT NULL, sentiment text NOT NULL DEFAULT 'neutral', response_text text,
  response_sent_at timestamp, created_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS google_reviews_tenant_idx ON google_reviews (tenant_id);
CREATE INDEX IF NOT EXISTS google_reviews_rating_idx ON google_reviews (rating);
CREATE INDEX IF NOT EXISTS google_reviews_time_idx ON google_reviews (time);