-- Missing engines/features (Gate 4)
-- Pre-existing rows keep defaults; all statements additive.

-- Birthday rewards: customer birthday stored as MM-DD on the contact.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS birthday text;
