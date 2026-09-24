PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS store_beats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  preview_object_key TEXT NOT NULL UNIQUE,
  preview_byte_size INTEGER NOT NULL CHECK (preview_byte_size > 0),
  full_object_key TEXT NOT NULL UNIQUE,
  full_filename TEXT NOT NULL,
  full_mime_type TEXT NOT NULL CHECK (full_mime_type IN ('audio/mpeg', 'audio/wav')),
  full_byte_size INTEGER NOT NULL CHECK (full_byte_size > 0),
  price_cents INTEGER CHECK (price_cents BETWEEN 100 AND 1000000),
  license_name TEXT NOT NULL DEFAULT '',
  license_terms TEXT NOT NULL DEFAULT '',
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (is_published = 0 OR (price_cents IS NOT NULL AND length(trim(license_name)) > 0 AND length(trim(license_terms)) > 0))
);

CREATE INDEX IF NOT EXISTS store_beats_published_order ON store_beats (is_published, sort_order);

CREATE TABLE IF NOT EXISTS beat_orders (
  id TEXT PRIMARY KEY,
  beat_id TEXT NOT NULL REFERENCES store_beats(id),
  buyer_email TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  license_name TEXT NOT NULL,
  license_terms TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS beat_orders_email_status ON beat_orders (buyer_email, status, created_at);
