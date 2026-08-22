CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  owner_email text,
  description text,
  opening_hours text,
  ai_personality text DEFAULT 'friendly and professional',
  ai_enabled boolean DEFAULT true NOT NULL,
  manual_mode boolean DEFAULT false NOT NULL,
  system_prompt text,
  menu_text text,
  monthly_fee numeric(10, 2) DEFAULT 49.00,
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number text,
  session_creds text,
  is_connected boolean DEFAULT false NOT NULL,
  qr_code text,
  status text DEFAULT 'unlinked',
  last_connected_at timestamp,
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_auth_keys (
  wa_account_id uuid NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
  key_type text NOT NULL,
  key_id text NOT NULL,
  value jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS wa_auth_keys_pk ON wa_auth_keys (wa_account_id, key_type, key_id);

CREATE TABLE IF NOT EXISTS wa_account_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_account_id uuid NOT NULL,
  app_id text NOT NULL,
  tenant_id uuid NOT NULL,
  webhook_url text NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  blocklisted boolean DEFAULT false NOT NULL,
  vip boolean DEFAULT false NOT NULL,
  loyalty_points integer DEFAULT 0 NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_idx ON contacts (tenant_id, phone);
CREATE INDEX IF NOT EXISTS contacts_phone_idx ON contacts (phone);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  wa_account_id uuid REFERENCES wa_accounts(id) ON DELETE SET NULL,
  manual_takeover boolean DEFAULT false NOT NULL,
  is_resolved boolean DEFAULT false NOT NULL,
  last_message_at timestamp DEFAULT NOW() NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction text NOT NULL,
  content text NOT NULL,
  is_ai_generated boolean DEFAULT false NOT NULL,
  sentiment text,
  message_type text DEFAULT 'text',
  wa_message_id text,
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_tenant_created_idx ON messages (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS messages_wa_message_id_idx ON messages (tenant_id, wa_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_wa_message_id_uniq ON messages (tenant_id, wa_message_id) WHERE wa_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name text,
  customer_phone text,
  date timestamp NOT NULL,
  party_size integer NOT NULL,
  status text DEFAULT 'confirmed' NOT NULL,
  deposit numeric(10, 2),
  notes text,
  created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  type text NOT NULL,
  status text DEFAULT 'new' NOT NULL,
  data jsonb DEFAULT '{}',
  created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount integer NOT NULL,
  description text,
  created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  points_cost integer NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  customer_name text,
  customer_phone text,
  party_size integer NOT NULL,
  status text DEFAULT 'waiting' NOT NULL,
  estimated_wait_minutes integer DEFAULT 20,
  notified_at timestamp,
  created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  audience_filter jsonb DEFAULT '{}',
  message text NOT NULL,
  sent_count integer DEFAULT 0,
  sent_at timestamp,
  status text DEFAULT 'draft' NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 5 NOT NULL,
  next_run_at timestamp DEFAULT NOW() NOT NULL,
  last_error text,
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_next_run_idx ON jobs (status, next_run_at);

CREATE TABLE IF NOT EXISTS system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_ai_switch boolean DEFAULT true NOT NULL,
  maintenance_mode boolean DEFAULT false NOT NULL,
  global_notice text,
  updated_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL,
  email text,
  name text,
  role text DEFAULT 'staff' NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_account_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS menu_text text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();
