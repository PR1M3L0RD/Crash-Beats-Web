import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].filter(Boolean).find((file) => fs.existsSync(file))
assert(executablePath, 'Chrome or Edge is required')
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4176', '--strictPort'], { stdio: 'ignore', windowsHide: true })
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { ready = (await fetch('http://127.0.0.1:4176')).ok } catch {}
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 125))
  }
  assert(ready, 'QA server did not start')
  browser = await chromium.launch({ executablePath, headless: true })
  for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 480 }]) {
    const page = await browser.newPage({ viewport })
    let verified = false
    let sends = 0
    let claims = 0
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const user = () => ({ id: 'qa-user', email: 'listener@example.com', name: 'Test Listener', emailVerified: verified })
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname
      let status = 200
      let payload = {}
      if (path === '/api/auth/config') payload = { email: true, emailVerification: true, providers: { google: false } }
      else if (path === '/api/auth/get-session') payload = { user: user(), session: { id: 'qa-session', userId: 'qa-user', expiresAt: '2099-01-01T00:00:00Z' } }
      else if (path === '/api/account') payload = { user: user(), credits: verified ? 7 : 0 }
      else if (path === '/api/account/email-code') { sends += 1; payload = { success: true } }
      else if (path === '/api/account/confirm-email') {
        if (route.request().postDataJSON().otp === '123456') { verified = true; payload = { status: true } }
        else { status = 400; payload = { message: 'Invalid OTP' } }
      } else if (path === '/api/catalog') payload = { mixtapes: [] }
      else if (path === '/api/credits/weekly-claim') { claims += 1; payload = { awarded: false, credits: 7 } }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
    })
    await page.goto('http://127.0.0.1:4176')
    await page.locator('.account-preset').click()
    await page.getByRole('button', { name: 'Send confirmation code' }).click()
    await page.getByRole('status').filter({ hasText: 'Code sent' }).waitFor()
    assert.equal(sends, 1)
    assert(await page.getByRole('button', { name: /Resend in/ }).isDisabled())
    await page.getByLabel('Six-digit email code').fill('000000')
    await page.getByRole('button', { name: 'Confirm email', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Invalid OTP' }).waitFor()
    await page.getByLabel('Six-digit email code').fill('123456')
    await page.getByRole('button', { name: 'Confirm email', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Email confirmed' }).waitFor()
    await page.getByLabel('7 download credits', { exact: true }).waitFor()
    assert.equal(claims, 0, 'Confirmation must not request a weekly reward')
    assert.deepEqual(errors, [])
    const bounds = await page.locator('.account-modal__dialog').boundingBox()
    assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.height <= viewport.height)
    await page.close()
  }
  console.log('Email confirmation QA passed: desktop/mobile, send cooldown, invalid code, verified balance refresh, no reward replay.')
} finally {
  await browser?.close()
  server.kill()
}
