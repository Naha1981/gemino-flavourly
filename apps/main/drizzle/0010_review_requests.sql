ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_request_sent boolean DEFAULT false NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_request_sent_at timestamp;
CREATE INDEX IF NOT EXISTS reservations_review_request_idx ON reservations (review_request_sent, date);