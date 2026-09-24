import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCheckoutSession, verifyStripeSignature } from './stripe.js'
import { handleRequest, handleStoreCheckout, handleStoreManagement, handleStorePurchases, handleStripeWebhook } from './index.js'

const owner = async () => ({ user: { id: 'owner', email: 'ewoodthomas@gmail.com', emailVerified: true } })
const buyer = async () => ({ user: { id: 'buyer', email: 'listener@example.com', emailVerified: true } })
const orderId = '123e4567-e89b-42d3-a456-426614174000'
const beatId = '223e4567-e89b-42d3-a456-426614174000'

function stubDb({ beat, order } = {}) {
  const statements = []
  return {
    statements,
    prepare(sql) {
      statements.push(sql)
      return {
        bind(...values) { this.values = values; return this },
        async first() {
          if (sql.includes('RETURNING "count"')) return { count: 1 }
          if (sql.includes('FROM store_beats')) return beat || null
          if (sql.includes('FROM beat_orders')) return order || null
          return null
        },
        async run() { return { meta: { changes: 1 } } },
        async all() { return { results: [] } },
      }
    },
  }
}

function realDb() {
  const database = new DatabaseSync(':memory:')
  for (const name of ['0001_initial.sql', '0002_audio_storage_reservations.sql', '0004_auth_rate_limit.sql', '0009_beat_store.sql', '0010_store_beat_deletion.sql']) {
    database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  }
  return {
    database,
    d1: {
      prepare(sql) {
        const statement = database.prepare(sql)
        let values = []
        return {
          bind(...next) { values = next; return this },
          async first() { return statement.get(...values) || null },
          async all() { return { results: statement.all(...values) } },
          async run() { return { meta: { changes: Number(statement.run(...values).changes) } } },
        }
      },
      async batch(statements) {
        database.exec('BEGIN')
        try {
          for (const statement of statements) await statement.run()
          database.exec('COMMIT')
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
      },
    },
  }
}

async function signedRequest(event, secret, now = Date.now()) {
  const body = JSON.stringify(event)
  const timestamp = Math.floor(now / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`))
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return new Request('https://crash-beats.com/api/store/webhook', {
    method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${hex}` }, body,
  })
}

afterEach(() => vi.restoreAllMocks())

