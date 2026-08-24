-- Gate #4: no-show monitoring.
--
-- All four columns are additive and nullable/defaulted, so this is safe to
-- run against a live table: pre-existing rows keep no_show_detected_at NULL
-- and are never seen as no-shows. Detection flags live alongside `status`
-- on purpose — flipping a booking to 'no_show' remains a staff decision,
-- because a customer can still walk in after the grace period.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "no_show_detected" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "no_show_detected_at" timestamp;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "no_show_followup_sent" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "no_show_followup_sent_at" timestamp;
--> statement-breakpoint
-- Partial index for the 30-minute detection scan: only confirmed bookings
-- that have not been flagged yet can ever match the cron's WHERE clause.
CREATE INDEX IF NOT EXISTS "reservations_no_show_detection_idx"
  ON "reservations" ("date")
  WHERE "status" = 'confirmed' AND "no_show_detected" = false;
--> statement-breakpoint
-- Partial index for the follow-up scan in the same run: detected bookings
-- whose rebooking offer has not been sent yet, ordered by detection time.
CREATE INDEX IF NOT EXISTS "reservations_no_show_followup_idx"
  ON "reservations" ("no_show_detected_at")
  WHERE "no_show_followup_sent" = false AND "no_show_detected_at" IS NOT NULL;
