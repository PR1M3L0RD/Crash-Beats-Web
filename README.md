# Crash Beats Tape Deck

A single-screen retro boombox player built for Crash Beats. The 52 supplied tracks are curated into five mixtapes that load directly from the wooden shelf.

## Run locally

```bash
npm install
npm run dev
```

## Checks

```bash
npm test
npm run build
npm run qa:visual
```

`qa:visual` starts an isolated local server, checks the layout at four desktop/mobile viewport sizes, exercises the core transport controls, and saves screenshots to the operating system's temporary directory. It uses an installed Chrome/Edge browser or the `CHROME_PATH` environment variable.

## Library organization

Playlist names, colors, credits, social destinations, and track order live in `src/data/mixtapes.js`. The player resolves the existing `reg songs/` and `featured songs/` MP3 files at build time, while the browser requests only the active song during playback.

The speaker pulse uses live low-frequency analysis through the Web Audio API. Button clicks are synthesized in-browser, so no additional sound asset is required.
