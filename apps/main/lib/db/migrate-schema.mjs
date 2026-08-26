import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read .env.local
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  try {
    const envPath = resolve(process.cwd(), '.env.local');
    const envContent = readFileSync(envPath, 'utf8');
    const match = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
    if (match) dbUrl = match[1];
  } catch (err) {
    // fallback
  }
}

if (!dbUrl) {
  try {
    const envPath = resolve(process.cwd(), 'apps/main/.env.local');
    const envContent = readFileSync(envPath, 'utf8');
    const match = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
    if (match) dbUrl = match[1];
  } catch (err) {
    // fallback
  }
}

if (!dbUrl) {
  console.error('❌ DATABASE_URL not found');
  process.exit(1);
}

const sql = neon(dbUrl);

console.log('🚀 Connecting to Neon PostgreSQL and synchronizing schema columns...');

async function migrate() {
  try {
    // 1. Tenants table updates
    console.log('1. Syncing tenants columns...');
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS opening_hours text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_personality text DEFAULT 'friendly and professional';`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS system_prompt text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();`;

    // 2. Conversations table updates
    console.log('2. Syncing conversations columns...');
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS manual_takeover boolean DEFAULT false;`;
    await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_resolved boolean DEFAULT false;`;

    // 3. Contacts table updates
    console.log('3. Syncing contacts columns...');
    await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS blocklisted boolean DEFAULT false;`;
    await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS vip boolean DEFAULT false;`;
    await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS loyalty_points integer DEFAULT 0;`;
    await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS birthday text;`;

    // 4. Staff members table
    console.log('4. Syncing staff_members table...');
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

    // 5. Magic Link feature (prospects, brand profiles, claim tokens)
    console.log('5. Syncing magic-link tables and columns...');
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_id text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tenant_mode text DEFAULT 'live' NOT NULL;`;
    await sql`
      CREATE TABLE IF NOT EXISTS brand_profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        source_url text,
        logo_url text,
        logo_path text,
        primary_color text,
        secondary_color text,
        background_color text,
        font_family text,
        brand_name text,
        tagline text,
        menu_json jsonb,
        hours_json jsonb,
        google_places_id text,
        confidence real,
        extracted_at timestamp
      );
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS brand_profiles_tenant_uniq ON brand_profiles (tenant_id);`;
    await sql`
      CREATE TABLE IF NOT EXISTS prospects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        name text NOT NULL,
        website text NOT NULL,
        owner_email text,
        owner_phone text,
        city text,
        status text DEFAULT 'queued' NOT NULL,
        error text,
        retries integer DEFAULT 0 NOT NULL,
        tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
        claim_token text,
        claimed_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL,
        updated_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS prospects_status_idx ON prospects (status);`;
    await sql`CREATE INDEX IF NOT EXISTS prospects_tenant_idx ON prospects (tenant_id);`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS prospects_claim_token_uniq ON prospects (claim_token);`;
    await sql`
      CREATE TABLE IF NOT EXISTS tenant_claim_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        token text NOT NULL,
        created_at timestamp DEFAULT NOW() NOT NULL,
        claimed_at timestamp,
        claimed_by_user_id text,
        expires_at timestamp NOT NULL
      );
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS tenant_claim_tokens_token_uniq ON tenant_claim_tokens (token);`;
    await sql`CREATE INDEX IF NOT EXISTS tenant_claim_tokens_tenant_id_idx ON tenant_claim_tokens (tenant_id);`;

    console.log('✅ ALL PRODUCTION SCHEMA COLUMNS & TABLES SYNCHRONIZED SUCCESSFULLY IN NEON POSTGRESQL!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();
