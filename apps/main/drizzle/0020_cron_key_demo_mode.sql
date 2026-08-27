-- Cron fleet manager (UI-driven) + demo-mode flag.
-- Mirrored step-for-step in apps/main/app/api/migrate/route.ts (section 25).
-- cronjob_api_key holds AES-256-GCM ciphertext (never plaintext);
-- demo_seed_active is true while the deadbeef seed dataset is loaded.

ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS cronjob_api_key text;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS demo_seed_active boolean DEFAULT false NOT NULL;
