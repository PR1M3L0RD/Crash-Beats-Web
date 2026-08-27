import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'
import { chromium } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const qaUrl = 'http://127.0.0.1:4175/'
const fixtureProcess = spawnSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'sine=frequency=80:sample_rate=44100:duration=12',
  '-codec:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1',
], { maxBuffer: 2 * 1024 * 1024, windowsHide: true })

if (fixtureProcess.status !== 0 || !fixtureProcess.stdout.length) {
  throw new Error(`Could not synthesize the visual QA audio fixture: ${fixtureProcess.stderr}`)
}

const audioFixture = fixtureProcess.stdout
const weeklyFixture = {
  artist: {
    name: 'Big Slay',
    socialHref: 'https://instagram.com/savi.global',
    musicHref: 'https://open.spotify.com/artist/3FdfHmxbjiS7KtxqvZ5j42',
    scheduleIndex: 0,
  },
  mixtape: {
    id: 'crash-weekly',
    title: 'Crash Weekly',
    subtitle: 'Artist of the week · Big Slay',
    catalog: 'CW-001',
    side: 'W',
    accent: '#ff4ecb',
    accent2: '#53f4ff',
    ink: '#241039',
    isWeekly: true,
    artist: 'Big Slay',
    tracks: ['Eugene', 'Art Basel', 'MAC', 'Spaced Out'].map((title, index) => ({
      id: `weekly-${index + 1}`,
      title,
      credit: 'Big Slay',
      src: `/api/audio/weekly-${index + 1}`,
    })),
    socials: [
      { id: 'instagram', label: 'Big Slay on Instagram', shortLabel: 'IG', href: 'https://instagram.com/savi.global' },
      { id: 'spotify', label: 'Big Slay on Spotify', shortLabel: 'SP', href: 'https://open.spotify.com/artist/3FdfHmxbjiS7KtxqvZ5j42' },
    ],
  },
}
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate))

if (!executablePath) {
  throw new Error('Visual QA requires Chrome, Edge, or CHROME_PATH to be available.')
}

const server = spawn(
  process.execPath,
  [
    path.join(projectRoot, 'node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    '4175',
    '--strictPort',
  ],
  { cwd: projectRoot, stdio: 'ignore' },
)
process.once('exit', () => server.kill())

let serverReady = false
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(qaUrl)
    if (response.ok) {
      serverReady = true
      break
    }
  } catch {
    // Vite is still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 125))
}

if (!serverReady) {
  throw new Error('The visual QA server did not start.')
}

const browser = await chromium.launch({ executablePath, headless: true })
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'small-phone', width: 320, height: 568 },
  { name: 'short-phone', width: 320, height: 480 },
  { name: 'landscape-phone', width: 844, height: 390 },
]

