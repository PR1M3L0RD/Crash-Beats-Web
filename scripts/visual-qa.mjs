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
const weeklyScheduleNames = [
  'Past Pulse',
  'Tape Ghost',
  'Night Archive',
  'Lowlight',
  'Big Slay',
  'Future Echo',
  'Neon Guest',
  'Sunroom',
  'Velvet FM',
  'Static Bloom',
  'Last Transmission',
  'Afterglow',
]
const weeklyFixture = {
  artist: {
    name: 'Big Slay',
    socialHref: 'https://instagram.com/savi.global',
    musicHref: 'https://open.spotify.com/artist/3FdfHmxbjiS7KtxqvZ5j42',
    scheduleIndex: 4,
  },
  schedule: weeklyScheduleNames.map((name, scheduleIndex) => ({
    name,
    scheduleIndex,
    status: scheduleIndex < 4 ? 'past' : scheduleIndex === 4 ? 'current' : 'future',
  })),
  currentScheduleIndex: 4,
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
  let authenticated = viewport.name === 'desktop' || viewport.name === 'phone'
  let credits = 2
  let weeklyClaimed = false
  let weeklyClaimRequests = 0
  let downloadedTrackId = ''
  let downloadRequestKey = ''
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })
  await page.route('**/api/catalog', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"mixtapes":[]}' }),
  )
  await page.route('**/api/weekly*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(weeklyFixture),
    }),
  )
  await page.route('**/api/auth/**', (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/auth/config') {
      const socialProviders = viewport.name === 'small-phone'
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          email: true,
          providers: { google: socialProviders },
        }),
      })
    }
    if (pathname === '/api/auth/get-session') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: authenticated
          ? JSON.stringify({
            session: { id: 'visual-session', userId: 'visual-user', expiresAt: '2099-01-01T00:00:00.000Z' },
            user: { id: 'visual-user', name: 'Visual Listener', email: 'visual@example.com' },
          })
          : 'null',
      })
    }
    if (pathname === '/api/auth/sign-up/email') {
      authenticated = true
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'visual-token',
          user: { id: 'visual-user', name: 'Visual Listener', email: 'visual@example.com' },
        }),
      })
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Not mocked"}' })
  })
  await page.route('**/api/account', (route) =>
    route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: 'application/json',
      body: authenticated
        ? JSON.stringify({
          user: { id: 'visual-user', name: 'Visual Listener', email: 'visual@example.com' },
          credits,
        })
        : '{"error":"Sign in required"}',
    }),
  )
  await page.route('**/api/credits/weekly-claim', (route) => {
    weeklyClaimRequests += 1
    const awarded = !weeklyClaimed
    if (awarded) credits += 2
    weeklyClaimed = true
    return route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: 'application/json',
      body: authenticated
        ? JSON.stringify({ awarded, amount: awarded ? 2 : 0, credits, weekKey: '2026-08-24' })
        : '{"error":"Sign in required"}',
    })
  })
  await page.route('**/api/download/**', (route) => {
    downloadedTrackId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop())
    downloadRequestKey = route.request().headers()['idempotency-key'] || ''
    credits -= 1
    return route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      headers: {
        'content-disposition': 'attachment; filename="visual-track.mp3"',
        'x-credits-remaining': String(credits),
      },
      body: audioFixture,
    })
  })
  await page.route('**/api/audio/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/mpeg', body: audioFixture }),
  )
  await page.route('**/api/submissions', (route) => {
    const request = route.request()
    const body = request.postDataBuffer()
    const hasField = (name) => body?.includes(`name="${name}"`)
    submittedForm = {
      method: request.method(),
      multipart: request.headers()['content-type']?.startsWith('multipart/form-data; boundary='),
      artistField: hasField('artistName'),
      artist: body?.includes('QA Artist'),
      instagramField: hasField('instagramUrl'),
      spotifyField: hasField('spotifyUrl'),
      appleMusicField: hasField('appleMusicUrl'),
      soundcloudField: hasField('soundcloudUrl'),
      appleMusic: body?.includes('https://music.apple.com/us/artist/qa-artist/123456789'),
      songsField: hasField('songs'),
      song: body?.includes('qa-track.mp3'),
      rightsField: hasField('rightsConfirmed'),
      turnstileField: hasField('turnstileToken'),
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
  let accountModal = null
  let weeklyArtistSchedule = null
  let weeklyHeader = null
  let weeklyNarrow = null
  if (viewport.name === 'small-phone') {
    await page.locator('.account-preset').click()
    await page.getByRole('heading', { name: 'Sign in' }).waitFor()
    const accountScreenshot = path.join(os.tmpdir(), 'crash-beats-account-modal-qa.png')
    await page.screenshot({ path: accountScreenshot })
    accountModal = await page.evaluate(() => {
      const dialog = document.querySelector('.account-modal__dialog')?.getBoundingClientRect()
      return {
        visible: Boolean(dialog),
        fitsViewport: Boolean(dialog && dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight),
        providerButtons: document.querySelectorAll('.account-modal__socials button').length,
        emailFormVisible: Boolean(document.querySelector('.account-modal__form')),
        screenshot: 'crash-beats-account-modal-qa.png',
      }
    })
    await page.getByRole('button', { name: 'Close account dialog' }).click()

    await page.locator('.mixtape--weekly').click()
    await page.locator('.boombox.is-weekly').waitFor()
    accountModal.signedOutWeekly = await page.evaluate(() => ({
      weeklyActive: document.querySelector('.boombox')?.classList.contains('is-weekly'),
      rewardVisible: Boolean(document.querySelector('.weekly-reward-celebration')),
    }))
    accountModal.signedOutWeekly.claimRequests = weeklyClaimRequests

    await page.locator('.account-preset').click()
    await page.getByRole('heading', { name: 'Sign in' }).waitFor()
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Display name').fill('Visual Listener')
    await page.getByLabel('Email').fill('visual@example.com')
    await page.getByLabel('Password').fill('visual-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.locator('.account-modal').waitFor({ state: 'detached' })
    accountModal.afterLogin = await page.evaluate(() => ({
      weeklyActive: document.querySelector('.boombox')?.classList.contains('is-weekly'),
      rewardVisible: Boolean(document.querySelector('.weekly-reward-celebration')),
    }))
    accountModal.afterLogin.claimRequests = weeklyClaimRequests

    await page.locator('.mixtape--weekly').click()
    await page.getByRole('heading', { name: /Two fresh download credits/i }).waitFor()
    accountModal.afterWeeklyVisit = {
      rewardVisible: await page.locator('.weekly-reward-celebration').isVisible(),
      claimRequests: weeklyClaimRequests,
    }
    await page.getByRole('button', { name: 'Back to the boombox' }).click()

    await page.getByRole('button', { name: 'View all weekly artists' }).click()
    await page.getByRole('heading', { name: 'Weekly artists' }).waitFor()
    weeklyNarrow = await page.evaluate(() => {
      const dialog = document.querySelector('.weekly-artists-modal__dialog')?.getBoundingClientRect()
      const presets = document.querySelector('.weekly-header-presets')
      const presetsRect = presets?.getBoundingClientRect()
      const controlsFit = [...(presets?.children || [])].every((control) => {
        const rect = control.getBoundingClientRect()
        return rect.left >= presetsRect.left && rect.right <= presetsRect.right
      })
      return {
        dialogFits: Boolean(dialog && dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight),
        pageFits: document.documentElement.scrollWidth === innerWidth,
        controlCount: presets?.children.length || 0,
        controlsFit,
      }
    })
    const narrowScheduleScreenshot = path.join(os.tmpdir(), 'crash-beats-weekly-artists-320-qa.png')
    await page.screenshot({ path: narrowScheduleScreenshot })
    weeklyNarrow.screenshot = narrowScheduleScreenshot
    await page.getByRole('button', { name: 'Close weekly artist list' }).click()
  }
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

    const archiveEnd = page.getByRole('button', { name: /Play Trap/ })
    await archiveEnd.scrollIntoViewIfNeeded()
    playback.archiveEndReachable = await archiveEnd.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth
    })

    await page.getByRole('button', { name: /Download Mama for 1 credit/ }).click()
    await page.getByText(/Mama saved\. 1 download credit left\./).waitFor()
    playback.download = {
      trackId: downloadedTrackId,
      requestKey: downloadRequestKey,
      credits,
      accountLabel: await page.locator('.account-preset').getAttribute('aria-label'),
    }

    await page.locator('.mixtape--weekly').click()
    await page.locator('.boombox.is-weekly').waitFor()
    await page.getByRole('heading', { name: /Two fresh download credits/i }).waitFor()
    await page.getByRole('button', { name: 'Back to the boombox' }).click()
    weeklyHeader = await page.evaluate(() => {
      const presets = document.querySelector('.weekly-header-presets')
      const rect = presets?.getBoundingClientRect()
      const controls = [...(presets?.children || [])]
      return {
        controlCount: controls.length,
        controlsFit: controls.every((control) => {
          const controlRect = control.getBoundingClientRect()
          return controlRect.left >= rect.left && controlRect.right <= rect.right
        }),
        visibleLabels: controls.map((control) => {
          const label = control.querySelector('span')
          return label && getComputedStyle(label).display !== 'none' ? label.textContent.trim() : ''
        }),
      }
    })
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

    await page.getByRole('heading', { name: /Two fresh download credits/i }).waitFor()
    await page.waitForFunction(() => document.activeElement?.classList.contains('weekly-reward-celebration__dismiss'))
    await page.keyboard.press('Tab')
    const weeklyReward = {
      visible: await page.locator('.weekly-reward-celebration').isVisible(),
      balance: await page.locator('.weekly-reward-celebration__balance').textContent(),
      focusTrapped: await page.evaluate(() => document.activeElement?.classList.contains('weekly-reward-celebration__dismiss')),
      credits,
    }
    const rewardScreenshot = path.join(os.tmpdir(), 'crash-beats-weekly-reward-qa.png')
    await page.screenshot({ path: rewardScreenshot })
    weeklyReward.screenshot = rewardScreenshot
    await page.getByRole('button', { name: 'Back to the boombox' }).click()

    const scheduleButton = page.getByRole('button', { name: 'View all weekly artists' })
    await scheduleButton.click()
    await page.getByRole('heading', { name: 'Weekly artists' }).waitFor()
    await page.waitForFunction(() => document.activeElement?.classList.contains('weekly-artists-modal__close'))
    weeklyArtistSchedule = await page.evaluate(() => {
      const dialog = document.querySelector('.weekly-artists-modal__dialog')?.getBoundingClientRect()
      const list = document.querySelector('.weekly-artists-modal__list')
      const current = document.querySelector('.weekly-artists-modal__artist[aria-current="true"]')
      const currentRect = current?.getBoundingClientRect()
      const listRect = list?.getBoundingClientRect()
      const headerPresets = document.querySelector('.weekly-header-presets')
      const headerRect = headerPresets?.getBoundingClientRect()
      const headerButtonsFit = [...(headerPresets?.children || [])].every((button) => {
        const rect = button.getBoundingClientRect()
        return rect.left >= headerRect.left && rect.right <= headerRect.right
      })
      const rows = [...document.querySelectorAll('.weekly-artists-modal__artist')].map((row) => ({
        name: row.querySelector('strong')?.textContent?.trim(),
        status: row.querySelector('.weekly-artists-modal__status')?.textContent?.trim(),
        current: row.getAttribute('aria-current') === 'true',
      }))

      return {
        dialogFits: Boolean(dialog && dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight),
        headerButtonsFit,
        headerControlCount: headerPresets?.children.length || 0,
        playlistPresent: Boolean(headerPresets?.querySelector('a[aria-label="Open the Crash Weekly playlist"]')),
        rowCount: rows.length,
        artistNames: rows.map((row) => row.name),
        firstArtist: rows[0]?.name,
        currentArtist: rows.find((row) => row.current)?.name,
        lastArtist: rows.at(-1)?.name,
        pastCount: rows.filter((row) => row.status === 'PAST').length,
        currentCount: rows.filter((row) => row.status === 'CURRENT' && row.current).length,
        futureCount: rows.filter((row) => row.status === 'FUTURE').length,
        scrollable: Boolean(list && list.scrollHeight > list.clientHeight),
        currentVisible: Boolean(currentRect && listRect && currentRect.top >= listRect.top && currentRect.bottom <= listRect.bottom),
      }
    })
    await page.keyboard.press('Tab')
    weeklyArtistSchedule.listFocused = await page.evaluate(
      () => document.activeElement?.classList.contains('weekly-artists-modal__list'),
    )
    const scrollBefore = await page.locator('.weekly-artists-modal__list').evaluate((list) => list.scrollTop)
    await page.keyboard.press('PageDown')
    await page.waitForTimeout(100)
    const scrollAfter = await page.locator('.weekly-artists-modal__list').evaluate((list) => list.scrollTop)
    weeklyArtistSchedule.keyboardScrollable = scrollAfter > scrollBefore
    await page.keyboard.press('Tab')
    weeklyArtistSchedule.focusTrapped = await page.evaluate(
      () => document.activeElement?.classList.contains('weekly-artists-modal__close'),
    )
    const scheduleScreenshot = path.join(os.tmpdir(), 'crash-beats-weekly-artists-qa.png')
    await page.screenshot({ path: scheduleScreenshot })
    weeklyArtistSchedule.screenshot = scheduleScreenshot
    await page.keyboard.press('Escape')
    await page.locator('.weekly-artists-modal').waitFor({ state: 'detached' })
    weeklyArtistSchedule.focusRestored = await page.evaluate(
      () => document.activeElement?.classList.contains('weekly-artists-preset'),
    )

    await page.locator('.mixtape:not(.mixtape--weekly)').first().click()
    await page.waitForTimeout(650)
    await page.locator('.mixtape--weekly').click()
    await page.waitForTimeout(650)
    weeklyReward.duplicateVisitCelebrated = (await page.locator('.weekly-reward-celebration').count()) > 0

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
    await page.locator('input[name="appleMusicUrl"]').fill('https://music.apple.com/us/artist/qa-artist/123456789')
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
      weeklyReward,
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
  results.push({ name: viewport.name, screenshot, pageErrors, layout, playback, mobileMotion, narrowForm, accountModal, weeklyArtistSchedule, weeklyHeader, weeklyNarrow })
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
  if (!layout.displayTextFits) {
    messages.push('Pixel display text is vertically clipped')
  }
  if (result.accountModal && (
    !result.accountModal.visible ||
    !result.accountModal.fitsViewport ||
    result.accountModal.providerButtons !== 1 ||
    !result.accountModal.emailFormVisible ||
    !result.accountModal.signedOutWeekly?.weeklyActive ||
    result.accountModal.signedOutWeekly?.rewardVisible ||
    result.accountModal.signedOutWeekly?.claimRequests !== 0 ||
    !result.accountModal.afterLogin?.weeklyActive ||
    result.accountModal.afterLogin?.rewardVisible ||
    result.accountModal.afterLogin?.claimRequests !== 0 ||
    !result.accountModal.afterWeeklyVisit?.rewardVisible ||
    result.accountModal.afterWeeklyVisit?.claimRequests !== 1
  )) {
    messages.push('The account dialog or signed-out Weekly gate did not reach the expected state')
  }
  if (
    result.weeklyHeader &&
    (result.weeklyHeader.controlCount !== 2 ||
      !result.weeklyHeader.controlsFit ||
      result.weeklyHeader.visibleLabels.join('|') !== 'PLAYLIST|ARTISTS')
  ) {
    messages.push('The desktop Weekly header controls did not render as expected')
  }
  if (
    result.weeklyNarrow &&
    (!result.weeklyNarrow.dialogFits ||
      !result.weeklyNarrow.pageFits ||
      result.weeklyNarrow.controlCount !== 2 ||
      !result.weeklyNarrow.controlsFit)
  ) {
    messages.push('The Weekly artist list does not fit the 320px viewport')
  }
  if (
    result.weeklyArtistSchedule &&
    (!result.weeklyArtistSchedule.dialogFits ||
      !result.weeklyArtistSchedule.headerButtonsFit ||
      result.weeklyArtistSchedule.headerControlCount !== 2 ||
      !result.weeklyArtistSchedule.playlistPresent ||
      result.weeklyArtistSchedule.rowCount !== 12 ||
      result.weeklyArtistSchedule.artistNames.join('\n') !== weeklyScheduleNames.join('\n') ||
      result.weeklyArtistSchedule.firstArtist !== 'Past Pulse' ||
      result.weeklyArtistSchedule.currentArtist !== 'Big Slay' ||
      result.weeklyArtistSchedule.lastArtist !== 'Afterglow' ||
      result.weeklyArtistSchedule.pastCount !== 4 ||
      result.weeklyArtistSchedule.currentCount !== 1 ||
      result.weeklyArtistSchedule.futureCount !== 7 ||
      !result.weeklyArtistSchedule.scrollable ||
      !result.weeklyArtistSchedule.currentVisible ||
      !result.weeklyArtistSchedule.listFocused ||
      !result.weeklyArtistSchedule.keyboardScrollable ||
      !result.weeklyArtistSchedule.focusTrapped ||
      !result.weeklyArtistSchedule.focusRestored)
  ) {
    messages.push('The Weekly artist schedule did not render or behave as expected')
  }
  if (
    result.playback &&
    (!result.playback.srcLoaded ||
      result.playback.initialTitle !== 'Guit 2' ||
      !result.playback.pausedAfterPause ||
      !result.playback.playingAfterPlay ||
      result.playback.titleAfterNext !== 'Mama' ||
      !result.playback.shuffleOn ||
      !result.playback.archiveEndReachable ||
      result.playback.download?.trackId !== 'regular-mama' ||
      !/^[0-9a-f-]{36}$/i.test(result.playback.download?.requestKey || '') ||
      result.playback.download?.credits !== 1 ||
      !result.playback.download?.accountLabel?.includes('1 download credit') ||
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
      !result.mobileMotion.weeklyReward.visible ||
      !result.mobileMotion.weeklyReward.balance?.includes('4') ||
      result.mobileMotion.weeklyReward.credits !== 4 ||
      !result.mobileMotion.weeklyReward.focusTrapped ||
      result.mobileMotion.weeklyReward.duplicateVisitCelebrated ||
      !result.mobileMotion.formPage.visible ||
      !result.mobileMotion.formPage.fitsViewport ||
      result.mobileMotion.formPage.fields < 8 ||
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
