// One-off schema-sync script — same statements as apps/main/app/api/migrate
// and operator/src/db/migrate.ts, runnable from the command line without
// a signed-in browser session.
//
// SECURITY: this file previously had a live Neon database password
// hardcoded in plaintext, committed to a public GitHub repo. That
// credential is compromised regardless of this fix — removing it from
// the file does NOT remove it from git history. Rotate the Neon
// database password in the Neon console (Settings -> Reset password)
// and update DATABASE_URL everywhere it's configured (Vercel, Render)
// before treating this as resolved.
//
// Usage: DATABASE_URL="postgresql://...` node e2e/neon-sync.mjs

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL is not set. Usage: DATABASE_URL="postgresql://..." node e2e/neon-sync.mjs');
  process.exit(1);
}

const parsed = new URL(DB_URL);
const host = parsed.hostname.replace('-pooler', '');
const password = parsed.password;

console.log(`🚀 Connecting directly to Neon SQL endpoint at https://${host}/sql ...`);

async function execSql(query) {
  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${password}`,
      'neon-connection-string': DB_URL,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return await res.json();
}

async function main() {
  try {
    console.log('1. Adding columns to tenants table...');
    await execSql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description text;`);
    await execSql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS opening_hours text;`);
    await execSql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_personality text DEFAULT 'friendly and professional';`);
    await execSql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email text;`);
    await execSql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS system_prompt text;`);
    await execSql(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();`);

    console.log('2. Adding columns to conversations table...');
    await execSql(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS manual_takeover boolean DEFAULT false;`);
    await execSql(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_resolved boolean DEFAULT false;`);

    console.log('3. Adding columns to contacts table...');
    await execSql(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS blocklisted boolean DEFAULT false;`);
    await execSql(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS vip boolean DEFAULT false;`);
    await execSql(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS loyalty_points integer DEFAULT 0;`);

    console.log('4. Creating staff_members table if not exists...');
    await execSql(`
      CREATE TABLE IF NOT EXISTS staff_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
        clerk_user_id text NOT NULL,
        email text,
        name text,
        role text NOT NULL DEFAULT 'staff',
        created_at timestamp DEFAULT NOW()
      );
    `);

    console.log('5. Creating wa_auth_keys table if not exists (Baileys Signal key store)...');
    await execSql(`
      CREATE TABLE IF NOT EXISTS wa_auth_keys (
        wa_account_id uuid NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
        key_type text NOT NULL,
        key_id text NOT NULL,
        value jsonb
      );
    `);
    await execSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS wa_auth_keys_pk
        ON wa_auth_keys (wa_account_id, key_type, key_id);
    `);

    console.log('6. Syncing message idempotency (unique constraint) + job reaper columns...');
    await execSql(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id text;`);
    await execSql(`DROP INDEX IF EXISTS messages_wa_message_id_idx;`);
    await execSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS messages_wa_message_id_unique
        ON messages (tenant_id, wa_message_id)
        WHERE wa_message_id IS NOT NULL;
    `);
    await execSql(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();`);

    console.log('✅ ALL PRODUCTION SCHEMA COLUMNS & TABLES ARE 100% SYNCHRONIZED IN NEON POSTGRESQL!');
  } catch (err) {
    console.error('❌ Error executing SQL on Neon:', err.message);
    process.exit(1);
  }
}

main();