const results = []

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport })
  const pageErrors = []
  let submittedForm = null
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })
  await page.route('**/api/catalog', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"mixtapes":[]}' }),
  )
  await page.route('**/api/weekly', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(weeklyFixture),
    }),
  )
  await page.route('**/api/audio/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/mpeg', body: audioFixture }),
  )
  await page.route('**/api/submissions', (route) => {
    const request = route.request()
    const body = request.postDataBuffer()
    submittedForm = {
      method: request.method(),
      multipart: request.headers()['content-type']?.startsWith('multipart/form-data; boundary='),
      artist: body?.includes('QA Artist'),
      instagram: body?.includes('https://instagram.com/qa.artist'),
      spotify: body?.includes('https://open.spotify.com/artist/qaartist'),
      song: body?.includes('qa-track.mp3'),
      rights: body?.includes('rightsConfirmed'),
      turnstile: body?.includes('visual-qa-token'),
    }
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: '{"ok":true,"submissionId":"123e4567-e89b-42d3-a456-426614174000"}',
    })
  })
  await page.route('**/turnstile/v0/api.js*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.turnstile={render:function(el,options){el.textContent='Security check ready';el.dataset.turnstileSize=options.size;el.style.width=options.size==='compact'?'150px':options.size==='flexible'?'100%':'300px';setTimeout(function(){options.callback('visual-qa-token')},0);return 'visual-qa'},remove:function(){},reset:function(){}};`,
    }),
  )
  await page.goto(qaUrl, { waitUntil: 'networkidle' })

  const layout = await page.evaluate(() => {
    const boombox = document.querySelector('.boombox')?.getBoundingClientRect()
    const tapes = [...document.querySelectorAll('.mixtape')].map((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    })
    const displayTextFits = [
      ...document.querySelectorAll(
        '.pixel-display__topline, .pixel-display__title, .pixel-display__credit, .pixel-display__flags, .time-code',
      ),
    ].every((element) => element.scrollHeight <= element.clientHeight + 1)

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bodyOverflow: {
        width: document.documentElement.scrollWidth - window.innerWidth,
        height: document.documentElement.scrollHeight - window.innerHeight,
      },
      boombox: boombox
        ? { left: boombox.left, right: boombox.right, top: boombox.top, bottom: boombox.bottom }
        : null,
      tapes,
      displayTextFits,
    }
  })

  let playback = null
  let mobileMotion = null
  let narrowForm = null
  if (viewport.name === 'desktop') {
    await page.locator('.mixtape:not(.mixtape--weekly)').first().click()
    await page.waitForTimeout(160)
    const tapeVisibleDuringFlight = (await page.locator('.loaded-tape').count()) > 0
    await page.waitForTimeout(300)
    const cassetteFaceVisibleDuringFlight = await page
      .locator('.flying-tape__face')
      .evaluate((element) => Number(getComputedStyle(element).opacity) > 0.5)
    await page.waitForTimeout(840)
    const initialTitle = await page.locator('.pixel-display__title').textContent()

    await page.getByRole('button', { name: 'Pause' }).click()
    const pausedAfterPause = await page.locator('audio').evaluate((audio) => audio.paused)

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await page.waitForTimeout(180)
    const playingAfterPlay = await page.locator('audio').evaluate((audio) => !audio.paused)

    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.waitForTimeout(180)
    const titleAfterNext = await page.locator('.pixel-display__title').textContent()

    await page.getByRole('button', { name: 'Shuffle' }).click()
    const shuffleOn = await page.getByRole('button', { name: 'Shuffle' }).getAttribute('aria-pressed')

    playback = await page.evaluate(() => {
      const audio = document.querySelector('audio')
      return {
        srcLoaded: Boolean(audio?.currentSrc),
        paused: audio?.paused,
        currentTime: audio?.currentTime,
        title: document.querySelector('.pixel-display__title')?.textContent?.trim(),
        flyingTapeFinished: !document.querySelector('.flying-tape'),
        deckTapeLoaded: Boolean(document.querySelector('.loaded-tape')),
      }
    })
    playback.tapeVisibleDuringFlight = tapeVisibleDuringFlight
    playback.cassetteFaceVisibleDuringFlight = cassetteFaceVisibleDuringFlight
    playback.initialTitle = initialTitle?.trim()
    playback.pausedAfterPause = pausedAfterPause
    playback.playingAfterPlay = playingAfterPlay
    playback.titleAfterNext = titleAfterNext?.trim()
    playback.shuffleOn = shuffleOn === 'true'

    await page.getByRole('button', { name: 'Next mixtapes' }).click()
    playback.secondArchivePage =
      (await page.getByRole('button', { name: /Play Boom Bap Broadcast/ }).count()) === 1 &&
      (await page.getByRole('button', { name: /Play Aftershock Trap/ }).count()) === 1
  }

  if (viewport.name === 'phone') {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('.mixtape--weekly').click()
    await page.waitForTimeout(90)
    const flightVisible = (await page.locator('.flying-tape').count()) === 1
    await page.waitForTimeout(650)
    const flightFinished = (await page.locator('.flying-tape').count()) === 0
    const deckLoaded = (await page.locator('.loaded-tape').count()) === 1

    let speakerPulseVisible = false
    try {
      await page.waitForFunction(
        () => {
          const transform = getComputedStyle(document.querySelector('.speaker__cone')).transform
          const scale = Number(transform.match(/^matrix\(([^,]+)/)?.[1] ?? 1)
          return scale > 1.045
        },
        undefined,
        { timeout: 4000 },
      )
      speakerPulseVisible = true
    } catch {
      // The assertion below reports a useful viewport-specific failure.
    }

    const weeklyEdition = await page.evaluate(() => ({
      active: document.querySelector('.boombox')?.classList.contains('is-weekly'),
      artist: document.querySelector('.weekly-tuner strong')?.textContent?.trim(),
      tracks: document.querySelector('.pixel-display__topline span:last-child')?.textContent?.trim(),
      socialLinks: [...document.querySelectorAll('.source-panel--weekly a')].map((link) => link.href),
    }))

    await page.getByRole('button', { name: 'Apply to be featured on Crash Weekly' }).click()
    await page.getByRole('heading', { name: /Put your sound on the shelf/i }).waitFor()
    const formPage = await page.evaluate(() => {
      const page = document.querySelector('.weekly-form-page')
      const rect = page?.getBoundingClientRect()
      return {
        visible: Boolean(page),
        fitsViewport: Boolean(rect && rect.left === 0 && rect.right === innerWidth && rect.top === 0 && rect.bottom === innerHeight),
        fields: document.querySelectorAll('.weekly-form input').length,
        turnstileReady: Boolean(document.querySelector('.weekly-form__field--turnstile')?.textContent?.includes('ready')),
      }
    })
    await page.getByLabel('Artist name').fill('QA Artist')
    await page.getByLabel('Instagram profile URL').fill('https://instagram.com/qa.artist')
    await page.getByLabel('Spotify artist URL').fill('https://open.spotify.com/artist/qaartist')
    await page.getByLabel('Track uploads').setInputFiles({
      name: 'qa-track.mp3',
      mimeType: 'audio/mpeg',
      buffer: audioFixture,
    })
    await page.getByLabel(/I own these tracks/).check()
    await page.getByRole('button', { name: 'Submit to Crash Weekly' }).click()
    await page.getByRole('heading', { name: /Your tape is in the queue/i }).waitFor()
    formPage.submissionSent = Object.values(submittedForm || {}).every(Boolean)
    await page.getByRole('button', { name: 'Return to the player' }).click()

    mobileMotion = {
      flightVisible,
      flightFinished,
      deckLoaded,
      speakerPulseVisible,
      weeklyEdition,
      formPage,
    }
  }

  if (viewport.width === 320) {
    await page.goto(`${qaUrl}weekly/apply`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: /Put your sound on the shelf/i }).waitFor()
    await page.waitForFunction(() => document.querySelector('[data-turnstile-size]'))
    narrowForm = await page.evaluate(() => {
      const formPage = document.querySelector('.weekly-form-page')
      const widget = document.querySelector('[data-turnstile-size]')
      const formRect = formPage?.getBoundingClientRect()
      const widgetRect = widget?.getBoundingClientRect()
      return {
        pageFits: document.documentElement.scrollWidth === innerWidth,
        formFits: Boolean(formRect && formRect.left >= 0 && formRect.right <= innerWidth),
        widgetFits: Boolean(widgetRect && widgetRect.left >= 0 && widgetRect.right <= innerWidth),
        widgetSize: widget?.dataset.turnstileSize,
      }
    })
  }

  const screenshot = path.join(os.tmpdir(), `crash-beats-${viewport.name}-qa.png`)
  await page.screenshot({ path: screenshot })
  results.push({ name: viewport.name, screenshot, pageErrors, layout, playback, mobileMotion, narrowForm })
  await page.close()
}

