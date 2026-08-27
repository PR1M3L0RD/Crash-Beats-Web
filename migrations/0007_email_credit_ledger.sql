-- Credit history belongs to the verified email identity, not a deletable user
-- row, so account recreation can restore the same balance.
DROP TRIGGER IF EXISTS credit_events_prevent_negative_balance;
DROP TRIGGER IF EXISTS credit_events_prevent_update;

CREATE TABLE credit_events_with_email (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('weekly_grant', 'download')),
  reference_key TEXT NOT NULL,
  track_id TEXT REFERENCES tracks(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (email, kind, reference_key),
  CHECK (
    (kind = 'weekly_grant' AND delta = 2 AND track_id IS NULL) OR
    (kind = 'download' AND delta = -1 AND track_id IS NOT NULL)
  )
);

INSERT INTO credit_events_with_email
  (id, user_id, email, delta, kind, reference_key, track_id, created_at)
SELECT ce.id, ce.user_id, lower(u.email), ce.delta, ce.kind, ce.reference_key, ce.track_id, ce.created_at
FROM credit_events ce
JOIN "user" u ON u.id = ce.user_id;

DROP TABLE credit_events;
ALTER TABLE credit_events_with_email RENAME TO credit_events;

CREATE INDEX IF NOT EXISTS credit_events_email_created
  ON credit_events (email, created_at);

CREATE TRIGGER credit_events_prevent_negative_balance
BEFORE INSERT ON credit_events
WHEN NEW.delta < 0 AND (
  COALESCE((SELECT SUM(delta) FROM credit_events WHERE email = NEW.email), 0) + NEW.delta
) < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_credits');
END;

CREATE TRIGGER credit_events_prevent_update
BEFORE UPDATE ON credit_events
BEGIN
  SELECT RAISE(ABORT, 'credit_events_are_append_only');
END;