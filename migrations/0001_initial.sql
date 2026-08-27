PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS mixtapes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  catalog TEXT NOT NULL UNIQUE,
  side TEXT NOT NULL DEFAULT 'A',
  accent TEXT NOT NULL,
  accent2 TEXT NOT NULL,
  ink TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  mixtape_id TEXT NOT NULL REFERENCES mixtapes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  credit TEXT NOT NULL DEFAULT 'Crash Beats',
  featured_artist TEXT,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  byte_size INTEGER,
  duration_seconds REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS tracks_mixtape_published_order
  ON tracks (mixtape_id, is_published, sort_order);

CREATE INDEX IF NOT EXISTS tracks_featured_artist
  ON tracks (featured_artist, is_published);

CREATE TABLE IF NOT EXISTS artist_submissions (
  id TEXT PRIMARY KEY,
  artist_name TEXT NOT NULL,
  instagram_url TEXT NOT NULL,
  spotify_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'featured', 'declined')),
  sheet_sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sheet_sync_status IN ('pending', 'synced', 'failed')),
  sheet_sync_attempts INTEGER NOT NULL DEFAULT 0,
  sheet_synced_at TEXT,
  sheet_sync_error TEXT,
  client_fingerprint TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS submissions_created_at
  ON artist_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS submissions_sheet_sync
  ON artist_submissions (sheet_sync_status, sheet_sync_attempts, created_at);

CREATE TABLE IF NOT EXISTS submission_tracks (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES artist_submissions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  byte_size INTEGER NOT NULL,
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS submission_tracks_submission
  ON submission_tracks (submission_id, is_published, created_at);
