-- Let Better Auth remove a user's personal ledger rows while keeping the
-- email-based reward history independent of the user row.
DROP TRIGGER IF EXISTS credit_events_prevent_negative_balance;
DROP TRIGGER IF EXISTS credit_events_prevent_update;
DROP TRIGGER IF EXISTS credit_events_prevent_delete;

CREATE TABLE credit_events_with_cascade (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('weekly_grant', 'download')),
  reference_key TEXT NOT NULL,
  track_id TEXT REFERENCES tracks(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, kind, reference_key),
  CHECK (
    (kind = 'weekly_grant' AND delta = 2 AND track_id IS NULL) OR
    (kind = 'download' AND delta = -1 AND track_id IS NOT NULL)
  )
);

INSERT INTO credit_events_with_cascade
  (id, user_id, delta, kind, reference_key, track_id, created_at)
SELECT id, user_id, delta, kind, reference_key, track_id, created_at
FROM credit_events;

DROP TABLE credit_events;
ALTER TABLE credit_events_with_cascade RENAME TO credit_events;

CREATE INDEX IF NOT EXISTS credit_events_user_created
  ON credit_events (user_id, created_at);

CREATE TRIGGER credit_events_prevent_negative_balance
BEFORE INSERT ON credit_events
WHEN NEW.delta < 0 AND (
  COALESCE((SELECT SUM(delta) FROM credit_events WHERE user_id = NEW.user_id), 0) + NEW.delta
) < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_credits');
END;

CREATE TRIGGER credit_events_prevent_update
BEFORE UPDATE ON credit_events
BEGIN
  SELECT RAISE(ABORT, 'credit_events_are_append_only');
END;

-- Keep weekly reward claims tied to the listener's email identity so deleting
-- and recreating an account cannot replay a claim for the same week.
CREATE TABLE IF NOT EXISTS account_credit_claims (
  email TEXT NOT NULL,
  week_key TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (email, week_key)
);