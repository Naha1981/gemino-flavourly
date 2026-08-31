/**
 * Incremental migration DDL for /api/migrate.
 *
 * GENERATED FILE — do not edit by hand.
 * Source of truth: apps/main/app/api/migrate/route.ts
 * Regenerate with:  node scripts/gen-migrate-ddl.mjs
 *
 * Lifted verbatim out of the route handler so the SHIPPED statements can be
 * executed by the parity test (lib/db/migrate-parity.test.ts) instead of
 * only being asserted on as source text. Applied in order, after BASE_DDL.
 *
 * Every statement is idempotent — this route runs against production on
 * every deploy.
 */

/** Tables this DDL creates (23 total). */
export const MIGRATE_TABLES = [
  "approval_requests",
  "brand_profiles",
  "channel_configs",
  "competitor_menu_snapshots",
  "competitor_promotions",
  "competitor_rating_history",
  "competitors",
  "consent_records",
  "customer_profiles",
  "google_places_config",
  "google_reviews",
  "market_opportunities",
  "marketing_briefs",
  "marketing_campaigns",
  "marketing_events",
  "memberships",
  "prospects",
  "reactivation_campaigns",
  "revenue_events",
  "reward_events",
  "staff_members",
  "tenant_claim_tokens",
  "vip_alerts",
  "wa_auth_keys"
] as const;

