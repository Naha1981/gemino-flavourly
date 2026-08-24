import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  // This endpoint runs schema DDL against production. It was previously
  // public and unauthenticated — anyone who found the URL could hit it.
  // Gated the same way as the Super Admin dashboard: staff_members role
  // OR ADMIN_EMAIL/SUPER_ADMIN_EMAILS allowlist, checked via a live Clerk
  // API call rather than session claims.
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  try {
    const sql = neon(dbUrl);

    // 1. Tenants table
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS opening_hours text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_personality text DEFAULT 'friendly and professional';`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS system_prompt text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();`;

    // 2. Conversations table
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS manual_takeover boolean DEFAULT false;`;
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_resolved boolean DEFAULT false;`;
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS outcome text;`;
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS estimated_value_cents integer DEFAULT 0;`;
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS outcome_classified_at timestamp;`;
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS outcome_classifier text;`;
    await sql`
      CREATE INDEX IF NOT EXISTS conversations_outcome_tenant_idx
        ON conversations (tenant_id, outcome, outcome_classified_at);
    `;

    // 3. Contacts table
    await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS blocklisted boolean DEFAULT false;`;
    await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS vip boolean DEFAULT false;`;
    await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS loyalty_points integer DEFAULT 0;`;

    // 4. Staff members table
    await sql`
      CREATE TABLE IF NOT EXISTS staff_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
        clerk_user_id text NOT NULL,
        email text,
        name text,
        role text NOT NULL DEFAULT 'staff',
        created_at timestamp DEFAULT NOW()
      );
    `;

    // 5. WhatsApp (Baileys) Signal key store — required for sessions to
    // survive an operator restart without a fresh QR scan.
    await sql`
      CREATE TABLE IF NOT EXISTS wa_auth_keys (
        wa_account_id uuid NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
        key_type text NOT NULL,
        key_id text NOT NULL,
        value jsonb
      );
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS wa_auth_keys_pk
        ON wa_auth_keys (wa_account_id, key_type, key_id);
    `;

    // 6. Message idempotency (dedupe on WhatsApp's own message id) and
    // outbox stuck-job reaping (needs to know when a job last changed
    // status, not just when it was created).
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id text;`;
    // Upgraded from a plain (non-unique) index to a real DB-level unique
    // constraint: the application-level "SELECT before INSERT" idempotency
    // check in the webhook route has its own race window if two requests
    // for the same WhatsApp message ever overlap. This makes duplicate
    // prevention an actual guarantee at the database level, not just a
    // best-effort check. Partial (WHERE wa_message_id IS NOT NULL) because
    // outbound/AI-generated messages never have one and must not collide
    // with each other under a NULL-vs-NULL uniqueness rule.
    await sql`DROP INDEX IF EXISTS messages_wa_message_id_idx;`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS messages_wa_message_id_unique
        ON messages (tenant_id, wa_message_id)
        WHERE wa_message_id IS NOT NULL;
    `;
    await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();`;

    // 7. Revenue intelligence linkage. Both columns are nullable for
    // existing rows; new rows can link a conversion back to the inbound
    // WhatsApp conversation that created it.
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;`;
    await sql`ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;`;
    await sql`
      CREATE TABLE IF NOT EXISTS revenue_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_type text NOT NULL,
        conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
        estimated_value_cents integer DEFAULT 0 NOT NULL,
        realized_cents integer DEFAULT 0 NOT NULL,
        occurred_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS revenue_events_tenant_occurred_idx
        ON revenue_events (tenant_id, occurred_at);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS revenue_events_conversation_idx
        ON revenue_events (conversation_id);
    `;

    // 8. Outbound delivery state. Additive and backward compatible:
    // nullable with no default, so every existing row keeps NULL and is
    // rendered as "no delivery information" rather than being
    // retroactively relabelled. Only messages written after this
    // migration carry a state.
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status text;`;
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_error text;`;
    // Lets the outbox reconcile a job back to its message row cheaply,
    // and lets the dashboard find undelivered messages without scanning.
    await sql`
      CREATE INDEX IF NOT EXISTS messages_delivery_status_idx
        ON messages (tenant_id, delivery_status)
        WHERE delivery_status IS NOT NULL;
    `;

    return NextResponse.json({ ok: true, message: 'All Neon database columns and tables synchronized successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Migration failed' }, { status: 500 });
  }
}
