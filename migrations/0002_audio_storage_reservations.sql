CREATE TABLE IF NOT EXISTS audio_storage_reservations (
  id TEXT PRIMARY KEY,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  client_fingerprint TEXT,
  purpose TEXT NOT NULL DEFAULT 'submission'
    CHECK (purpose IN ('submission', 'catalog_import')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS audio_storage_reservations_fingerprint
  ON audio_storage_reservations (client_fingerprint, purpose, created_at);
