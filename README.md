# Crash Beats Tape Deck

A retro boombox player with nine Crash Beats mixtapes, a separately styled Crash Weekly artist feature, and a public artist-submission page.

## Architecture

- D1 stores mixtape, track, weekly-submission, and private upload metadata.
- The private `crash-beats-audio` R2 bucket stores audio; browsers can only stream D1-published tracks through `/api/audio/:id`.
- Catalog audio uses immutable caching and HTTP byte ranges. Pending submission audio is never public.
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

Visual QA covers desktop, four phone orientations/sizes, transport playback, tape insertion, mobile speaker motion, both archive shelf pages, weekly mode, and the responsive submission form.

## Add music

Mixtape presentation and source-file mappings live in `src/data/mixtapes.js`. After adding definitions/files, run migrations first, then explicitly choose the import target:

```bash
npm run db:migrate:remote
npm run audio:import -- --remote
```

The importer converts WAV sources to 192 kbps MP3, uploads at limited concurrency, upserts D1 metadata, reserves storage atomically, and rolls back new objects after a failed import. Source audio and ZIP archives are intentionally ignored by Git and can be removed locally after every imported object has been verified in R2.

## Crash Weekly submissions

Follow [the Google Apps Script setup](google-apps-script/README.md) while signed into `ewoodthomas@gmail.com`. It keeps the source Sheet restricted, reads the Featured schedule through an owner-authorized endpoint, and appends form entries to `Sheet1!I:K`.

## Deploy

```bash
npm run deploy
```
