-- GATE QA-2 — Super Admin notification inbox (failure alerts).
-- Mirrored step-for-step in apps/main/lib/db/migrate-ddl.ts (section 29).
--
-- Written ONLY by the alert pipeline (lib/qa/alerts.ts) when the QA smoke
-- sweep or the scheduled Playwright persona run reports a failing check.
-- `check` is the dedupe key (same failing check -> one alert per 6h);
-- read_at IS NULL drives the unread badge in the Super Admin portal.
-- No tenant_id on purpose: these are platform-level health alerts.

CREATE TABLE IF NOT EXISTS admin_notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        severity text DEFAULT 'info' NOT NULL,
        "check" text NOT NULL,
        message text NOT NULL,
        report_url text,
        read_at timestamp,
        created_at timestamp DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_notifications_created_idx
      ON admin_notifications (created_at);

CREATE INDEX IF NOT EXISTS admin_notifications_check_created_idx
      ON admin_notifications ("check", created_at);

CREATE INDEX IF NOT EXISTS admin_notifications_unread_idx
      ON admin_notifications (read_at);
