const DB_URL = "postgresql://neondb_owner:npg_mzHWL3rPRX7T@ep-lingering-meadow-ash9cvq6.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=require";

// Extract host and password
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

    console.log('✅ ALL PRODUCTION SCHEMA COLUMNS & TABLES ARE 100% SYNCHRONIZED IN NEON POSTGRESQL!');
  } catch (err) {
    console.error('❌ Error executing SQL on Neon:', err.message);
    process.exit(1);
  }
}

main();
