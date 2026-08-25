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

    // 9. Gate #3 — cancellation follow-up. All additive: `cancelled_at`
    // stays NULL for every pre-existing row, so cancellations recorded
    // before this column existed are never followed up. Guessing a
    // timestamp for them would message customers about cancellations
    // nobody remembers making.
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_at timestamp;`;
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancellation_followup_sent boolean DEFAULT false NOT NULL;`;
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancellation_followup_sent_at timestamp;`;
    // The follow-up cron runs every 6 hours against a table that only ever
    // grows; a partial index keeps that scan to rows that could match.
    await sql`
      CREATE INDEX IF NOT EXISTS reservations_cancellation_followup_idx
        ON reservations (cancelled_at)
        WHERE status = 'cancelled' AND cancellation_followup_sent = false;
    `;

    // 10. Gate #4 — no-show monitoring. All additive: pre-existing rows
    // keep no_show_detected_at NULL and are never treated as no-shows.
    // Detection flags live alongside `status` (not in it) because marking
    // a booking 'no_show' is a staff decision — the customer can still
    // walk in after the grace period.
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show_detected boolean DEFAULT false NOT NULL;`;
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show_detected_at timestamp;`;
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show_followup_sent boolean DEFAULT false NOT NULL;`;
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show_followup_sent_at timestamp;`;
    // The no-show cron runs every 30 minutes against a table that only
    // ever grows; partial indexes keep each scan to rows that could match.
    await sql`
      CREATE INDEX IF NOT EXISTS reservations_no_show_detection_idx
        ON reservations (date)
        WHERE status = 'confirmed' AND no_show_detected = false;
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS reservations_no_show_followup_idx
        ON reservations (no_show_detected_at)
        WHERE no_show_followup_sent = false AND no_show_detected_at IS NOT NULL;
    `;

    // 11. Gate #7 — Customer 360 profiles. Additive CREATE TABLE.
    await sql`
      CREATE TABLE IF NOT EXISTS customer_profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        customer_phone text NOT NULL,
        customer_name text,
        total_visits integer DEFAULT 0 NOT NULL,
        total_spend_cents integer DEFAULT 0 NOT NULL,
        avg_party_size numeric DEFAULT 0 NOT NULL,
        last_visit_at timestamp,
        first_visit_at timestamp,
        preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
        segment text DEFAULT 'new' NOT NULL,
        segment_confidence numeric DEFAULT 0 NOT NULL,
        segment_updated_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL,
        updated_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS customer_profiles_tenant_idx ON customer_profiles (tenant_id);`;
    await sql`CREATE INDEX IF NOT EXISTS customer_profiles_phone_idx ON customer_profiles (customer_phone);`;
    await sql`CREATE INDEX IF NOT EXISTS customer_profiles_contact_idx ON customer_profiles (contact_id);`;

    // 12. Gate #8 — Customer Segmentation. Keep these ALTER statements even
    // though the CREATE TABLE above includes the columns: /api/migrate is
    // also used against databases where Gate #7 already created the table.
    await sql`ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS segment text DEFAULT 'new' NOT NULL;`;
    await sql`ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS segment_confidence numeric DEFAULT 0 NOT NULL;`;
    await sql`ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS segment_updated_at timestamp;`;
    await sql`CREATE INDEX IF NOT EXISTS customer_profiles_segment_idx ON customer_profiles (segment);`;

    // 13. Gate #9 — Reactivation Campaigns. Additive CREATE TABLE; one row
    // per reactivation message queued to a dormant / at-risk customer.
    // `sent_at` NULL means the campaign is still pending dispatch, so the
    // partial index keeps the cron's pending scan and the dashboard's
    // pending view off the full campaign history.
    await sql`
      CREATE TABLE IF NOT EXISTS reactivation_campaigns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_phone text NOT NULL,
        segment text NOT NULL,
        message_text text NOT NULL,
        sent_at timestamp,
        responded boolean DEFAULT false NOT NULL,
        created_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS reactivation_campaigns_tenant_idx ON reactivation_campaigns (tenant_id);`;
    await sql`CREATE INDEX IF NOT EXISTS reactivation_campaigns_phone_idx ON reactivation_campaigns (customer_phone);`;
    await sql`
      CREATE INDEX IF NOT EXISTS reactivation_campaigns_pending_idx
        ON reactivation_campaigns (tenant_id, sent_at)
        WHERE sent_at IS NULL;
    `;

    // 14. Gate #10 — VIP Recognition. Additive CREATE TABLE; one row per VIP
    // customer who walks in (first message of a new conversation). `sent_at`
    // is the staff-facing alert moment; `served_at` / `note` support the
    // VIP-today quick actions without dispatching anything to the customer.
    await sql`
      CREATE TABLE IF NOT EXISTS vip_alerts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_phone text NOT NULL,
        customer_name text,
        total_visits integer NOT NULL,
        total_spend_cents integer NOT NULL,
        last_visit_at timestamp NOT NULL,
        preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
        sent_at timestamp DEFAULT NOW() NOT NULL,
        served_at timestamp,
        note text
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS vip_alerts_tenant_idx ON vip_alerts (tenant_id);`;
    await sql`CREATE INDEX IF NOT EXISTS vip_alerts_phone_idx ON vip_alerts (customer_phone);`;
    await sql`CREATE INDEX IF NOT EXISTS vip_alerts_sent_idx ON vip_alerts (sent_at);`;

    // 15. Gate #11 — Google Review Monitoring. Additive CREATE TABLEs.
    await sql`
      CREATE TABLE IF NOT EXISTS google_reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        google_place_id text NOT NULL,
        review_id text NOT NULL UNIQUE,
        author_name text NOT NULL,
        rating integer NOT NULL,
        text text,
        time timestamp NOT NULL,
        sentiment text DEFAULT 'neutral' NOT NULL,
        response_text text,
        response_sent_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS google_reviews_tenant_idx ON google_reviews (tenant_id);`;
    await sql`CREATE INDEX IF NOT EXISTS google_reviews_rating_idx ON google_reviews (rating);`;
    await sql`CREATE INDEX IF NOT EXISTS google_reviews_time_idx ON google_reviews (time);`;
    await sql`
      CREATE TABLE IF NOT EXISTS google_places_config (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        place_id text NOT NULL,
        api_key_encrypted text,
        last_fetch_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS google_places_config_tenant_uniq ON google_places_config (tenant_id);`;
    await sql`CREATE INDEX IF NOT EXISTS google_places_config_tenant_idx ON google_places_config (tenant_id);`;

    // 16. Gate #13 — Post-Visit Review Requests. Additive columns + the
    // partial index that keeps the hourly cron's scan cheap. (The gate names
    // a (review_request_sent, date, time) index; `time` is not a separate
    // column — the booking datetime lives in `date`.)
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_request_sent boolean DEFAULT false NOT NULL;`;
    await sql`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_request_sent_at timestamp;`;
    await sql`
      CREATE INDEX IF NOT EXISTS reservations_review_request_idx
        ON reservations (review_request_sent, date)
        WHERE status IN ('confirmed', 'completed') AND review_request_sent = false;
    `;

    // 17. Gate #14 — Competitor Rating Monitoring. Additive CREATE TABLEs.
    await sql`
      CREATE TABLE IF NOT EXISTS competitors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        google_place_id text NOT NULL,
        current_rating numeric DEFAULT 0 NOT NULL,
        review_count integer DEFAULT 0 NOT NULL,
        last_check_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS competitors_tenant_idx ON competitors (tenant_id);`;
    await sql`
      CREATE TABLE IF NOT EXISTS competitor_rating_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        competitor_id uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
        rating numeric NOT NULL,
        review_count integer NOT NULL,
        recorded_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS competitor_rating_history_competitor_idx
        ON competitor_rating_history (competitor_id);
    `;

    // 18. Gates #15-#18 — Local Market Intelligence Engine. Mirrors
    // drizzle/0012_competitors.sql. Everything is additive except the
    // google_place_id relaxation, which is what makes a hand-added competitor
    // (no Google listing) insertable at all.
    await sql`
      CREATE TABLE IF NOT EXISTS competitors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        google_place_id text,
        current_rating numeric DEFAULT 0 NOT NULL,
        review_count integer DEFAULT 0 NOT NULL,
        last_check_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS address text;`;
    await sql`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS latitude numeric;`;
    await sql`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS longitude numeric;`;
    await sql`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS distance_km numeric;`;
    await sql`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS website_url text;`;
    await sql`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS phone text;`;
    await sql`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS place_data jsonb DEFAULT '{}'::jsonb NOT NULL;`;
    await sql`ALTER TABLE competitors ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW() NOT NULL;`;
    await sql`ALTER TABLE competitors ALTER COLUMN google_place_id DROP NOT NULL;`;
    await sql`CREATE INDEX IF NOT EXISTS competitors_distance_idx ON competitors (distance_km);`;

    // Tenant location + the tenant's own menu (positioning analysis input).
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address text;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS latitude numeric;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS longitude numeric;`;
    await sql`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS menu_text text;`;

    // One row per menu scrape that CHANGED something (unchanged menus write
    // nothing), so the table reads as a timeline of real edits.
    await sql`
      CREATE TABLE IF NOT EXISTS competitor_menu_snapshots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        competitor_id uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
        menu_url text,
        menu_text text,
        price_range text,
        snapshot_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS competitor_menu_snapshots_competitor_idx
        ON competitor_menu_snapshots (competitor_id);
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS competitor_promotions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        competitor_id uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
        promotion_text text NOT NULL,
        source text,
        detected_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS competitor_promotions_competitor_idx
        ON competitor_promotions (competitor_id);
    `;

    // (tenant_id, key) is unique: a re-run refreshes the row instead of
    // duplicating it, and never clears an "addressed" flag.
    await sql`
      CREATE TABLE IF NOT EXISTS market_opportunities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        key text NOT NULL,
        opportunity_type text NOT NULL,
        title text NOT NULL,
        description text NOT NULL,
        confidence numeric DEFAULT 0 NOT NULL,
        evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
        addressed boolean DEFAULT false NOT NULL,
        addressed_at timestamp,
        detected_at timestamp DEFAULT NOW() NOT NULL,
        updated_at timestamp DEFAULT NOW() NOT NULL
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS market_opportunities_tenant_idx ON market_opportunities (tenant_id);`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS market_opportunities_tenant_key_uniq
        ON market_opportunities (tenant_id, key);
    `;

    return NextResponse.json({ ok: true, message: 'All Neon database columns and tables synchronized successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Migration failed' }, { status: 500 });
  }
}
