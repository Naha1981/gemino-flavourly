-- GATE PM-1 — PulseMap campaign reaction simulator.
-- Mirrored step-for-step in apps/main/lib/db/migrate-ddl.ts (section 28).
--
-- Purely additive: three new tables, zero changes to existing tables.
--
-- PII RULE: campaign_simulations stores ONLY (a) the campaign's own text
-- (which the owner wrote), (b) aggregated/anonymized segment summaries
-- (counts + averages per segment — never a phone number, name, or
-- transcript), and (c) the forecast itself. No raw customer PII, ever.
--
-- campaign_simulation_feedback is the PM-2 hook: the after-launch loop
-- compares predicted vs actual replies/bookings/recovered revenue once a
-- launched campaign has real results. Columns are nullable now and filled
-- by a future phase — the structure exists so predictions can be compared
-- against reality from day one of the first launch.

CREATE TABLE IF NOT EXISTS campaign_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  source text NOT NULL DEFAULT 'ai',
  status text NOT NULL DEFAULT 'complete',
  score integer,
  readiness text,
  best_segment text,
  purchase_intent text,
  objections jsonb,
  likely_replies jsonb,
  risk_flags jsonb,
  improved_copy text,
  explanation text,
  confidence text,
  assumptions jsonb,
  segment_summaries jsonb,
  model text,
  applied_at timestamp,
  applied_to_campaign_id uuid REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_simulations_tenant_idx
  ON campaign_simulations (tenant_id);
CREATE INDEX IF NOT EXISTS campaign_simulations_campaign_idx
  ON campaign_simulations (campaign_id);

CREATE TABLE IF NOT EXISTS campaign_simulation_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id uuid NOT NULL REFERENCES campaign_simulations(id) ON DELETE CASCADE,
  segment text NOT NULL,
  reaction text,
  purchase_intent integer,
  primary_objection text
);

CREATE INDEX IF NOT EXISTS campaign_simulation_segments_sim_idx
  ON campaign_simulation_segments (simulation_id);

CREATE TABLE IF NOT EXISTS campaign_simulation_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  simulation_id uuid NOT NULL REFERENCES campaign_simulations(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  predicted_replies integer,
  predicted_bookings integer,
  predicted_objections jsonb,
  actual_replies integer,
  actual_bookings integer,
  actual_recovered_cents integer,
  notes text,
  recorded_at timestamp DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_simulation_feedback_sim_idx
  ON campaign_simulation_feedback (simulation_id);
