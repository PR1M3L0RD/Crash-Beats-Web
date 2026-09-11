import { describe, expect, it, vi } from 'vitest'
import worker, { handleRequest, mutationOriginIsAllowed } from './index.js'
import { readLimitedBody, secureResponse, signMediaUrl, verifyMediaUrl } from './security.js'

describe('request security', () => {
  it.each([undefined, '1'])('counts streamed bytes with Content-Length %s', async (length) => {
    const cancel = vi.fn()
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)) },
      cancel,
    })
    const request = new Request('https://crash.test', { method: 'POST', body, duplex: 'half', headers: length ? { 'content-length': length } : {} })
    await expect(readLimitedBody(request, 10)).rejects.toMatchObject({ status: 413 })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('accepts a valid multipart body at the limit', async () => {
    const form = new FormData()
    form.set('artistName', 'Test Artist')
    const request = new Request('https://crash.test', { method: 'POST', body: form })
    const length = (await request.clone().arrayBuffer()).byteLength
    const body = await readLimitedBody(request, length)
    expect((await new Response(body).formData()).get('artistName')).toBe('Test Artist')
  })

  it('rejects oversized auth requests before auth initialization', async () => {
    const response = await handleRequest(new Request('https://crash.test/api/auth/sign-up/email', { method: 'POST', body: 'x'.repeat(16385) }), {})
    expect(response.status).toBe(413)
  })

  it('rejects cross-site submissions before parsing or storing uploads', async () => {
    const request = new Request('https://crash.test/api/submissions', { method: 'POST', headers: { origin: 'https://attacker.test' } })
    expect((await handleRequest(request, {})).status).toBe(403)
    expect(mutationOriginIsAllowed(new Request('https://crash.test', { headers: { 'sec-fetch-site': 'cross-site' } }))).toBe(false)
  })

  it('returns 400 for malformed multipart uploads', async () => {
    const response = await handleRequest(new Request('https://crash.test/api/submissions', { method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: 'invalid' }), {})
    expect(response.status).toBe(400)
  })
})

describe('private audio links', () => {
  const now = Date.UTC(2026, 8, 11)
  const secret = 'a-private-test-secret'
  const url = 'https://crash.test/api/submissions/submission/tracks/track'
  it('scopes access to one track for fifteen minutes without revealing the secret', async () => {
    const signed = await signMediaUrl(url, secret, now)
    expect(signed).not.toContain(secret)
    expect(await verifyMediaUrl(signed, secret, now)).toBe(true)
    expect(await verifyMediaUrl(signed, secret, now + 900000)).toBe(false)
    expect(await verifyMediaUrl(signed.replace('/tracks/track', '/tracks/other'), secret, now)).toBe(false)
    expect(await verifyMediaUrl(signed, 'wrong-secret', now)).toBe(false)
    expect(await verifyMediaUrl(`${url}?token=${secret}`, secret, now)).toBe(false)
    const modified = new URL(signed)
    modified.searchParams.set('expires', String(now / 1000 + 901))
    expect(await verifyMediaUrl(modified, secret, now)).toBe(false)
  })
  it('denies unsigned audio before accessing storage', async () => {
    const response = await handleRequest(new Request(url), { GOOGLE_SHEETS_WEBHOOK_SECRET: secret })
    expect(response.status).toBe(404)
  })
})

describe('response security', () => {
  it('preserves cookies and streaming response metadata', async () => {
    const original = new Response('audio', { status: 206, headers: { 'content-range': 'bytes 0-4/10', 'set-cookie': 'session=test; HttpOnly; Secure' } })
    const secured = secureResponse(original, new Request('https://crash.test'))
    expect(secured.status).toBe(206)
    expect(secured.headers.get('set-cookie')).toContain('HttpOnly')
    expect(secured.headers.get('content-range')).toBe('bytes 0-4/10')
    expect(secured.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect(await secured.text()).toBe('audio')
  })
  it('protects successful and error API responses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const path of ['/api/health', '/api/unknown', '/api/audio/%']) {
        const response = await worker.fetch(new Request(`https://crash.test${path}`), {})
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(response.headers.get('x-frame-options')).toBe('DENY')
        expect(response.headers.get('cache-control')).toBe('no-store')
      }
    } finally { log.mockRestore() }
  })
})
