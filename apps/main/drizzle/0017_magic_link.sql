-- Magic Link feature (Gate 3)
-- Pre-existing rows keep defaults; all statements additive.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tenant_mode text DEFAULT 'live' NOT NULL;

CREATE TABLE IF NOT EXISTS brand_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_url text,
  logo_url text,
  logo_path text,
  primary_color text,
  secondary_color text,
  background_color text,
  font_family text,
  brand_name text,
  tagline text,
  menu_json jsonb,
  hours_json jsonb,
  google_places_id text,
  confidence real,
  extracted_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS brand_profiles_tenant_uniq ON brand_profiles (tenant_id);

CREATE TABLE IF NOT EXISTS prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  website text NOT NULL,
  owner_email text,
  owner_phone text,
  city text,
  status text DEFAULT 'queued' NOT NULL,
  error text,
  retries integer DEFAULT 0 NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  claim_token text,
  claimed_at timestamp,
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS prospects_status_idx ON prospects (status);
CREATE INDEX IF NOT EXISTS prospects_tenant_idx ON prospects (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS prospects_claim_token_uniq ON prospects (claim_token);

CREATE TABLE IF NOT EXISTS tenant_claim_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token text NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL,
  claimed_at timestamp,
  claimed_by_user_id text,
  expires_at timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_claim_tokens_token_uniq ON tenant_claim_tokens (token);
CREATE INDEX IF NOT EXISTS tenant_claim_tokens_tenant_id_idx ON tenant_claim_tokens (tenant_id);
