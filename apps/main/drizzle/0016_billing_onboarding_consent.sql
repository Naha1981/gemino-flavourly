-- 0016 — Billing (PayFast), onboarding, consent records.
-- Adds billing columns to tenants, onboarding flag, and a consent_records table.

-- Tenants: billing state
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan text DEFAULT 'trial' NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_status text DEFAULT 'trialing' NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamp DEFAULT (now() + interval '14 days') NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payfast_customer_token text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payfast_subscription_token text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false NOT NULL;

-- Consent records (POPIA sign-up consent)
CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  consent_version text NOT NULL,
  consented_at timestamp DEFAULT NOW() NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS consent_records_tenant_idx ON consent_records (tenant_id);
