-- Gate #13 — Post-Visit Review Requests.
--
-- Additive columns on `reservations`: `review_request_sent` dedupes the
-- hourly cron (a diner is asked for a review exactly once per booking) and
-- `review_request_sent_at` records when. Every pre-existing row keeps
-- false/NULL, and the cron's eligibility window (booking within the last
-- ~26 hours) means no backfill noise is possible.
--
-- The gate names `reservations_review_request_idx (review_request_sent,
-- date, time)` — `time` does not exist as a separate column (the booking's
-- full datetime lives in `date`), so the index covers (review_request_sent,
-- date) and the partial WHERE encodes the status part of the predicate.

ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "review_request_sent" boolean DEFAULT false NOT NULL;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "review_request_sent_at" timestamp;

CREATE INDEX IF NOT EXISTS "reservations_review_request_idx"
  ON "reservations" ("review_request_sent", "date")
  WHERE status IN ('confirmed', 'completed') AND review_request_sent = false;
