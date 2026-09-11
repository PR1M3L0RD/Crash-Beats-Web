async function mediaSignature(secret, pathname, expires) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${pathname}\n${expires}`))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function signMediaUrl(url, secret, now = Date.now()) {
  const signed = new URL(url)
  const expires = String(Math.floor(now / 1000) + 15 * 60)
  signed.searchParams.set('expires', expires)
  signed.searchParams.set('signature', await mediaSignature(secret, signed.pathname, expires))
  return signed.href
}

export async function verifyMediaUrl(url, secret, now = Date.now()) {
  if (!secret) return false
  const signed = new URL(url)
  const expires = signed.searchParams.get('expires') || ''
  const supplied = signed.searchParams.get('signature') || ''
  const current = Math.floor(now / 1000)
  if (!/^\d{1,12}$/.test(expires) || Number(expires) <= current || Number(expires) > current + 900 || !/^[0-9a-f]{64}$/.test(supplied)) return false
  const expected = await mediaSignature(secret, signed.pathname, expires)
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index)
  return difference === 0
}

export function secureResponse(response, request) {
  const secured = new Response(response.body, response)
  secured.headers.set('x-content-type-options', 'nosniff')
  secured.headers.set('x-frame-options', 'DENY')
  secured.headers.set('referrer-policy', 'no-referrer')
  secured.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  if (new URL(request.url).protocol === 'https:') {
    secured.headers.set('strict-transport-security', 'max-age=31536000')
  }
  return secured
}

// Count actual streamed bytes: Content-Length is optional and untrusted.
export async function readLimitedBody(request, maximumBytes) {
  if (Number(request.headers.get('content-length')) > maximumBytes) {
    throw Object.assign(new Error('Request body is too large.'), { status: 413 })
  }
  if (!request.body) return new Blob([])
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximumBytes) {
        await reader.cancel().catch(() => {})
        throw Object.assign(new Error('Request body is too large.'), { status: 413 })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new Blob(chunks, { type: request.headers.get('content-type') || '' })
}
