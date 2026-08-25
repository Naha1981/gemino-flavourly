CREATE TABLE IF NOT EXISTS "marketing_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  "brief" jsonb NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "marketing_briefs_tenant_idx" ON "marketing_briefs" ("tenant_id");
CREATE INDEX IF NOT EXISTS "marketing_briefs_tenant_generated_idx" ON "marketing_briefs" ("tenant_id", "generated_at");