describe('Stripe checkout and fulfillment', () => {
  it('verifies the raw signed payload and rejects tampering or old timestamps', async () => {
    const request = await signedRequest({ type: 'test' }, 'whsec_test')
    const body = new Uint8Array(await request.arrayBuffer())
    const header = request.headers.get('stripe-signature')
    expect(await verifyStripeSignature(body, header, 'whsec_test')).toBe(true)
    expect(await verifyStripeSignature(new TextEncoder().encode('changed'), header, 'whsec_test')).toBe(false)
    expect(await verifyStripeSignature(body, header, 'whsec_test', Date.now() + 301000)).toBe(false)
  })

  it('uses the stored price and verified buyer email when opening hosted checkout', async () => {
    const DB = stubDb({ beat: {
      id: beatId, title: 'New Beat', price_cents: 2500,
      license_name: 'Standard', license_terms: 'Terms for this license are set by the seller.',
    } })
    const stripeFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'cs_test_example', url: 'https://checkout.stripe.com/c/pay/example',
    }), { headers: { 'content-type': 'application/json' } }))
    const response = await handleStoreCheckout(new Request('https://crash-beats.com/api/store/checkout', {
      method: 'POST', headers: { origin: 'https://crash-beats.com' },
      body: JSON.stringify({ beatId, priceCents: 1, acceptedLicense: true }),
    }), { DB, STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_example', BETTER_AUTH_URL: 'https://crash-beats.com' }, buyer)
    expect(response.status).toBe(200)
    const [, options] = stripeFetch.mock.calls[0]
    expect(options.body.get('line_items[0][price_data][unit_amount]')).toBe('2500')
    expect(options.body.get('customer_email')).toBe('listener@example.com')
    expect(options.headers.authorization).toBe('Bearer sk_test_example')
    expect(DB.statements.some((sql) => sql.includes('INSERT INTO beat_orders'))).toBe(true)
  })

  it('conceals sale controls from non-owner accounts', async () => {
    const DB = stubDb()
    const response = await handleStoreManagement(new Request('https://crash-beats.com/api/manage/store-beats'), { DB }, buyer)
    expect(response.status).toBe(404)
    expect(DB.statements).toHaveLength(0)
  })

  it('marks an order paid only from a valid, matching Stripe event', async () => {
    const checkout = {
      id: 'cs_test_example', mode: 'payment', payment_status: 'paid', currency: 'usd',
      amount_total: 2500, client_reference_id: orderId, metadata: { order_id: orderId },
    }
    const order = { id: orderId, amount_cents: 2500, stripe_session_id: 'cs_test_example', status: 'pending' }
    const DB = stubDb({ order })
    const env = { DB, STRIPE_WEBHOOK_SECRET: 'whsec_test' }
    const unpaidDb = stubDb({ order })
    const unpaid = await handleStripeWebhook(await signedRequest({
      type: 'checkout.session.completed', data: { object: { ...checkout, payment_status: 'unpaid' } },
    }, 'whsec_test'), { ...env, DB: unpaidDb })
    expect(unpaid.status).toBe(200)
    expect(unpaidDb.statements.some((sql) => sql.includes("SET status = 'paid'"))).toBe(false)
    const valid = await handleStripeWebhook(await signedRequest({ type: 'checkout.session.completed', data: { object: checkout } }, 'whsec_test'), env)
    expect(valid.status).toBe(200)
    expect(DB.statements.some((sql) => sql.includes("SET status = 'paid'"))).toBe(true)

    const badAmount = await handleStripeWebhook(await signedRequest({ type: 'checkout.session.completed', data: { object: { ...checkout, amount_total: 1 } } }, 'whsec_test'), env)
    expect(badAmount.status).toBe(400)
    const forged = await signedRequest({ type: 'checkout.session.completed', data: { object: checkout } }, 'wrong-secret')
    expect((await handleStripeWebhook(forged, env)).status).toBe(400)
  })

  it('delivers the full file only to a verified purchaser after payment', async () => {
    const order = {
      id: orderId, status: 'paid', title: 'New Beat', license_name: 'Standard',
      license_terms: 'Terms', full_object_key: 'store/private/full.wav', full_mime_type: 'audio/wav',
    }
    const AUDIO = { get: vi.fn().mockResolvedValue({ size: 4, body: new Blob(['WAVE']).stream() }) }
    const request = new Request(`https://crash-beats.com/api/store/orders/${orderId}/download`)
    const denied = await handleStorePurchases(request, { DB: stubDb({ order }), AUDIO }, orderId, true,
      async () => ({ user: { id: 'other', email: 'other@example.com', emailVerified: false } }))
    expect(denied.status).toBe(401)
    expect(AUDIO.get).not.toHaveBeenCalled()
    const allowed = await handleStorePurchases(request, { DB: stubDb({ order }), AUDIO }, orderId, true, buyer)
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('content-disposition')).toContain('.wav')
    expect(allowed.headers.get('cache-control')).toBe('private, no-store')
  })

  it('deletes an unsold draft and both of its audio files', async () => {
    const { database, d1 } = realDb()
    const AUDIO = { delete: vi.fn().mockResolvedValue(undefined) }
    try {
      database.prepare(
        `INSERT INTO store_beats
         (id, title, preview_object_key, preview_byte_size, full_object_key,
          full_filename, full_mime_type, full_byte_size)
         VALUES (?, 'Draft Beat', 'store/draft/preview.mp3', 10,
          'store/draft/full.wav', 'full.wav', 'audio/wav', 20)`,
      ).run(beatId)
      const response = await handleStoreManagement(new Request(`https://crash-beats.com/api/manage/store-beats/${beatId}`, {
        method: 'DELETE',
      }), { DB: d1, AUDIO }, owner)
      expect(await response.json()).toEqual({ ok: true, archived: false })
      expect(database.prepare('SELECT id FROM store_beats WHERE id = ?').get(beatId)).toBeUndefined()
      expect(AUDIO.delete).toHaveBeenCalledTimes(2)
    } finally {
      database.close()
    }
  })

  it('uploads a private beat, publishes it, and unlocks the real file after payment', async () => {
    const { database, d1 } = realDb()
    const preview = new Uint8Array(838)
    preview.set([0xff, 0xfb, 0x90, 0x64], 0)
    preview.set([0xff, 0xfb, 0x90, 0x64], 417)
    const wave = new Uint8Array(12)
    wave.set(new TextEncoder().encode('RIFF'), 0)
    wave.set(new TextEncoder().encode('WAVE'), 8)
    const form = new FormData()
    form.set('title', 'New Beat')
    form.set('rightsConfirmed', 'yes')
    form.set('preview', new File([preview], 'preview.mp3', { type: 'audio/mpeg' }))
    form.set('full', new File([wave], 'full.wav', { type: 'audio/wav' }))
    const AUDIO = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({ size: wave.length, body: new Blob([wave]).stream() }),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    const env = { DB: d1, AUDIO, STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_test', BETTER_AUTH_URL: 'https://crash-beats.com' }
    try {
      const uploaded = await handleStoreManagement(new Request('https://crash-beats.com/api/manage/store-beats', {
        method: 'POST', body: form,
      }), env, owner)
      expect(uploaded.status).toBe(201)
      const { beatId: newBeatId } = await uploaded.json()
      expect((await (await handleRequest(new Request('https://crash-beats.com/api/store/beats'), env, {})).json()).beats).toEqual([])

      const edited = await handleStoreManagement(new Request(`https://crash-beats.com/api/manage/store-beats/${newBeatId}`, {
        method: 'PATCH', body: JSON.stringify({
          title: 'New Beat', priceCents: 2500, licenseName: 'Standard',
          licenseTerms: 'Use this beat under the seller-provided standard license.', published: true,
        }),
      }), env, owner)
      expect(edited.status).toBe(200)
      expect((await (await handleRequest(new Request('https://crash-beats.com/api/store/beats'), env, {})).json()).beats).toHaveLength(1)

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        id: 'cs_test_real', url: 'https://checkout.stripe.com/c/pay/real',
      }), { headers: { 'content-type': 'application/json' } }))
      const checkout = await handleStoreCheckout(new Request('https://crash-beats.com/api/store/checkout', {
        method: 'POST', body: JSON.stringify({ beatId: newBeatId, acceptedLicense: true }),
      }), env, buyer)
      expect(checkout.status).toBe(200)
      const saved = database.prepare('SELECT id, status FROM beat_orders').get()
      expect(saved.status).toBe('pending')
      const before = await handleStorePurchases(new Request(`https://crash-beats.com/api/store/orders/${saved.id}/download`), env, saved.id, true, buyer)
      expect(before.status).toBe(402)
      expect(AUDIO.get).not.toHaveBeenCalled()

      const paid = await handleStripeWebhook(await signedRequest({ type: 'checkout.session.completed', data: { object: {
        id: 'cs_test_real', mode: 'payment', payment_status: 'paid', currency: 'usd', amount_total: 2500,
        client_reference_id: saved.id, metadata: { order_id: saved.id },
      } } }, 'whsec_test'), env)
      expect(paid.status).toBe(200)
      expect(database.prepare('SELECT status FROM beat_orders WHERE id = ?').get(saved.id).status).toBe('paid')
      const after = await handleStorePurchases(new Request(`https://crash-beats.com/api/store/orders/${saved.id}/download`), env, saved.id, true, buyer)
      expect(after.status).toBe(200)

      const removed = await handleStoreManagement(new Request(`https://crash-beats.com/api/manage/store-beats/${newBeatId}`, {
        method: 'DELETE',
      }), env, owner)
      expect(await removed.json()).toEqual({ ok: true, archived: true })
      expect((await (await handleRequest(new Request('https://crash-beats.com/api/store/beats'), env, {})).json()).beats).toEqual([])
      expect((await handleStorePurchases(new Request(`https://crash-beats.com/api/store/orders/${saved.id}/download`), env, saved.id, true, buyer)).status).toBe(200)
      expect(AUDIO.delete).not.toHaveBeenCalled()
    } finally {
      database.close()
    }
  })
})
