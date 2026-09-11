import { afterEach, expect, it, vi } from 'vitest'
import { emailVerificationIsAvailable, sendConfirmationCode } from './email.js'

afterEach(() => vi.restoreAllMocks())
const env = { RESEND_API_KEY: 'test-only-key', AUTH_EMAIL_FROM: 'Crash Beats <accounts@crash.test>' }
const code = { email: 'listener@example.com', otp: '123456', type: 'email-verification' }

it('requires both server-side mail settings', async () => {
  expect(emailVerificationIsAvailable({})).toBe(false)
  expect(emailVerificationIsAvailable({ RESEND_API_KEY: 'key' })).toBe(false)
  expect(emailVerificationIsAvailable(env)).toBe(true)
  const fetch = vi.spyOn(globalThis, 'fetch')
  await expect(sendConfirmationCode({}, code)).rejects.toThrow('not available')
  await expect(sendConfirmationCode(env, { ...code, type: 'sign-in' })).rejects.toThrow('not available')
  expect(fetch).not.toHaveBeenCalled()
})

it('sends only the confirmation message through Resend', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'test-message' }))
  await sendConfirmationCode(env, code)
  const [url, options] = fetch.mock.calls[0]
  expect(url).toBe('https://api.resend.com/emails')
  expect(options.headers.authorization).toBe('Bearer test-only-key')
  expect(JSON.parse(options.body)).toMatchObject({ from: env.AUTH_EMAIL_FROM, to: [code.email], text: expect.stringContaining(code.otp) })
  expect(options.signal).toBeInstanceOf(AbortSignal)
})

it('does not report successful delivery or expose provider details after rejection', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ message: 'private-provider-details' }, { status: 403 }))
  await expect(sendConfirmationCode(env, code)).rejects.toThrow('The confirmation email could not be sent. Please try again later.')
})
