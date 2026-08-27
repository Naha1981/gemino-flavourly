-- S2/S4 — Claim redeem ownership + multi-tenant memberships.
-- Mirrored step-for-step in apps/main/app/api/migrate/route.ts (section 24).
-- All statements additive; pre-existing rows keep NULL owner_user_id and
-- simply gain no membership rows until they claim or sign in again.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_user_id text;

CREATE TABLE IF NOT EXISTS memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text DEFAULT 'owner' NOT NULL,
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_tenant_uniq ON memberships (user_id, tenant_id);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);
CREATE INDEX IF NOT EXISTS memberships_tenant_idx ON memberships (tenant_id);
