const encoder = new TextEncoder()

export async function verifyStripeSignature(body, header, secret, now = Date.now()) {
  if (!secret || !header) return false
  const parts = Object.fromEntries(header.split(',').map((part) => part.trim().split('=')))
  const timestamp = Number(parts.t)
  if (!Number.isSafeInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false
  const signatures = header.split(',').map((part) => part.trim()).filter((part) => part.startsWith('v1='))
  if (!signatures.length) return false
  const prefix = encoder.encode(`${timestamp}.`)
  const payload = new Uint8Array(prefix.length + body.length)
  payload.set(prefix)
  payload.set(body, prefix.length)
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  for (const entry of signatures) {
    const hex = entry.slice(3)
    if (!/^[0-9a-f]{64}$/i.test(hex)) continue
    const signature = Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16))
    if (await crypto.subtle.verify('HMAC', key, signature, payload)) return true
  }
  return false
}

export async function createCheckoutSession(env, order, beat, origin) {
  const params = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(order.amount_cents),
    'line_items[0][price_data][product_data][name]': `${beat.title} — ${order.license_name}`,
    'line_items[0][quantity]': '1',
    customer_email: order.buyer_email,
    client_reference_id: order.id,
    'metadata[order_id]': order.id,
    success_url: `${origin}/beat-store?order=${encodeURIComponent(order.id)}`,
    cancel_url: `${origin}/beat-store?canceled=1`,
  })
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': order.id,
      'stripe-version': '2025-06-30.basil',
    },
    body: params,
  })
  const session = await response.json()
  if (!response.ok || !session.id || !session.url?.startsWith('https://checkout.stripe.com/')) {
    throw new Error('Stripe could not create a checkout session.')
  }
  return session
}