/** Ordered, idempotent DDL statements. Applied after BASE_DDL. */
export const MIGRATE_DDL: readonly string[] = [

  // 1. Tenants table
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description text;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS opening_hours text;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_personality text DEFAULT 'friendly and professional';`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email text;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS system_prompt text;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();`,

  // 2. Conversations table
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS manual_takeover boolean DEFAULT false;`,

  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_resolved boolean DEFAULT false;`,

  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS outcome text;`,

  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS estimated_value_cents integer DEFAULT 0;`,

  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS outcome_classified_at timestamp;`,

  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS outcome_classifier text;`,

  `CREATE INDEX IF NOT EXISTS conversations_outcome_tenant_idx
        ON conversations (tenant_id, outcome, outcome_classified_at);`,

  // 3. Contacts table
  `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS blocklisted boolean DEFAULT false;`,

  `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS vip boolean DEFAULT false;`,

  `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS loyalty_points integer DEFAULT 0;`,

  `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS birthday text;`,

  // 4. Staff members table
  `CREATE TABLE IF NOT EXISTS staff_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
        clerk_user_id text NOT NULL,
        email text,
        name text,
        role text NOT NULL DEFAULT 'staff',
        created_at timestamp DEFAULT NOW()
      );`,

  // 5. WhatsApp (Baileys) Signal key store — required for sessions to
  // survive an operator restart without a fresh QR scan.
  `CREATE TABLE IF NOT EXISTS wa_auth_keys (
        wa_account_id uuid NOT NULL REFERENCES wa_accounts(id) ON DELETE CASCADE,
        key_type text NOT NULL,
        key_id text NOT NULL,
        value jsonb
      );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS wa_auth_keys_pk
        ON wa_auth_keys (wa_account_id, key_type, key_id);`,

  // 6. Message idempotency (dedupe on WhatsApp's own message id) and
  // outbox stuck-job reaping (needs to know when a job last changed
  // status, not just when it was created).
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id text;`,

  // Upgraded from a plain (non-unique) index to a real DB-level unique
  // constraint: the application-level "SELECT before INSERT" idempotency
  // check in the webhook route has its own race window if two requests
  // for the same WhatsApp message ever overlap. This makes duplicate
  // prevention an actual guarantee at the database level, not just a
  // best-effort check. Partial (WHERE wa_message_id IS NOT NULL) because
  // outbound/AI-generated messages never have one and must not collide
  // with each other under a NULL-vs-NULL uniqueness rule.
  `DROP INDEX IF EXISTS messages_wa_message_id_idx;`,

  `CREATE UNIQUE INDEX IF NOT EXISTS messages_wa_message_id_unique
        ON messages (tenant_id, wa_message_id)
        WHERE wa_message_id IS NOT NULL;`,

  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW();`,

  // 7. Revenue intelligence linkage. Both columns are nullable for
  // existing rows; new rows can link a conversion back to the inbound
  // WhatsApp conversation that created it.
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;`,

  `ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;`,

  `CREATE TABLE IF NOT EXISTS revenue_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_type text NOT NULL,
        conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
        estimated_value_cents integer DEFAULT 0 NOT NULL,
        realized_cents integer DEFAULT 0 NOT NULL,
        occurred_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS revenue_events_tenant_occurred_idx
        ON revenue_events (tenant_id, occurred_at);`,

  `CREATE INDEX IF NOT EXISTS revenue_events_conversation_idx
        ON revenue_events (conversation_id);`,

  // 8. Outbound delivery state. Additive and backward compatible:
  // nullable with no default, so every existing row keeps NULL and is
  // rendered as "no delivery information" rather than being
  // retroactively relabelled. Only messages written after this
  // migration carry a state.
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status text;`,

  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_error text;`,

  // Lets the outbox reconcile a job back to its message row cheaply,
  // and lets the dashboard find undelivered messages without scanning.
  `CREATE INDEX IF NOT EXISTS messages_delivery_status_idx
        ON messages (tenant_id, delivery_status)
        WHERE delivery_status IS NOT NULL;`,

  // 9. Gate #3 — cancellation follow-up. All additive: `cancelled_at`
  // stays NULL for every pre-existing row, so cancellations recorded
  // before this column existed are never followed up. Guessing a
  // timestamp for them would message customers about cancellations
  // nobody remembers making.
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancelled_at timestamp;`,

  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancellation_followup_sent boolean DEFAULT false NOT NULL;`,

  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cancellation_followup_sent_at timestamp;`,

  // The follow-up cron runs every 6 hours against a table that only ever
  // grows; a partial index keeps that scan to rows that could match.
  `CREATE INDEX IF NOT EXISTS reservations_cancellation_followup_idx
        ON reservations (cancelled_at)
        WHERE status = 'cancelled' AND cancellation_followup_sent = false;`,

  // 10. Gate #4 — no-show monitoring. All additive: pre-existing rows
  // keep no_show_detected_at NULL and are never treated as no-shows.
  // Detection flags live alongside `status` (not in it) because marking
  // a booking 'no_show' is a staff decision — the customer can still
  // walk in after the grace period.
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show_detected boolean DEFAULT false NOT NULL;`,

  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show_detected_at timestamp;`,

  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show_followup_sent boolean DEFAULT false NOT NULL;`,

  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show_followup_sent_at timestamp;`,

  // The no-show cron runs every 30 minutes against a table that only
  // ever grows; partial indexes keep each scan to rows that could match.
  `CREATE INDEX IF NOT EXISTS reservations_no_show_detection_idx
        ON reservations (date)
        WHERE status = 'confirmed' AND no_show_detected = false;`,

  `CREATE INDEX IF NOT EXISTS reservations_no_show_followup_idx
        ON reservations (no_show_detected_at)
        WHERE no_show_followup_sent = false AND no_show_detected_at IS NOT NULL;`,

  // 11. Gate #7 — Customer 360 profiles. Additive CREATE TABLE.
  `CREATE TABLE IF NOT EXISTS customer_profiles (
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
      );`,

  `CREATE INDEX IF NOT EXISTS customer_profiles_tenant_idx ON customer_profiles (tenant_id);`,

  `CREATE INDEX IF NOT EXISTS customer_profiles_phone_idx ON customer_profiles (customer_phone);`,

  `CREATE INDEX IF NOT EXISTS customer_profiles_contact_idx ON customer_profiles (contact_id);`,

  // 12. Gate #8 — Customer Segmentation. Keep these ALTER statements even
  // though the CREATE TABLE above includes the columns: /api/migrate is
  // also used against databases where Gate #7 already created the table.
  `ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS segment text DEFAULT 'new' NOT NULL;`,

  `ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS segment_confidence numeric DEFAULT 0 NOT NULL;`,

  `ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS segment_updated_at timestamp;`,

  `CREATE INDEX IF NOT EXISTS customer_profiles_segment_idx ON customer_profiles (segment);`,

  // 13. Gate #9 — Reactivation Campaigns. Additive CREATE TABLE; one row
  // per reactivation message queued to a dormant / at-risk customer.
  // `sent_at` NULL means the campaign is still pending dispatch, so the
  // partial index keeps the cron's pending scan and the dashboard's
  // pending view off the full campaign history.
  `CREATE TABLE IF NOT EXISTS reactivation_campaigns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_phone text NOT NULL,
        segment text NOT NULL,
        message_text text NOT NULL,
        sent_at timestamp,
        responded boolean DEFAULT false NOT NULL,
        created_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS reactivation_campaigns_tenant_idx ON reactivation_campaigns (tenant_id);`,

  `CREATE INDEX IF NOT EXISTS reactivation_campaigns_phone_idx ON reactivation_campaigns (customer_phone);`,

  `CREATE INDEX IF NOT EXISTS reactivation_campaigns_pending_idx
        ON reactivation_campaigns (tenant_id, sent_at)
        WHERE sent_at IS NULL;`,

  // 14. Gate #10 — VIP Recognition. Additive CREATE TABLE; one row per VIP
  // customer who walks in (first message of a new conversation). `sent_at`
  // is the staff-facing alert moment; `served_at` / `note` support the
  // VIP-today quick actions without dispatching anything to the customer.
  `CREATE TABLE IF NOT EXISTS vip_alerts (
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
      );`,

  `CREATE INDEX IF NOT EXISTS vip_alerts_tenant_idx ON vip_alerts (tenant_id);`,

  `CREATE INDEX IF NOT EXISTS vip_alerts_phone_idx ON vip_alerts (customer_phone);`,

  `CREATE INDEX IF NOT EXISTS vip_alerts_sent_idx ON vip_alerts (sent_at);`,

  // 15. Gate #11 — Google Review Monitoring. Additive CREATE TABLEs.
  `CREATE TABLE IF NOT EXISTS google_reviews (
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
      );`,

  `CREATE INDEX IF NOT EXISTS google_reviews_tenant_idx ON google_reviews (tenant_id);`,

  `CREATE INDEX IF NOT EXISTS google_reviews_rating_idx ON google_reviews (rating);`,

  `CREATE INDEX IF NOT EXISTS google_reviews_time_idx ON google_reviews (time);`,

  `CREATE TABLE IF NOT EXISTS google_places_config (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        place_id text NOT NULL,
        api_key_encrypted text,
        last_fetch_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS google_places_config_tenant_uniq ON google_places_config (tenant_id);`,

  `CREATE INDEX IF NOT EXISTS google_places_config_tenant_idx ON google_places_config (tenant_id);`,

  // 16. Gate #13 — Post-Visit Review Requests. Additive columns + the
  // partial index that keeps the hourly cron's scan cheap. (The gate names
  // a (review_request_sent, date, time) index; `time` is not a separate
  // column — the booking datetime lives in `date`.)
  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_request_sent boolean DEFAULT false NOT NULL;`,

  `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_request_sent_at timestamp;`,

  `CREATE INDEX IF NOT EXISTS reservations_review_request_idx
        ON reservations (review_request_sent, date)
        WHERE status IN ('confirmed', 'completed') AND review_request_sent = false;`,

  // 17. Gate #14 — Competitor Rating Monitoring. Additive CREATE TABLEs.
  `CREATE TABLE IF NOT EXISTS competitors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        google_place_id text NOT NULL,
        current_rating numeric DEFAULT 0 NOT NULL,
        review_count integer DEFAULT 0 NOT NULL,
        last_check_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS competitors_tenant_idx ON competitors (tenant_id);`,

  `CREATE TABLE IF NOT EXISTS competitor_rating_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        competitor_id uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
        rating numeric NOT NULL,
        review_count integer NOT NULL,
        recorded_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS competitor_rating_history_competitor_idx
        ON competitor_rating_history (competitor_id);`,

  // 18. Gates #15-#18 — Local Market Intelligence Engine. Mirrors
  // drizzle/0012_competitors.sql. Everything is additive except the
  // google_place_id relaxation, which is what makes a hand-added competitor
  // (no Google listing) insertable at all.
  `CREATE TABLE IF NOT EXISTS competitors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        google_place_id text,
        current_rating numeric DEFAULT 0 NOT NULL,
        review_count integer DEFAULT 0 NOT NULL,
        last_check_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS address text;`,

  `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS latitude numeric;`,

  `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS longitude numeric;`,

  `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS distance_km numeric;`,

  `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS website_url text;`,

  `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS phone text;`,

  `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS place_data jsonb DEFAULT '{}'::jsonb NOT NULL;`,

  `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT NOW() NOT NULL;`,

  `ALTER TABLE competitors ALTER COLUMN google_place_id DROP NOT NULL;`,

  `CREATE INDEX IF NOT EXISTS competitors_distance_idx ON competitors (distance_km);`,

  // Tenant location + the tenant's own menu (positioning analysis input).
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address text;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS latitude numeric;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS longitude numeric;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS menu_text text;`,

  // One row per menu scrape that CHANGED something (unchanged menus write
  // nothing), so the table reads as a timeline of real edits.
  `CREATE TABLE IF NOT EXISTS competitor_menu_snapshots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        competitor_id uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
        menu_url text,
        menu_text text,
        price_range text,
        snapshot_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS competitor_menu_snapshots_competitor_idx
        ON competitor_menu_snapshots (competitor_id);`,

  `CREATE TABLE IF NOT EXISTS competitor_promotions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        competitor_id uuid NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
        promotion_text text NOT NULL,
        source text,
        detected_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS competitor_promotions_competitor_idx
        ON competitor_promotions (competitor_id);`,

  // (tenant_id, key) is unique: a re-run refreshes the row instead of
  // duplicating it, and never clears an "addressed" flag.
  `CREATE TABLE IF NOT EXISTS market_opportunities (
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
      );`,

  `CREATE INDEX IF NOT EXISTS market_opportunities_tenant_idx ON market_opportunities (tenant_id);`,

  `CREATE UNIQUE INDEX IF NOT EXISTS market_opportunities_tenant_key_uniq
        ON market_opportunities (tenant_id, key);`,

  `CREATE TABLE IF NOT EXISTS marketing_briefs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        brief jsonb NOT NULL,
        generated_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS marketing_briefs_tenant_idx ON marketing_briefs (tenant_id);`,

  `CREATE INDEX IF NOT EXISTS marketing_briefs_tenant_generated_idx ON marketing_briefs (tenant_id, generated_at);`,

  // 19. Engine 6 — Operations & Integration Engine. Additive DDL for
  // multi-channel support, campaign enrichment, channel configs, and
  // approval workflows. Mirrors drizzle/0013_engine6_operations.sql.
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp' NOT NULL;`,

  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS external_id text;`,

  `CREATE INDEX IF NOT EXISTS conversations_tenant_channel_idx ON conversations (tenant_id, channel);`,

  `CREATE INDEX IF NOT EXISTS conversations_tenant_external_idx ON conversations (tenant_id, external_id);`,

  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS description text;`,

  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_segment text;`,

  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS offer text;`,

  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_date timestamp;`,

  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_date timestamp;`,

  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS launched_at timestamp;`,

  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS estimated_reach integer;`,

  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS estimated_revenue_cents integer;`,

  `CREATE INDEX IF NOT EXISTS campaigns_tenant_status_idx ON campaigns (tenant_id, status);`,

  `CREATE TABLE IF NOT EXISTS channel_configs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        channel text NOT NULL,
        credentials_encrypted text,
        enabled boolean DEFAULT false NOT NULL,
        created_at timestamp DEFAULT NOW() NOT NULL,
        updated_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS channel_configs_tenant_channel_idx ON channel_configs (tenant_id, channel);`,

  `CREATE INDEX IF NOT EXISTS channel_configs_tenant_idx ON channel_configs (tenant_id);`,

  `CREATE TABLE IF NOT EXISTS approval_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_text text NOT NULL,
        risk_level text NOT NULL,
        status text DEFAULT 'pending' NOT NULL,
        approved_by text,
        approved_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS approval_requests_tenant_status_idx ON approval_requests (tenant_id, status);`,

  `CREATE INDEX IF NOT EXISTS approval_requests_conversation_idx ON approval_requests (conversation_id);`,

  // 20. Engine 5 — Marketing Campaigns. Additive CREATE TABLE for proactive
  // marketing content (promotions, events, seasonal offers, announcements).
  // Mirrors drizzle/0014_marketing_campaigns.sql.
  `CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        description text,
        type text NOT NULL,
        target_segment text,
        offer text,
        message text NOT NULL,
        start_date timestamp,
        end_date timestamp,
        launched_at timestamp,
        estimated_reach integer,
        estimated_revenue_cents integer,
        sent_count integer DEFAULT 0 NOT NULL,
        sent_at timestamp,
        status text DEFAULT 'draft' NOT NULL,
        created_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS marketing_campaigns_tenant_idx ON marketing_campaigns (tenant_id);`,

  `CREATE INDEX IF NOT EXISTS marketing_campaigns_tenant_status_idx ON marketing_campaigns (tenant_id, status);`,

  `CREATE INDEX IF NOT EXISTS marketing_campaigns_tenant_type_idx ON marketing_campaigns (tenant_id, type);`,

  // 21. Engine 5 — Marketing Events. Additive CREATE TABLE for time-bound
  // marketing events (special dinners, live music, tastings, workshops).
  // Mirrors drizzle/0015_marketing_events.sql.
  `CREATE TABLE IF NOT EXISTS marketing_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        description text,
        event_type text NOT NULL,
        starts_at timestamp NOT NULL,
        ends_at timestamp NOT NULL,
        location text,
        capacity integer,
        booked_count integer DEFAULT 0 NOT NULL,
        message text,
        status text DEFAULT 'draft' NOT NULL,
        created_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS marketing_events_tenant_idx ON marketing_events (tenant_id);`,

  `CREATE INDEX IF NOT EXISTS marketing_events_tenant_status_idx ON marketing_events (tenant_id, status);`,

  `CREATE INDEX IF NOT EXISTS marketing_events_tenant_type_idx ON marketing_events (tenant_id, event_type);`,

  // 22. Billing (PayFast tokenized recurring), onboarding, consent records.
  // Mirrors drizzle/0016_billing_onboarding_consent.sql. All additive.
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan text DEFAULT 'trial' NOT NULL;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_status text DEFAULT 'trialing' NOT NULL;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamp DEFAULT (now() + interval '14 days') NOT NULL;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payfast_customer_token text;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payfast_subscription_token text;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false NOT NULL;`,

  `CREATE TABLE IF NOT EXISTS consent_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        consent_version text NOT NULL,
        consented_at timestamp DEFAULT NOW() NOT NULL,
        ip_address text,
        user_agent text,
        created_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE INDEX IF NOT EXISTS consent_records_tenant_idx ON consent_records (tenant_id);`,

  // 23. Magic Link feature (prospects, brand profiles, claim tokens).
  // These are the live-equivalent of the drizzle migration; all additive.
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_id text;`,

  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tenant_mode text DEFAULT 'live' NOT NULL;`,

  `CREATE TABLE IF NOT EXISTS brand_profiles (
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
      );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS brand_profiles_tenant_uniq ON brand_profiles (tenant_id);`,

  `CREATE TABLE IF NOT EXISTS prospects (
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
      );`,

  `CREATE INDEX IF NOT EXISTS prospects_status_idx ON prospects (status);`,

  `CREATE INDEX IF NOT EXISTS prospects_tenant_idx ON prospects (tenant_id);`,

  `CREATE UNIQUE INDEX IF NOT EXISTS prospects_claim_token_uniq ON prospects (claim_token);`,

  `CREATE TABLE IF NOT EXISTS tenant_claim_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        token text NOT NULL,
        created_at timestamp DEFAULT NOW() NOT NULL,
        claimed_at timestamp,
        claimed_by_user_id text,
        expires_at timestamp NOT NULL
      );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS tenant_claim_tokens_token_uniq ON tenant_claim_tokens (token);`,

  `CREATE INDEX IF NOT EXISTS tenant_claim_tokens_tenant_id_idx ON tenant_claim_tokens (tenant_id);`,

  // 24. S2/S4 — claim-redeem ownership + multi-tenant memberships.
  // Mirrors drizzle/0019_tenant_memberships.sql. owner_user_id is the
  // ownership column the tenant resolver treats as source of truth;
  // memberships carries per-user grants used by the tenant switcher and
  // /api/tenant/switch (which 403s any tenant the caller has no row for).
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_user_id text;`,

  `CREATE TABLE IF NOT EXISTS memberships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        user_id text NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        role text DEFAULT 'owner' NOT NULL,
        created_at timestamp DEFAULT NOW() NOT NULL,
        updated_at timestamp DEFAULT NOW() NOT NULL
      );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_tenant_uniq ON memberships (user_id, tenant_id);`,

  `CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);`,

  `CREATE INDEX IF NOT EXISTS memberships_tenant_idx ON memberships (tenant_id);`,

  // 25. Cron fleet manager + demo mode flags on system_settings.
  // Mirrors drizzle/0020_cron_key_demo_mode.sql. cronjob_api_key stores
  // AES-256-GCM ciphertext only; demo_seed_active drives the "Demo data"
  // chip while the deadbeef dataset is loaded.
  `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS cronjob_api_key text;`,

  `ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS demo_seed_active boolean DEFAULT false NOT NULL;`,

  // 26. O1 — Loyalty GPS-gated redemption.
  // Mirrors drizzle/0021_loyalty_gps_redemption.sql. reward_events carries
  // the single-use claim_token a guest redeems at the table via
  // /geo-claim/[token]; loyalty_transactions.ref_id is the idempotency key
  // that makes welcome bonuses / visit earns / verified redemptions
  // exactly-once under webhook retries and overlapping cron runs.
  `CREATE TABLE IF NOT EXISTS reward_events (
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
      );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS reward_events_claim_token_uniq ON reward_events (claim_token);`,

  `CREATE INDEX IF NOT EXISTS reward_events_tenant_status_idx ON reward_events (tenant_id, status);`,

  `ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS ref_id text;`,

  `CREATE UNIQUE INDEX IF NOT EXISTS loyalty_transactions_ref_id_uniq ON loyalty_transactions (ref_id);`,

  `CREATE INDEX IF NOT EXISTS loyalty_transactions_tenant_contact_idx ON loyalty_transactions (tenant_id, contact_id);`,
];
