PRAGMA foreign_keys = ON;

ALTER TABLE artist_submissions ADD COLUMN apple_music_url TEXT NOT NULL DEFAULT '';
ALTER TABLE artist_submissions ADD COLUMN soundcloud_url TEXT NOT NULL DEFAULT '';
