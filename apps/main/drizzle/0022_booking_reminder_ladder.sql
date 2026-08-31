-- O2 — booking reminder ladder (48/24/6h) + customer confirmation.
-- Mirrored step-for-step in apps/main/lib/db/migrate-ddl.ts (section 27).
--
-- One nullable timestamp per reminder rung: NULL = not sent. The cron claims
-- a rung with `WHERE reminderN_sent_at IS NULL`, which makes overlapping
-- cron runs safe (exactly one winner per rung) without any queue table.
-- customer_confirmed_at is stamped by the AI responder when the guest
-- replies CONFIRM/YES — informational only, it does not stop the ladder.

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reminder48_sent_at timestamp;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reminder24_sent_at timestamp;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reminder6_sent_at timestamp;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS customer_confirmed_at timestamp;

CREATE INDEX IF NOT EXISTS reservations_reminder_ladder_idx
      ON reservations (date)
      WHERE status = 'confirmed';
