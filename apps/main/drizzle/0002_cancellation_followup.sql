-- Gate #3: cancellation follow-up.
--
-- All three columns are additive and nullable/defaulted, so this is safe to
-- run against a live table: pre-existing rows keep cancelled_at NULL and are
-- never followed up (a guessed cancellation time would message customers
-- about cancellations nobody remembers making).
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "cancellation_followup_sent" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "cancellation_followup_sent_at" timestamp;
--> statement-breakpoint
-- Partial index for the 6-hourly follow-up scan: only rows that could ever
-- match the cron's WHERE clause are indexed.
CREATE INDEX IF NOT EXISTS "reservations_cancellation_followup_idx"
  ON "reservations" ("cancelled_at")
  WHERE "status" = 'cancelled' AND "cancellation_followup_sent" = false;
