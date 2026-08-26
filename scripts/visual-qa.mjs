import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const qaUrl = 'http://127.0.0.1:4175/'
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
  { name: 'landscape-phone', width: 844, height: 390 },
]

const results = []

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })
  await page.goto(qaUrl, { waitUntil: 'networkidle' })

  const layout = await page.evaluate(() => {
    const boombox = document.querySelector('.boombox')?.getBoundingClientRect()
    const tapes = [...document.querySelectorAll('.mixtape')].map((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    })

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
    }
  })

  let playback = null
  if (viewport.name === 'desktop') {
    await page.locator('.mixtape').first().click()
    await page.waitForTimeout(1300)
    const initialTitle = await page.locator('.pixel-display__title').textContent()

    await page.getByRole('button', { name: 'Pause' }).click()
    const pausedAfterPause = await page.locator('audio').evaluate((audio) => audio.paused)

    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await page.waitForTimeout(180)
    const playingAfterPlay = await page.locator('audio').evaluate((audio) => !audio.paused)

    await page.getByRole('button', { name: 'Next' }).click()
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
      }
    })
    playback.initialTitle = initialTitle?.trim()
    playback.pausedAfterPause = pausedAfterPause
    playback.playingAfterPlay = playingAfterPlay
    playback.titleAfterNext = titleAfterNext?.trim()
    playback.shuffleOn = shuffleOn === 'true'
  }

  const screenshot = path.join(os.tmpdir(), `crash-beats-${viewport.name}-qa.png`)
  await page.screenshot({ path: screenshot })
  results.push({ name: viewport.name, screenshot, pageErrors, layout, playback })
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
  if (
    result.playback &&
    (!result.playback.srcLoaded ||
      result.playback.initialTitle !== 'You Are Mine' ||
      !result.playback.pausedAfterPause ||
      !result.playback.playingAfterPlay ||
      result.playback.titleAfterNext !== 'Somebody' ||
      !result.playback.shuffleOn ||
      !result.playback.flyingTapeFinished)
  ) {
    messages.push('A playback interaction did not reach the expected state')
  }
  return messages.map((message) => `${result.name}: ${message}`)
})

if (failures.length) {
  console.error(`Visual QA failed:\n${failures.join('\n')}`)
  process.exitCode = 1
}
