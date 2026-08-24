-- Gate #4: no-show monitoring.
--
-- A confirmed booking whose time has passed without the customer showing is
-- stamped no_show_detected / no_show_detected_at by the
-- /api/cron/no-show-detect cron (every 30 minutes). Two hours after the
-- stamp, the same cron sends one rebook offer and stamps
-- no_show_followup_sent.
--
-- All four columns are additive: both flags default false, both timestamps
-- stay NULL. Pre-existing rows are therefore untouched and can never be
-- retroactively detected or messaged.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "no_show_detected" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "no_show_detected_at" timestamp;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "no_show_followup_sent" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "no_show_followup_sent_at" timestamp;
--> statement-breakpoint
-- Partial index for the detection scan (every 30 minutes): only confirmed
-- bookings that have not yet been evaluated as a no-show.
CREATE INDEX IF NOT EXISTS "reservations_no_show_detection_idx"
  ON "reservations" ("date")
  WHERE "status" = 'confirmed' AND "no_show_detected" = false;
--> statement-breakpoint
-- Partial index for the follow-up scan: only detected no-shows whose
-- rebook offer has not gone out yet.
CREATE INDEX IF NOT EXISTS "reservations_no_show_followup_idx"
  ON "reservations" ("no_show_detected_at")
  WHERE "no_show_followup_sent" = false AND "no_show_detected_at" IS NOT NULL;
