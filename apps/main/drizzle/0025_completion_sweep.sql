-- Completion sweep: remaining Orderly / Flavourly platform features.
-- Additive only. Runtime /api/migrate carries the same DDL.
CREATE TABLE IF NOT EXISTS booking_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'collecting',
  date_text text,
  time_text text,
  party_size integer,
  notes text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamp NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_drafts_conversation_idx ON booking_drafts (conversation_id, status);
CREATE INDEX IF NOT EXISTS booking_drafts_expiry_idx ON booking_drafts (expires_at, status);

ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS offer_reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL;
ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS offer_expires_at timestamp;
CREATE INDEX IF NOT EXISTS waitlist_offer_idx ON waitlist_entries (status, offer_expires_at);

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  updated_at timestamp DEFAULT NOW() NOT NULL,
  PRIMARY KEY (tenant_id, usage_date)
);

CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  description text,
  price_cents integer,
  available boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'owner',
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS menu_items_tenant_position_idx ON menu_items (tenant_id, position);
CREATE INDEX IF NOT EXISTS menu_items_tenant_available_idx ON menu_items (tenant_id, available);

CREATE TABLE IF NOT EXISTS staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  token_hash text NOT NULL,
  expires_at timestamp NOT NULL,
  accepted_at timestamp,
  created_by text NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_invites_token_hash_uniq ON staff_invites (token_hash);
CREATE INDEX IF NOT EXISTS staff_invites_tenant_email_idx ON staff_invites (tenant_id, email);

CREATE TABLE IF NOT EXISTS intent_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  intent text NOT NULL,
  score integer NOT NULL,
  next_action text NOT NULL,
  evidence text,
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS intent_scores_conversation_idx ON intent_scores (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS intent_scores_tenant_idx ON intent_scores (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  disabled boolean NOT NULL DEFAULT false,
  last_used_at timestamp,
  request_count integer NOT NULL DEFAULT 0,
  rate_limit_reset_at timestamp,
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_uniq ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys (tenant_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  source text NOT NULL,
  event_type text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  payload jsonb,
  processed_at timestamp,
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_events_created_idx ON webhook_events (created_at);
CREATE INDEX IF NOT EXISTS webhook_events_tenant_idx ON webhook_events (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret_encrypted text,
  events jsonb NOT NULL DEFAULT '["*"]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_tenant_idx ON webhook_endpoints (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamp DEFAULT NOW() NOT NULL,
  response_code integer,
  last_error text,
  created_at timestamp DEFAULT NOW() NOT NULL,
  delivered_at timestamp
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON webhook_deliveries (status, next_run_at);

CREATE TABLE IF NOT EXISTS ops_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  scope text NOT NULL DEFAULT 'all_tenants',
  status text NOT NULL DEFAULT 'queued',
  created_by text NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL,
  completed_at timestamp
);
