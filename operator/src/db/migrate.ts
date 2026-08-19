import { pool } from './client.js';

console.log('🚀 Running production Neon PostgreSQL schema migration...');

async function run() {
  const client = await pool.connect();
  try {
    console.log('1. Syncing tenants columns...');
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description text;`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS opening_hours text;`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_personality text DEFAULT 'friendly and professional';`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email text;`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS system_prompt text;`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();`);

    console.log('2. Syncing conversations columns...');
    await client.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS manual_takeover boolean DEFAULT false;`);
    await client.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_resolved boolean DEFAULT false;`);

    console.log('3. Syncing contacts columns...');
    await client.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS blocklisted boolean DEFAULT false;`);
    await client.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS vip boolean DEFAULT false;`);
    await client.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS loyalty_points integer DEFAULT 0;`);

    console.log('4. Syncing staff_members table...');
    await client.query(`
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

    console.log('✅ ALL PRODUCTION SCHEMA COLUMNS & TABLES SYNCHRONIZED SUCCESSFULLY IN NEON POSTGRESQL!');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