await browser.close()
server.kill()
console.log(JSON.stringify(results, null, 2))

const failures = results.flatMap((result) => {
  const messages = [...result.pageErrors]
  const { layout } = result
  if (layout.bodyOverflow.width !== 0 || layout.bodyOverflow.height !== 0) {
    messages.push('Page overflows its viewport')
  }
  if (layout.boombox.left < 0 || layout.boombox.right > layout.viewport.width) {
    messages.push('Boombox extends beyond the viewport')
  }
  if (layout.tapes.some((tape) => tape.left < 0 || tape.right > layout.viewport.width)) {
    messages.push('A mixtape extends beyond the viewport')
  }
  if (!layout.displayTextFits) {
    messages.push('Pixel display text is vertically clipped')
  }
  if (
    result.playback &&
    (!result.playback.srcLoaded ||
      result.playback.initialTitle !== 'You Are Mine' ||
      !result.playback.pausedAfterPause ||
      !result.playback.playingAfterPlay ||
      result.playback.titleAfterNext !== 'Somebody' ||
      !result.playback.shuffleOn ||
      !result.playback.secondArchivePage ||
      !result.playback.flyingTapeFinished ||
      !result.playback.deckTapeLoaded ||
      result.playback.tapeVisibleDuringFlight ||
      !result.playback.cassetteFaceVisibleDuringFlight)
  ) {
    messages.push('A playback interaction did not reach the expected state')
  }
  if (
    result.mobileMotion &&
    (!result.mobileMotion.flightVisible ||
      !result.mobileMotion.flightFinished ||
      !result.mobileMotion.deckLoaded ||
      !result.mobileMotion.speakerPulseVisible ||
      !result.mobileMotion.weeklyEdition.active ||
      result.mobileMotion.weeklyEdition.artist !== 'Big Slay' ||
      result.mobileMotion.weeklyEdition.tracks !== '01/04' ||
      result.mobileMotion.weeklyEdition.socialLinks.length !== 2 ||
      !result.mobileMotion.formPage.visible ||
      !result.mobileMotion.formPage.fitsViewport ||
      result.mobileMotion.formPage.fields < 6 ||
      !result.mobileMotion.formPage.turnstileReady ||
      !result.mobileMotion.formPage.submissionSent)
  ) {
    messages.push('Reduced-motion mobile animation or speaker pulse was not visible')
  }
  if (
    result.narrowForm &&
    (!result.narrowForm.pageFits ||
      !result.narrowForm.formFits ||
      !result.narrowForm.widgetFits ||
      result.narrowForm.widgetSize !== 'compact')
  ) {
    messages.push('The weekly form or security check overflows a 320px viewport')
  }
  return messages.map((message) => `${result.name}: ${message}`)
})

if (failures.length) {
  console.error(`Visual QA failed:\n${failures.join('\n')}`)
  process.exitCode = 1
}
