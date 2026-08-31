-- O1 — Loyalty GPS-gated redemption.
-- Mirrored step-for-step in apps/main/lib/db/migrate-ddl.ts (section 26).
--
-- reward_events: one row per REDEEM keyword handled by the WhatsApp
-- responder. `pending` rows carry a single-use claim_token; the guest opens
-- /geo-claim/[token] at the table, the browser submits coordinates, the
-- server measures Haversine distance to the tenant's geocoded location and
-- only a submission within 500m flips the row to `verified` (and deducts
-- points). distance_m is stored on every outcome so the dashboard can show
-- "verified at 120m" — auditability is the point of the gate.
--
-- loyalty_transactions.ref_id: idempotency key for programmatic writes
-- (welcome bonus, visit earn, geo-verified redemption). Unique index turns
-- a retried insert into a no-op instead of a double award/deduction.
-- Nullable: pre-existing rows and manual adjustments keep NULL (Postgres
-- treats NULLs as distinct, so the index does not affect them).

CREATE TABLE IF NOT EXISTS reward_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
      reward_name text NOT NULL,
      points_cost integer NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      claim_token text NOT NULL,
      gps_lat double precision,
      gps_lng double precision,
      distance_m integer,
      rejection_reason text,
      claimed_at timestamp,
      expires_at timestamp NOT NULL,
      created_at timestamp DEFAULT NOW() NOT NULL,
      verified_at timestamp
    );

CREATE UNIQUE INDEX IF NOT EXISTS reward_events_claim_token_uniq ON reward_events (claim_token);

CREATE INDEX IF NOT EXISTS reward_events_tenant_status_idx ON reward_events (tenant_id, status);

ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS ref_id text;

CREATE UNIQUE INDEX IF NOT EXISTS loyalty_transactions_ref_id_uniq ON loyalty_transactions (ref_id);

CREATE INDEX IF NOT EXISTS loyalty_transactions_tenant_contact_idx ON loyalty_transactions (tenant_id, contact_id);
