PRAGMA foreign_keys = ON;

-- Better Auth 1.7.2 core schema for the built-in SQLite/D1 adapter.
CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expiresAt" DATE NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "issuer" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" DATE,
  "refreshTokenExpiresAt" DATE,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATE NOT NULL,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_uidx"
  ON "account" ("issuer", "accountId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

-- The ledger is the source of truth. Its constraints encode every currently
-- valid way credits can move so a client cannot invent a different amount.
CREATE TABLE IF NOT EXISTS credit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"("id"),
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

CREATE INDEX IF NOT EXISTS credit_events_user_created
  ON credit_events (user_id, created_at);

CREATE TRIGGER IF NOT EXISTS credit_events_prevent_negative_balance
BEFORE INSERT ON credit_events
WHEN NEW.delta < 0 AND (
  COALESCE((SELECT SUM(delta) FROM credit_events WHERE user_id = NEW.user_id), 0) + NEW.delta
) < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_credits');
END;

CREATE TRIGGER IF NOT EXISTS credit_events_prevent_update
BEFORE UPDATE ON credit_events
BEGIN
  SELECT RAISE(ABORT, 'credit_events_are_append_only');
END;

CREATE TRIGGER IF NOT EXISTS credit_events_prevent_delete
BEFORE DELETE ON credit_events
BEGIN
  SELECT RAISE(ABORT, 'credit_events_are_append_only');
END;
