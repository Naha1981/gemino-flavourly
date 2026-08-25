-- Engine 6 — Operations & Integration Engine.
--
-- Additive DDL for existing Engine 1-4 installations.
-- Mirrors apps/main/lib/db/schema.ts changes.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp' NOT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS external_id text;
CREATE INDEX IF NOT EXISTS conversations_tenant_channel_idx ON conversations (tenant_id, channel);
CREATE INDEX IF NOT EXISTS conversations_tenant_external_idx ON conversations (tenant_id, external_id);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_segment text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS offer text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_date timestamp;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_date timestamp;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS launched_at timestamp;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS estimated_reach integer;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS estimated_revenue_cents integer;
CREATE INDEX IF NOT EXISTS campaigns_tenant_status_idx ON campaigns (tenant_id, status);

CREATE TABLE IF NOT EXISTS channel_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel text NOT NULL,
  credentials_encrypted text,
  enabled boolean DEFAULT false NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS channel_configs_tenant_channel_idx ON channel_configs (tenant_id, channel);
CREATE INDEX IF NOT EXISTS channel_configs_tenant_idx ON channel_configs (tenant_id);

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_text text NOT NULL,
  risk_level text NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  approved_by text,
  approved_at timestamp,
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS approval_requests_tenant_status_idx ON approval_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS approval_requests_conversation_idx ON approval_requests (conversation_id);
