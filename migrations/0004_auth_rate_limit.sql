-- Better Auth's database-backed rate limiter keeps brute-force protection
-- consistent across Cloudflare Worker isolates.
CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL
);
