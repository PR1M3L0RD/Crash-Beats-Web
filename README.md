# Crash Beats Tape Deck

A retro boombox player with nine Crash Beats mixtapes, a separately styled Crash Weekly artist feature, account-linked download credits, and a public artist-submission page.

## Architecture

- D1 stores Better Auth accounts and sessions, the append-only credit ledger, mixtape and track data, weekly submissions, and private upload metadata.
- The private `crash-beats-audio` R2 bucket stores audio; browsers can only stream D1-published tracks through `/api/audio/:id`.
- Catalog audio uses immutable caching and HTTP byte ranges. Pending submission audio is never public.
- Signed-in listeners receive two download credits the first time they open Crash Weekly during each Monday-to-Monday UTC week. Each published non-Weekly catalog download costs one credit.
- New uploads use atomic D1 reservations against a hard 9,000,000,000-byte ceiling, leaving at least 1 GB below the 10 GB free R2 allowance.
- The Vite build contains no MP3 files.

## Run and verify

```bash
npm install
npm test
npm run build
npm run qa:visual
npx wrangler deploy --dry-run
```

`npm run dev` is suitable for isolated UI work. For the complete Worker/API stack, apply the local migrations, import a local audio catalog, and run Wrangler:

```bash
npm run db:migrate:local
npm run audio:import -- --local
npm run dev:worker
```

Copy `.dev.vars.example` to `.dev.vars` and replace its placeholders before running the complete local Worker stack. `.dev.vars` is ignored by Git; never commit real credentials.

Visual QA covers desktop, four phone orientations/sizes, transport playback, tape insertion, mobile speaker motion, the complete scrollable archive shelf, configured Google sign-in controls, weekly reward/focus behavior, one-credit downloads, and the responsive submission form.

## Add music

Mixtape presentation and source-file mappings live in `src/data/mixtapes.js`. After adding definitions/files, run migrations first, then explicitly choose the import target:

```bash
npm run db:migrate:remote
npm run audio:import -- --remote
```

The importer converts WAV sources to 192 kbps MP3, uploads at limited concurrency, upserts D1 metadata, reserves storage atomically, and rolls back new objects after a failed import. Source audio and ZIP archives are intentionally ignored by Git and can be removed locally after every imported object has been verified in R2.

## Accounts and download credits

Accounts use Better Auth with the existing D1 database. Migration `0003_auth_and_credits.sql` creates the Better Auth tables and append-only credit ledger; `0004_auth_rate_limit.sql` adds shared brute-force protection for Worker isolates; `0006_account_credit_identity.sql` enables account deletion and preserves weekly reward claims by email identity. Apply all migrations in order before testing accounts locally or deploying them:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

The following configuration is required:

- `BETTER_AUTH_SECRET`: a private, random value containing at least 32 characters. Use a different value in each environment.
- `BETTER_AUTH_URL`: the public origin of that environment, without `/api/auth`. Production uses `https://crash-beats.com`; use `http://127.0.0.1:8787` locally.
- `BETTER_AUTH_TRUSTED_ORIGINS`: optional comma-separated additional browser origins. The standard local full-stack flow does not need it because Wrangler serves the UI and API from `http://127.0.0.1:8787`.

Set production secrets through Wrangler rather than putting them in `wrangler.jsonc` or source control:

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Email/password registration and sign-in are always enabled. New accounts require a display name, a valid email address, and a password of at least eight characters. Accounts become usable immediately after registration. Optional Resend confirmation codes let signed-in users verify their email; password-reset email and magic-link delivery are not configured.

An unverified account can earn and use its own credits, but cannot read, inherit, or spend credit history belonging to an earlier account with the same email. Restoring that history requires verified email ownership, through a confirmation code or a Google-created account with verified email. An existing unverified password account is deliberately not auto-linked to Google.

### Email confirmation with Resend

Verify a sending domain in Resend and create a sending API key scoped to that domain. Configure these two Worker secrets with Wrangler's interactive prompts (do not commit the key):

```powershell
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put AUTH_EMAIL_FROM
```

For `AUTH_EMAIL_FROM`, use a sender such as `Crash Beats <accounts@crash-beats.com>` after verifying that domain in Resend. Then deploy the Worker and frontend together with `npm run deploy`. For local development, fill the corresponding fields in ignored `.dev.vars`. The confirmation controls appear only when both settings are present. No new migration is needed: Better Auth uses the existing `verification` table.

Open the account window, choose **Send confirmation code**, and enter the six-digit code. Codes expire after ten minutes, are stored as hashes, and are consumed on success. A resend replaces the previous code. Five incorrect attempts invalidate a code; sending is limited by email address to one request per minute bucket and five per hour bucket, with an additional five verification requests per minute bucket and Better Auth's IP rate limits. These email-address limits survive account deletion. The browser also applies a 60-second resend cooldown.

The server uses the signed-in user's email, ignoring any address or code-purpose supplied by the browser. Public OTP sign-in, password reset, email change, and code-retrieval endpoints remain unavailable. Confirming an email refreshes the saved balance without claiming a reward or resetting the weekly claim date. Existing unverified accounts can confirm from their account window; registration remains usable if delivery is not configured.

Run `npm test` and `npm run qa:email` to check the code lifecycle and desktop/mobile confirmation flow. Automated tests mock Resend and send no real email. Before enabling this in production, verify a real message arrives from the configured sender and confirm the code on a test account. [Resend sender setup](https://resend.com/docs/knowledge-base/how-do-i-create-an-email-address-or-sender-in-resend) explains the required verified domain.

Google sign-in is optional and its button is shown only when both the client ID and client secret are configured. Register this exact OAuth redirect URL with Google, replacing the origin for each environment:

```text
https://example.com/api/auth/callback/google
```

For local provider testing, the callback is `http://127.0.0.1:8787/api/auth/callback/google`.

The production Google callback is `https://crash-beats.com/api/auth/callback/google`. Add both `https://crash-beats.com` as an authorized JavaScript origin and that full callback URL as an authorized redirect URI in the Google OAuth client.

Credits belong to the signed-in account and are calculated from the ledger. Opening the Crash Weekly cassette while signed in claims exactly two credits for the current week, whose boundary is Monday at 00:00 UTC. Reloading or reopening Weekly during the same week does not grant credits again. Opening Weekly while signed out does not bank a claim; sign in and open Weekly to receive it.

Downloading a published Crash Beats catalog track through the regular boombox view costs one credit. A listener must be signed in and have a positive balance. Crash Weekly hides the download control, and submission-only Weekly tracks are not present in the downloadable catalog. Download requests carry a short-lived idempotency key, so an automatic retry can reuse the original charge if the response stream is interrupted. The normal `/api/audio/:id` playback endpoints remain public so visitors can listen without accounts. Because a public stream necessarily sends audio bytes to the browser, the credit-gated download control is a convenience and entitlement feature, not DRM and not a guarantee against saving a stream.

## Crash Weekly submissions

Follow [the Google Apps Script setup](google-apps-script/README.md) while signed into `ewoodthomas@gmail.com`. It keeps the source Sheet restricted, reads the Featured schedule through an owner-authorized endpoint, and appends form entries to `Sheet1!I:M`. Apply `npm run db:migrate:remote` before deploying the new optional-link columns.

## Deploy

See [the security review](SECURITY_REVIEW.md) for verified fixes, remaining operational work, and deployment checks. Private submission attachment URLs are signed for one track and expire after 15 minutes. The existing Apps Script fetches them immediately; each sync retry creates fresh URLs. No Apps Script change or new database migration is required for this hardening update.

```bash
npm run deploy
```
