-- Completion sweep knowledge + reservations support.
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime_type text NOT NULL,
  source_type text NOT NULL DEFAULT 'upload',
  content text NOT NULL,
  source_url text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT NOW() NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_documents_tenant_idx ON knowledge_documents (tenant_id, enabled, created_at);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  keywords text,
  created_at timestamp DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_idx ON knowledge_chunks (tenant_id, document_id, chunk_index);
