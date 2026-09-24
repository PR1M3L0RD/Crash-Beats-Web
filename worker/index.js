import { createAuth, getAuthProviderAvailability } from './auth.js'
import { normalizeArtistLink } from '../shared/artist-links.js'
import { readLimitedBody, secureResponse, signMediaUrl, verifyMediaUrl } from './security.js'
import { emailVerificationIsAvailable } from './email.js'
import { createCheckoutSession, verifyStripeSignature } from './stripe.js'

const MAX_SONGS = 3
const MAX_SONG_BYTES = 20 * 1024 * 1024
const MAX_REQUEST_BYTES = 62 * 1024 * 1024
const MAX_DAILY_SUBMISSIONS = 3
const MAX_R2_STORAGE_BYTES = 9_000_000_000
const MIXTAPE_EDITORS = new Set(['crashbeats08@gmail.com', 'ewoodthomas@gmail.com'])
const MAX_STORE_PREVIEW_BYTES = 10 * 1024 * 1024
const MAX_STORE_FILE_BYTES = 40 * 1024 * 1024
const MAX_STORE_REQUEST_BYTES = 52 * 1024 * 1024
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
const DOWNLOAD_RETRY_WINDOW_MILLISECONDS = 10 * 60 * 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_AUTH_ROUTES = new Set([
  'GET /api/auth/get-session',
  'GET /api/auth/error',
  'GET /api/auth/ok',
  'POST /api/auth/sign-up/email',
  'POST /api/auth/sign-in/email',
  'POST /api/auth/sign-in/social',
  'POST /api/auth/sign-out',
  'POST /api/auth/update-user',
  'POST /api/auth/delete-user',
])
const FALLBACK_WEEKLY_ARTISTS = [{
  name: 'Big Slay',
  socialHref: 'https://instagram.com/savi.global',
  musicHref: 'https://open.spotify.com/artist/3FdfHmxbjiS7KtxqvZ5j42',
}]

function json(data, init = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function getMondayUtcWeekKey(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError('A valid date is required.')

  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday,
  ))
  return monday.toISOString().slice(0, 10)
}

export function mutationOriginIsAllowed(request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (!origin) return true

  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

export function makeDownloadDisposition(title, fallbackId = 'crash-beats-track', extension = 'mp3') {
  const cleanedTitle = String(title || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
  const cleanedFallback = String(fallbackId || 'crash-beats-track')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
  const stem = cleanedTitle || cleanedFallback || 'crash-beats-track'
  const filename = `${stem}.${extension}`
  const asciiFilename = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '') || `${cleanedFallback || 'crash-beats-track'}.${extension}`
  const encodedFilename = encodeURIComponent(filename)
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
}

export function isInsufficientCreditsError(error) {
  let current = error
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (/insufficient_credits/i.test(String(current.message || current))) return true
    current = current.cause
  }
  return false
}

async function authenticateRequest(request, env) {
  const auth = createAuth(env)
  return auth.api.getSession({
    headers: request.headers,
    query: {
      disableCookieCache: true,
      disableRefresh: true,
    },
  })
}

async function getCreditBalance(env, email) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(delta), 0) AS credits
     FROM credit_events
     WHERE email = ?1`,
  ).bind(email).first()
  const credits = Number(row?.credits ?? 0)
  return Number.isSafeInteger(credits) && credits >= 0 ? credits : 0
}

async function creditIdentityIsAllowed(env, user) {
  if (user.emailVerified === true) return true
  // An unverified address is not proof of ownership of a deleted account.
  const previousOwner = await env.DB.prepare(
    'SELECT 1 AS found FROM credit_events WHERE email = ?1 AND user_id <> ?2 LIMIT 1',
  ).bind(String(user.email || '').trim().toLowerCase(), user.id).first()
  return !previousOwner
}

function creditIdentityResponse() {
  return json({
    error: 'Verify ownership of this email before restoring credits from a deleted account. Contact Crash Beats for help.',
    code: 'EMAIL_VERIFICATION_REQUIRED',
  }, { status: 403 })
}

function unauthenticatedResponse() {
  return json({
    error: 'Sign in to use download credits.',
    code: 'UNAUTHENTICATED',
  }, { status: 401 })
}

function invalidOriginResponse() {
  return json({
    error: 'This request did not come from Crash Beats.',
    code: 'INVALID_ORIGIN',
  }, { status: 403 })
}

function rateLimitedResponse(retryAfterSeconds) {
  return json({
    error: 'Too many requests. Please wait a moment and try again.',
    code: 'RATE_LIMITED',
  }, {
    status: 429,
    headers: { 'retry-after': String(Math.max(1, retryAfterSeconds)) },
  })
}

async function enforceUserRateLimit(env, userId, scope, limit, windowSeconds, now = new Date()) {
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const windowMilliseconds = windowSeconds * 1000
  const bucketStart = Math.floor(timestamp / windowMilliseconds) * windowMilliseconds
  const row = await env.DB.prepare(
    `INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest")
     VALUES (?1, ?2, 1, ?3)
     ON CONFLICT("key") DO UPDATE SET
       "count" = CASE
         WHEN "rateLimit"."lastRequest" < excluded."lastRequest" THEN 1
         ELSE "rateLimit"."count" + 1
       END,
       "lastRequest" = MAX("rateLimit"."lastRequest", excluded."lastRequest")
     RETURNING "count"`,
  ).bind(
    crypto.randomUUID(),
    `crash-beats:${scope}:${userId}`,
    bucketStart,
  ).first()

  if (Number(row?.count ?? 0) <= limit) return null
  return rateLimitedResponse(Math.ceil((bucketStart + windowMilliseconds - timestamp) / 1000))
}

export function authRequestIsAllowed(request, providers = {}) {
  const { pathname } = new URL(request.url)
  const routeKey = `${request.method.toUpperCase()} ${pathname}`

  if (ALLOWED_AUTH_ROUTES.has(routeKey)) return true
  if (request.method.toUpperCase() !== 'GET') return false
  if (pathname === '/api/auth/callback/google') return Boolean(providers.google)
  return false
}

export async function handleAccount(
  request,
  env,
  authenticate = authenticateRequest,
) {
  const session = await authenticate(request, env)
  if (!session?.user?.id) return unauthenticatedResponse()
  const email = String(session.user.email || '').trim().toLowerCase()

  const rateLimit = await enforceUserRateLimit(env, session.user.id, 'account', 120, 60)
  if (rateLimit) return rateLimit

  return json({
    user: session.user,
    credits: await creditIdentityIsAllowed(env, session.user) ? await getCreditBalance(env, email) : 0,
  })
}

export async function handleCredits(
  request,
  env,
  authenticate = authenticateRequest,
) {
  const session = await authenticate(request, env)
  if (!session?.user?.id) return unauthenticatedResponse()

  const rateLimit = await enforceUserRateLimit(env, session.user.id, 'credits', 120, 60)
  if (rateLimit) return rateLimit
  if (!await creditIdentityIsAllowed(env, session.user)) return creditIdentityResponse()

  return json({ credits: await getCreditBalance(env, String(session.user.email || '').trim().toLowerCase()) })
}

export async function handleWeeklyCreditClaim(
  request,
  env,
  authenticate = authenticateRequest,
  now = new Date(),
) {
  if (!mutationOriginIsAllowed(request)) return invalidOriginResponse()

  const session = await authenticate(request, env)
  if (!session?.user?.id) return unauthenticatedResponse()

  const rateLimit = await enforceUserRateLimit(env, session.user.id, 'weekly-claim', 12, 60, now)
  if (rateLimit) return rateLimit
  if (!await creditIdentityIsAllowed(env, session.user)) return creditIdentityResponse()

  const weekKey = getMondayUtcWeekKey(now)
  const email = String(session.user.email || '').trim().toLowerCase()
  // D1 batches are transactional, so a failed ledger write cannot consume a claim.
  const [, grant] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO account_credit_claims (email, week_key)
       VALUES (?1, ?2)
       ON CONFLICT(email, week_key) DO NOTHING`,
    ).bind(email, weekKey),
    env.DB.prepare(
      `INSERT INTO credit_events (id, user_id, email, delta, kind, reference_key)
       SELECT ?1, ?2, ?3, 2, 'weekly_grant', ?4
       WHERE changes() = 1
       ON CONFLICT(email, kind, reference_key) DO NOTHING`,
    ).bind(crypto.randomUUID(), session.user.id, email, weekKey),
  ])
  const awarded = Number(grant.meta?.changes ?? grant.changes ?? 0) === 1
  const credits = await getCreditBalance(env, email)

  return json({
    awarded,
    amount: awarded ? 2 : 0,
    credits,
    weekKey,
  })
}

export async function handleDownload(
  request,
  env,
  trackId,
  authenticate = authenticateRequest,
  now = new Date(),
) {
  if (!mutationOriginIsAllowed(request)) return invalidOriginResponse()

  const session = await authenticate(request, env)
  if (!session?.user?.id) return unauthenticatedResponse()
  const email = String(session.user.email || '').trim().toLowerCase()

  const rateLimit = await enforceUserRateLimit(env, session.user.id, 'download', 30, 60, now)
  if (rateLimit) return rateLimit
  if (!await creditIdentityIsAllowed(env, session.user)) return creditIdentityResponse()

  const suppliedRequestKey = request.headers.get('idempotency-key')
  if (suppliedRequestKey && !UUID_PATTERN.test(suppliedRequestKey)) {
    return json({
      error: 'The download request key is invalid.',
      code: 'INVALID_IDEMPOTENCY_KEY',
    }, { status: 400 })
  }
  const requestKey = suppliedRequestKey?.toLowerCase() || crypto.randomUUID()

  const track = await env.DB.prepare(
    `SELECT t.id, t.title, t.object_key, t.mime_type, t.byte_size
     FROM tracks t
     JOIN mixtapes m ON m.id = t.mixtape_id
     WHERE t.id = ?1
       AND t.is_published = 1
       AND m.is_published = 1
     LIMIT 1`,
  ).bind(trackId).first()
  if (!track) {
    return json({ error: 'Track not found.', code: 'TRACK_NOT_FOUND' }, { status: 404 })
  }

  const existingEvent = await env.DB.prepare(
    `SELECT track_id, created_at
     FROM credit_events
      WHERE email = ?1 AND kind = 'download' AND reference_key = ?2
     LIMIT 1`,
    ).bind(email, requestKey).first()
  if (existingEvent) {
    const eventTime = new Date(existingEvent.created_at).getTime()
    const retryIsValid = existingEvent.track_id === track.id &&
      Number.isFinite(eventTime) &&
      now.getTime() - eventTime <= DOWNLOAD_RETRY_WINDOW_MILLISECONDS
    if (!retryIsValid) {
      return json({
        error: 'That download retry key can no longer be used.',
        code: 'IDEMPOTENCY_KEY_REUSED',
      }, { status: 409 })
    }
  } else {
    const credits = await getCreditBalance(env, email)
    if (credits < 1) {
      return json({
        error: 'You are out of download credits.',
        code: 'INSUFFICIENT_CREDITS',
        credits,
      }, { status: 402 })
    }
  }

  // Verify the private object exists before charging the account.
  const object = await env.AUDIO.get(track.object_key)
  if (!object) {
    return json({ error: 'Audio object not found.', code: 'AUDIO_NOT_FOUND' }, { status: 404 })
  }

  if (!existingEvent) {
    const eventId = crypto.randomUUID()
    try {
      const insert = await env.DB.prepare(
        `INSERT INTO credit_events
          (id, user_id, email, delta, kind, reference_key, track_id)
         VALUES (?1, ?2, ?3, -1, 'download', ?4, ?5)
         ON CONFLICT(email, kind, reference_key) DO NOTHING`,
      ).bind(eventId, session.user.id, email, requestKey, track.id).run()

      if (Number(insert.meta?.changes ?? insert.changes ?? 0) !== 1) {
        const concurrentEvent = await env.DB.prepare(
          `SELECT track_id FROM credit_events
            WHERE email = ?1 AND kind = 'download' AND reference_key = ?2
           LIMIT 1`,
          ).bind(email, requestKey).first()
        if (concurrentEvent?.track_id !== track.id) {
          return json({
            error: 'That download retry key was already used for another track.',
            code: 'IDEMPOTENCY_KEY_REUSED',
          }, { status: 409 })
        }
      }
    } catch (error) {
      if (!isInsufficientCreditsError(error)) throw error
      return json({
        error: 'You are out of download credits.',
        code: 'INSUFFICIENT_CREDITS',
        credits: await getCreditBalance(env, email),
      }, { status: 402 })
    }
  }

  const credits = await getCreditBalance(env, email)
  const headers = new Headers()
  object.writeHttpMetadata?.(headers)
  headers.set('content-type', track.mime_type || 'audio/mpeg')
  headers.set('content-disposition', makeDownloadDisposition(track.title, track.id))
  headers.set('cache-control', 'private, no-store')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('x-credits-remaining', String(credits))
  headers.set('x-download-idempotency-key', requestKey)
  if (Number.isFinite(Number(object.size))) headers.set('content-length', String(object.size))
  if (object.httpEtag) headers.set('etag', object.httpEtag)
  if (object.uploaded instanceof Date) headers.set('last-modified', object.uploaded.toUTCString())

  return new Response(object.body, { status: 200, headers })
}

function parseCsvRows(csv) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(value.trim())
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index += 1
      row.push(value.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }

  row.push(value.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/:$/, '').trim()
}

export function normalizeSocialUrl(value, provider) {
  const field = {
    instagram: 'instagramUrl',
    spotify: 'spotifyUrl',
    appleMusic: 'appleMusicUrl',
    soundcloud: 'soundcloudUrl',
  }[provider]
  return field ? normalizeArtistLink(value, field) : ''
}

export function parseFeaturedArtistsCsv(csv) {
  const rows = parseCsvRows(csv)
  const headerRowIndex = rows.findIndex((row) => normalizeHeader(row[0] || '') === 'artist')
  if (headerRowIndex < 0) return []

  const headers = rows[headerRowIndex].map(normalizeHeader)
  const artistIndex = headers.indexOf('artist')
  const instagramIndex = Math.max(headers.indexOf('insta'), headers.indexOf('socials'))
  const spotifyIndex = Math.max(headers.indexOf('spotify'), headers.indexOf('music'))
  const appleMusicIndex = headers.indexOf('apple')
  const soundcloudIndex = Math.max(headers.indexOf('sc'), headers.indexOf('soundcloud'))

  return rows
    .slice(headerRowIndex + 1)
    .map((row) => ({
      name: row[artistIndex]?.trim() || '',
      socialHref: normalizeSocialUrl(row[instagramIndex] || '', 'instagram'),
      musicHref: normalizeSocialUrl(row[spotifyIndex] || '', 'spotify'),
      appleMusicHref: normalizeSocialUrl(row[appleMusicIndex] || '', 'appleMusic'),
      soundcloudHref: normalizeSocialUrl(row[soundcloudIndex] || '', 'soundcloud'),
    }))
    .filter((artist) => artist.name)
}

export function normalizeFeaturedArtists(artists) {
  if (!Array.isArray(artists)) return []

  return artists
    .map((artist) => ({
      name: validateArtistName(String(artist?.name || '')),
      socialHref: normalizeSocialUrl(String(artist?.socialHref || ''), 'instagram'),
      musicHref: normalizeSocialUrl(String(artist?.musicHref || ''), 'spotify'),
      appleMusicHref: normalizeSocialUrl(String(artist?.appleMusicHref || ''), 'appleMusic'),
      soundcloudHref: normalizeSocialUrl(String(artist?.soundcloudHref || ''), 'soundcloud'),
      submissionId: UUID_PATTERN.test(String(artist?.submissionId || ''))
        ? String(artist.submissionId).toLowerCase()
        : '',
    }))
    .filter((artist) => artist.name)
}

export function selectWeeklyArtist(artists, date, startDate) {
  if (!artists.length) return null
  const elapsedWeeks = Math.floor(
    (date.getTime() - startDate.getTime()) / (7 * DAY_IN_MILLISECONDS),
  )
  const scheduleIndex = Math.min(artists.length - 1, Math.max(0, elapsedWeeks))
  return { ...artists[scheduleIndex], scheduleIndex }
}

export function buildPublicWeeklySchedule(artists, currentScheduleIndex) {
  return artists.map((artist, scheduleIndex) => ({
    name: artist.name,
    scheduleIndex,
    status: scheduleIndex < currentScheduleIndex
      ? 'past'
      : scheduleIndex === currentScheduleIndex
        ? 'current'
        : 'future',
  }))
}

export function publicWeeklyArtist(artist) {
  if (!artist) return null
  return {
    name: artist.name,
    socialHref: artist.socialHref || '',
    musicHref: artist.musicHref || '',
    appleMusicHref: artist.appleMusicHref || '',
    soundcloudHref: artist.soundcloudHref || '',
    scheduleIndex: artist.scheduleIndex,
  }
}

function validateArtistName(value) {
  const name = value.trim().replace(/\s+/g, ' ')
  return name.length >= 2 && name.length <= 80 ? name : ''
}

export function validateSubmissionFields(fields) {
  const artistName = validateArtistName(String(fields.artistName || ''))
  const linkFields = ['instagramUrl', 'spotifyUrl', 'appleMusicUrl', 'soundcloudUrl']
  const values = Object.fromEntries(linkFields.map((field) => [
    field,
    normalizeArtistLink(String(fields[field] || ''), field),
  ]))
  const errors = {}

  if (!artistName) errors.artistName = 'Enter an artist name between 2 and 80 characters.'
  let populated = false
  for (const field of linkFields) {
    const input = String(fields[field] || '').trim()
    populated ||= Boolean(input)
    if (input && !values[field]) {
      errors[field] = `Enter a valid ${field
        .replace('Url', '')
        .replace('appleMusic', 'Apple Music')
        .replace('soundcloud', 'SoundCloud')
        .replace('instagram', 'Instagram')
        .replace('spotify', 'Spotify')} artist URL.`
    }
  }
  if (!populated) errors.links = 'Add at least one valid artist link.'

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: { artistName, ...values },
  }
}

function mp3FrameLength(bytes, offset) {
  if (offset + 3 >= bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
    return 0
  }

  const versionBits = (bytes[offset + 1] >> 3) & 0x03
  const layerBits = (bytes[offset + 1] >> 1) & 0x03
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03
  if (versionBits === 0x01 || layerBits !== 0x01 || bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 0x03) {
    return 0
  }

  const mpeg1 = versionBits === 0x03
  const bitrateTable = mpeg1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  const sampleRateTable = versionBits === 0x03
    ? [44100, 48000, 32000]
    : versionBits === 0x02
      ? [22050, 24000, 16000]
      : [11025, 12000, 8000]
  const bitrate = bitrateTable[bitrateIndex]
  const sampleRate = sampleRateTable[sampleRateIndex]
  const padding = (bytes[offset + 2] >> 1) & 0x01
  return Math.floor((mpeg1 ? 144000 : 72000) * bitrate / sampleRate) + padding
}

export function hasConsecutiveMp3Frames(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return false
  const maxStart = Math.min(1024, bytes.length - 4)

  for (let offset = 0; offset <= maxStart; offset += 1) {
    const frameLength = mp3FrameLength(bytes, offset)
    if (frameLength && mp3FrameLength(bytes, offset + frameLength)) return true
  }

  return false
}

export async function validateMp3File(file) {
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer())
  let audioOffset = 0

  if (header.length >= 10 && header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
    if ([header[6], header[7], header[8], header[9]].some((byte) => byte > 0x7f)) return false
    const tagSize = (header[6] << 21) | (header[7] << 14) | (header[8] << 7) | header[9]
    audioOffset = 10 + tagSize + (header[5] & 0x10 ? 10 : 0)
  }

  if (audioOffset >= file.size) return false
  const probe = new Uint8Array(await file.slice(audioOffset, audioOffset + 4096).arrayBuffer())
  return hasConsecutiveMp3Frames(probe)
}

function cleanTrackTitle(filename) {
  return filename
    .replace(/\.mp3$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
    .slice(0, 120)
}

function safeObjectFilename(filename) {
  const stem = filename
    .replace(/\.mp3$/i, '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80)
  return `${stem || 'song'}.mp3`
}

async function fingerprintRequest(request, env) {
  const address = request.headers.get('CF-Connecting-IP') || 'local'
  const salt = env.SUBMISSION_HASH_SALT || 'crash-beats-submissions-v1'
  const bytes = new TextEncoder().encode(`${salt}:${address}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY || !token || token.length > 2048) return false
  const body = new FormData()
  body.append('secret', env.TURNSTILE_SECRET_KEY)
  body.append('response', token)
  const address = request.headers.get('CF-Connecting-IP')
  if (address) body.append('remoteip', address)

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  })
  if (!response.ok) return false
  const result = await response.json()
  return result.success === true &&
    result.action === 'weekly_submission' &&
    result.hostname === new URL(request.url).hostname
}

async function loadWeeklySchedule(env) {
  let artists = []

  if (env.GOOGLE_SHEETS_WEBHOOK_URL) {
    try {
      const webhookUrl = new URL(env.GOOGLE_SHEETS_WEBHOOK_URL)
      if (env.GOOGLE_SHEETS_WEBHOOK_SECRET) {
        webhookUrl.searchParams.set('secret', env.GOOGLE_SHEETS_WEBHOOK_SECRET)
      }
      const response = await fetch(webhookUrl.href, {
        cf: { cacheTtl: 300, cacheEverything: true },
      })
      if (!response.ok) throw new Error(`Sheet webhook returned ${response.status}`)
      const result = await response.json()
      if (!result?.ok) throw new Error('Sheet webhook returned an invalid response')
      artists = normalizeFeaturedArtists(result.artists)
    } catch (error) {
      console.error('Could not read the weekly schedule through Apps Script', error)
    }
  }

  if (!artists.length && env.WEEKLY_SHEET_TRUSTED === 'true' && env.WEEKLY_SHEET_CSV_URL) {
    const response = await fetch(env.WEEKLY_SHEET_CSV_URL, {
      cf: { cacheTtl: 300, cacheEverything: true },
    })
    if (!response.ok) throw new Error(`Weekly sheet returned ${response.status}`)
    artists = parseFeaturedArtistsCsv(await response.text())
  }

  if (!artists.length) artists = FALLBACK_WEEKLY_ARTISTS

  return {
    artists,
    artist: selectWeeklyArtist(
      artists,
      new Date(),
      new Date(env.WEEKLY_START_DATE || '2026-08-24T00:00:00Z'),
    ),
  }
}

function mapCatalogRows(rows) {
  const mixtapeMap = new Map()
  for (const row of rows) {
    if (!mixtapeMap.has(row.mixtape_id)) {
      mixtapeMap.set(row.mixtape_id, {
        id: row.mixtape_id,
        title: row.mixtape_title,
        subtitle: row.mixtape_subtitle,
        catalog: row.catalog,
        side: row.side,
        accent: row.accent,
        accent2: row.accent2,
        ink: row.ink,
        tracks: [],
      })
    }
    if (!row.track_id) continue
    mixtapeMap.get(row.mixtape_id).tracks.push({
      id: row.track_id,
      title: row.track_title,
      credit: row.credit,
      src: `/api/audio/${encodeURIComponent(row.track_id)}`,
    })
  }
  return [...mixtapeMap.values()]
}

async function handleCatalog(env) {
  const { results } = await env.DB.prepare(
    `SELECT
      m.id AS mixtape_id, m.title AS mixtape_title, m.subtitle AS mixtape_subtitle,
      m.catalog, m.side, m.accent, m.accent2, m.ink,
      t.id AS track_id, t.title AS track_title, t.credit
    FROM mixtapes m
    LEFT JOIN tracks t ON t.mixtape_id = m.id AND t.is_published = 1
    WHERE m.is_published = 1
    ORDER BY m.sort_order, t.sort_order`,
  ).all()

  return json({ mixtapes: mapCatalogRows(results) }, {
    headers: { 'cache-control': 'public, max-age=60, s-maxage=300' },
  })
}

async function findSubmissionForArtist(env, artist) {
  if (!artist.submissionId) return null
  return env.DB.prepare(
    `SELECT id
     FROM artist_submissions
     WHERE id = ?1
       AND lower(artist_name) = lower(?2)
      AND instagram_url = ?3
      AND spotify_url = ?4
      AND apple_music_url = ?5
      AND soundcloud_url = ?6
       AND status IN ('pending', 'featured')
     LIMIT 1`,
  )
    .bind(
      artist.submissionId,
      artist.name,
      normalizeSocialUrl(artist.socialHref, 'instagram'),
      normalizeSocialUrl(artist.musicHref, 'spotify'),
      normalizeSocialUrl(artist.appleMusicHref, 'appleMusic'),
      normalizeSocialUrl(artist.soundcloudHref, 'soundcloud'),
    )
    .first()
}

async function handleWeekly(env) {
  const { artist, artists } = await loadWeeklySchedule(env)
  if (!artist) return json({ error: 'No weekly artist is configured.' }, { status: 404 })

  const trustedSchedule = env.WEEKLY_SHEET_TRUSTED === 'true' || Boolean(
    env.GOOGLE_SHEETS_WEBHOOK_URL && env.GOOGLE_SHEETS_WEBHOOK_SECRET,
  )
  const submission = trustedSchedule
    ? await findSubmissionForArtist(env, artist)
    : null
  let tracks = []

  if (submission) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE artist_submissions
         SET status = 'featured', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1`,
      ).bind(submission.id),
      env.DB.prepare(
        `UPDATE submission_tracks SET is_published = 1 WHERE submission_id = ?1`,
      ).bind(submission.id),
    ])

    const result = await env.DB.prepare(
      `SELECT id, title FROM submission_tracks
       WHERE submission_id = ?1 AND is_published = 1
       ORDER BY created_at`,
    ).bind(submission.id).all()
    tracks = result.results.map((track) => ({
      id: track.id,
      title: track.title,
      credit: artist.name,
      src: `/api/audio/${encodeURIComponent(track.id)}`,
    }))
  }

  if (!tracks.length) {
    const result = await env.DB.prepare(
      `SELECT id, title, credit FROM tracks
       WHERE is_published = 1 AND lower(featured_artist) = lower(?1)
       ORDER BY sort_order`,
    ).bind(artist.name).all()
    tracks = result.results.map((track) => ({
      id: track.id,
      title: track.title,
      credit: track.credit,
      src: `/api/audio/${encodeURIComponent(track.id)}`,
    }))
  }

  return json({
    artist: publicWeeklyArtist(artist),
    schedule: buildPublicWeeklySchedule(artists, artist.scheduleIndex),
    currentScheduleIndex: artist.scheduleIndex,
    mixtape: {
      id: 'crash-weekly',
      title: 'Crash Weekly',
      subtitle: `Artist of the week · ${artist.name}`,
      catalog: `CW-${String(artist.scheduleIndex + 1).padStart(3, '0')}`,
      side: 'W',
      accent: '#ff4ecb',
      accent2: '#53f4ff',
      ink: '#241039',
      isWeekly: true,
      artist: artist.name,
      tracks,
      socials: [
        { id: 'instagram', label: `${artist.name} on Instagram`, shortLabel: 'IG', href: artist.socialHref },
        { id: 'spotify', label: `${artist.name} on Spotify`, shortLabel: 'SP', href: artist.musicHref },
      ],
    },
  }, { headers: { 'cache-control': 'public, max-age=60, s-maxage=300' } })
}

async function getAudioRecord(env, id) {
  return env.DB.prepare(
    `SELECT object_key, mime_type, byte_size, 'catalog' AS source FROM tracks
     WHERE id = ?1 AND is_published = 1
     UNION ALL
     SELECT st.object_key, st.mime_type, st.byte_size, 'submission' AS source
     FROM submission_tracks st
     JOIN artist_submissions s ON s.id = st.submission_id
     WHERE st.id = ?1 AND st.is_published = 1 AND s.status = 'featured'
     UNION ALL
     SELECT preview_object_key, 'audio/mpeg', preview_byte_size, 'store' AS source
     FROM store_beats WHERE 'store-' || id = ?1 AND is_published = 1 AND deleted_at IS NULL
     LIMIT 1`,
  ).bind(id).first()
}

export function parseByteRange(value, size) {
  if (!value) return undefined
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return undefined
  if (!Number.isSafeInteger(size) || size <= 0) return null

  if (!match[1]) {
    const requested = Number(match[2])
    if (!Number.isFinite(requested) || requested <= 0) return null
    const length = Math.min(Number.isSafeInteger(requested) ? requested : size, size)
    return { offset: size - length, length }
  }

  const offset = Number(match[1])
  if (!Number.isSafeInteger(offset) || offset >= size) return null
  if (!match[2]) return { offset, length: size - offset }

  const requestedEnd = Number(match[2])
  if (!Number.isFinite(requestedEnd) || requestedEnd < offset) return null
  const end = Number.isSafeInteger(requestedEnd) ? Math.min(requestedEnd, size - 1) : size - 1
  return { offset, length: end - offset + 1 }
}

export function ifRangeMatches(value, object) {
  const validator = String(value || '').trim()
  if (!validator || validator.startsWith('W/')) return false
  if (validator.startsWith('"')) return validator === object.httpEtag

  const validatorTime = Date.parse(validator)
  const uploadedTime = new Date(object.uploaded).getTime()
  if (!Number.isFinite(validatorTime) || !Number.isFinite(uploadedTime)) return false
  return Math.floor(uploadedTime / 1000) <= Math.floor(validatorTime / 1000)
}

function etagListMatches(value, httpEtag, weak) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => {
      if (tag === '*') return true
      if (!weak && tag.startsWith('W/')) return false
      return (weak ? tag.replace(/^W\//, '') : tag) === httpEtag
    })
}

export function audioPreconditionStatus(headers, object) {
  const ifMatch = headers.get('if-match')
  if (ifMatch && !etagListMatches(ifMatch, object.httpEtag, false)) return 412

  const uploadedTime = new Date(object.uploaded).getTime()
  const ifUnmodifiedSince = headers.get('if-unmodified-since')
  if (!ifMatch && ifUnmodifiedSince) {
    const validatorTime = Date.parse(ifUnmodifiedSince)
    if (Number.isFinite(validatorTime) && Math.floor(uploadedTime / 1000) > Math.floor(validatorTime / 1000)) {
      return 412
    }
  }

  const ifNoneMatch = headers.get('if-none-match')
  if (ifNoneMatch && etagListMatches(ifNoneMatch, object.httpEtag, true)) return 304

  const ifModifiedSince = headers.get('if-modified-since')
  if (!ifNoneMatch && ifModifiedSince) {
    const validatorTime = Date.parse(ifModifiedSince)
    if (Number.isFinite(validatorTime) && Math.floor(uploadedTime / 1000) <= Math.floor(validatorTime / 1000)) {
      return 304
    }
  }

  return 0
}

function audioResponseHeaders(record, object) {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('content-type', record.mime_type || 'audio/mpeg')
  headers.set('accept-ranges', 'bytes')
  headers.set('etag', object.httpEtag)
  headers.set('last-modified', object.uploaded.toUTCString())
  headers.set(
    'cache-control',
    record.source === 'submission' ? 'private, no-store' : 'public, max-age=31536000, immutable',
  )
  return headers
}

async function handleAudio(request, env, id) {
  const record = await getAudioRecord(env, id)
  if (!record) return new Response('Track not found', { status: 404 })

  const rangeHeader = request.headers.get('range')
  const ifRange = request.headers.get('if-range')
  const hasPreconditions = ['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since']
    .some((name) => request.headers.has(name))
  let metadata = null
  let range

  if (hasPreconditions || (rangeHeader && ifRange)) {
    metadata = await env.AUDIO.head(record.object_key)
    if (!metadata) return new Response('Audio object not found', { status: 404 })
    const preconditionStatus = audioPreconditionStatus(request.headers, metadata)
    if (preconditionStatus) {
      return new Response(null, {
        status: preconditionStatus,
        headers: audioResponseHeaders(record, metadata),
      })
    }
  }

  if (!ifRange || (metadata && ifRangeMatches(ifRange, metadata))) {
    range = parseByteRange(rangeHeader, metadata?.size ?? Number(record.byte_size))
  }

  if (range === null) {
    const size = metadata?.size ?? Number(record.byte_size)
    return new Response(null, {
      status: 416,
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes */${size}`,
        'cache-control': 'no-store',
      },
    })
  }

  const options = {}
  if (range) options.range = range
  const object = await env.AUDIO.get(record.object_key, options)
  if (!object) return new Response('Audio object not found', { status: 404 })

  const headers = audioResponseHeaders(record, object)

  let status = 200
  if (range && object.range) {
    const offset = object.range.offset ?? object.size - object.range.length
    const length = object.range.length ?? object.size - offset
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    headers.set('content-length', String(length))
    status = 206
  } else {
    headers.set('content-length', String(object.size))
  }

  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers })
}

async function handleSubmissionMedia(request, env, submissionId, trackId) {
  if (!await verifyMediaUrl(request.url, env.GOOGLE_SHEETS_WEBHOOK_SECRET)) {
    return new Response('Not found', { status: 404 })
  }

  const track = await env.DB.prepare(
    `SELECT st.object_key, st.mime_type, st.original_filename
     FROM submission_tracks st
     WHERE st.id = ?1 AND st.submission_id = ?2
     LIMIT 1`,
  ).bind(trackId, submissionId).first()
  if (!track) return new Response('Not found', { status: 404 })

  const object = await env.AUDIO.get(track.object_key)
  if (!object) return new Response('Not found', { status: 404 })
  const headers = new Headers()
  object.writeHttpMetadata?.(headers)
  headers.set('content-type', track.mime_type || 'audio/mpeg')
  headers.set('content-disposition', makeDownloadDisposition(String(track.original_filename || '').replace(/\.mp3$/i, ''), trackId))
  headers.set('cache-control', 'private, no-store')
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers })
}

async function syncSubmissionToSheet(env, submissionId) {
  if (!env.GOOGLE_SHEETS_WEBHOOK_URL || !env.GOOGLE_SHEETS_WEBHOOK_SECRET) return false

  const submission = await env.DB.prepare(
    `SELECT id, artist_name, instagram_url, spotify_url, apple_music_url, soundcloud_url, created_at
     FROM artist_submissions WHERE id = ?1`,
  ).bind(submissionId).first()
  if (!submission) return false

  const tracks = await env.DB.prepare(
    `SELECT id, title, original_filename FROM submission_tracks
     WHERE submission_id = ?1 ORDER BY created_at`,
  ).bind(submissionId).all()

  try {
    const response = await fetch(env.GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: env.GOOGLE_SHEETS_WEBHOOK_SECRET,
        submissionId,
        artistName: submission.artist_name,
        instagramUrl: submission.instagram_url,
        spotifyUrl: submission.spotify_url,
        appleMusicUrl: submission.apple_music_url,
        soundcloudUrl: submission.soundcloud_url,
        submittedAt: submission.created_at,
        songs: await Promise.all(tracks.results.map(async (track) => ({
          ...track,
          mediaUrl: await signMediaUrl(`${env.BETTER_AUTH_URL || 'https://crash-beats.com'}/api/submissions/${encodeURIComponent(submissionId)}/tracks/${encodeURIComponent(track.id)}`, env.GOOGLE_SHEETS_WEBHOOK_SECRET),
        }))),
      }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.ok) {
      const detail = result?.error ? `: ${String(result.error).slice(0, 240)}` : ''
      throw new Error(`Sheet webhook returned ${response.status}${detail}`)
    }

    await env.DB.prepare(
      `UPDATE artist_submissions
       SET sheet_sync_status = 'synced', sheet_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           sheet_sync_attempts = sheet_sync_attempts + 1, sheet_sync_error = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?1`,
    ).bind(submissionId).run()
    return true
  } catch (error) {
    await env.DB.prepare(
      `UPDATE artist_submissions
       SET sheet_sync_status = 'failed', sheet_sync_attempts = sheet_sync_attempts + 1,
           sheet_sync_error = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?1`,
    ).bind(submissionId, String(error.message || error).slice(0, 500)).run()
    return false
  }
}

async function reserveSubmissionStorage(env, id, byteSize, fingerprint) {
  const configuredBudget = Number(env.R2_STORAGE_BUDGET_BYTES)
  const storageBudget = Number.isFinite(configuredBudget) && configuredBudget > 0
    ? Math.min(configuredBudget, MAX_R2_STORAGE_BYTES)
    : MAX_R2_STORAGE_BYTES
  const result = await env.DB.prepare(
    `INSERT INTO audio_storage_reservations
       (id, byte_size, client_fingerprint, purpose)
     SELECT ?1, ?2, ?3, 'submission'
     WHERE (
       (SELECT COALESCE(SUM(byte_size), 0) FROM tracks) +
       (SELECT COALESCE(SUM(byte_size), 0) FROM submission_tracks) +
       (SELECT COALESCE(SUM(preview_byte_size + full_byte_size), 0) FROM store_beats) +
       (SELECT COALESCE(SUM(byte_size), 0) FROM audio_storage_reservations) + ?2
     ) <= ?4
     AND (
       (SELECT COUNT(*) FROM artist_submissions
        WHERE client_fingerprint = ?3
          AND julianday(created_at) >= julianday('now', '-1 day')) +
       (SELECT COUNT(*) FROM audio_storage_reservations
        WHERE client_fingerprint = ?3 AND purpose = 'submission'
          AND julianday(created_at) >= julianday('now', '-1 day'))
     ) < ?5`,
  ).bind(id, byteSize, fingerprint, storageBudget, MAX_DAILY_SUBMISSIONS).run()

  if (Number(result.meta?.changes || 0) === 1) return { reserved: true }

  const reason = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM artist_submissions
        WHERE client_fingerprint = ?1
          AND julianday(created_at) >= julianday('now', '-1 day')) +
       (SELECT COUNT(*) FROM audio_storage_reservations
        WHERE client_fingerprint = ?1 AND purpose = 'submission'
          AND julianday(created_at) >= julianday('now', '-1 day')) AS recent_count`,
  ).bind(fingerprint).first()
  return { reserved: false, rateLimited: Number(reason?.recent_count || 0) >= MAX_DAILY_SUBMISSIONS }
}

async function releaseStorageReservation(env, id) {
  await env.DB.prepare('DELETE FROM audio_storage_reservations WHERE id = ?1').bind(id).run()
}

async function cleanupObjects(env, keys) {
  const results = await Promise.allSettled(keys.map((key) => env.AUDIO.delete(key)))
  return results.every((result) => result.status === 'fulfilled')
}

async function handleSubmission(request, env, ctx) {
  if (!mutationOriginIsAllowed(request)) return invalidOriginResponse()
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_REQUEST_BYTES) {
    return json({ error: 'The total upload must be under 62 MB.' }, { status: 413 })
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return json({ error: 'Submit the artist form with MP3 files.' }, { status: 415 })
  }

  let form
  try {
    const body = await readLimitedBody(request, MAX_REQUEST_BYTES)
    form = await new Response(body, { headers: { 'content-type': contentType } }).formData()
  } catch (error) {
    return json({ error: error.status === 413 ? 'The total upload must be under 62 MB.' : 'The upload form is malformed.' }, {
      status: error.status === 413 ? 413 : 400,
    })
  }
  if (String(form.get('website') || '').trim()) {
    return json({ ok: true, submissionId: crypto.randomUUID() }, { status: 201 })
  }

  const validation = validateSubmissionFields({
    artistName: form.get('artistName'),
    instagramUrl: form.get('instagramUrl'),
    spotifyUrl: form.get('spotifyUrl'),
    appleMusicUrl: form.get('appleMusicUrl'),
    soundcloudUrl: form.get('soundcloudUrl'),
  })
  if (!validation.valid) return json({ error: 'Check the highlighted fields.', fields: validation.errors }, { status: 400 })
  if (form.get('rightsConfirmed') !== 'yes') {
    return json({ error: 'Confirm that you have permission to submit these songs.' }, { status: 400 })
  }

  const songs = form.getAll('songs').filter((entry) => entry instanceof File && entry.size)
  if (!songs.length || songs.length > MAX_SONGS) {
    return json({ error: `Upload between 1 and ${MAX_SONGS} MP3 songs.` }, { status: 400 })
  }
  for (const song of songs) {
    if (!/\.mp3$/i.test(song.name) || !['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(song.type || 'application/octet-stream')) {
      return json({ error: `${song.name} is not an MP3 file.` }, { status: 400 })
    }
    if (song.size > MAX_SONG_BYTES) {
      return json({ error: `${song.name} is larger than 20 MB.` }, { status: 413 })
    }
    if (!await validateMp3File(song)) {
      return json({ error: `${song.name} does not contain valid MP3 audio.` }, { status: 400 })
    }
  }

  if (!await verifyTurnstile(request, env, String(form.get('turnstileToken') || ''))) {
    return json({ error: 'Complete the security check and try again.' }, { status: 400 })
  }

  const incomingBytes = songs.reduce((total, song) => total + song.size, 0)
  const fingerprint = await fingerprintRequest(request, env)
  const submissionId = crypto.randomUUID()
  const reservation = await reserveSubmissionStorage(env, submissionId, incomingBytes, fingerprint)
  if (!reservation.reserved && reservation.rateLimited) {
    return json({ error: 'Submission limit reached. Please try again tomorrow.' }, { status: 429 })
  }
  if (!reservation.reserved) {
    return json(
      { error: 'Weekly submissions are temporarily full. Please try again later.' },
      { status: 507 },
    )
  }

  const uploadedKeys = []
  const trackRecords = []

  try {
    for (const song of songs) {
      const trackId = crypto.randomUUID()
      const filename = safeObjectFilename(song.name)
      const objectKey = `submissions/${submissionId}/${trackId}-${filename}`
      await env.AUDIO.put(objectKey, song.stream(), {
        httpMetadata: {
          contentType: 'audio/mpeg',
          cacheControl: 'private, no-store',
        },
        customMetadata: { submissionId, trackId },
      })
      uploadedKeys.push(objectKey)
      trackRecords.push({
        id: trackId,
        title: cleanTrackTitle(song.name),
        originalFilename: song.name.slice(0, 240),
        objectKey,
        size: song.size,
      })
    }

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO artist_submissions
          (id, artist_name, instagram_url, spotify_url, apple_music_url, soundcloud_url,
           client_fingerprint)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(
        submissionId,
        validation.values.artistName,
        validation.values.instagramUrl,
        validation.values.spotifyUrl,
        validation.values.appleMusicUrl,
        validation.values.soundcloudUrl,
        fingerprint,
      ),
      ...trackRecords.map((track) =>
        env.DB.prepare(
          `INSERT INTO submission_tracks
            (id, submission_id, title, original_filename, object_key, mime_type, byte_size)
           VALUES (?1, ?2, ?3, ?4, ?5, 'audio/mpeg', ?6)`,
        ).bind(
          track.id,
          submissionId,
          track.title,
          track.originalFilename,
          track.objectKey,
          track.size,
        ),
      ),
      env.DB.prepare('DELETE FROM audio_storage_reservations WHERE id = ?1').bind(submissionId),
    ])
  } catch (error) {
    const cleaned = await cleanupObjects(env, uploadedKeys)
    if (cleaned) await releaseStorageReservation(env, submissionId)
    throw error
  }

  const sheetSyncQueued = Boolean(env.GOOGLE_SHEETS_WEBHOOK_URL && env.GOOGLE_SHEETS_WEBHOOK_SECRET)
  if (sheetSyncQueued) {
    const syncWork = syncSubmissionToSheet(env, submissionId).catch((error) => {
      console.error('Could not queue the submission for Google Sheets', error)
      return false
    })
    if (ctx?.waitUntil) ctx.waitUntil(syncWork)
    else await syncWork
  }
  return json({ ok: true, submissionId, sheetSyncQueued }, { status: 201 })
}

async function retrySheetSync(env) {
  if (!env.GOOGLE_SHEETS_WEBHOOK_URL || !env.GOOGLE_SHEETS_WEBHOOK_SECRET) return
  const { results } = await env.DB.prepare(
    `SELECT id FROM artist_submissions
     WHERE sheet_sync_status IN ('pending', 'failed') AND sheet_sync_attempts < 10
     ORDER BY created_at LIMIT 20`,
  ).all()
  for (const submission of results) {
    await syncSubmissionToSheet(env, submission.id)
  }
}

export async function handleEmailConfirmation(request, env, verify = false) {
  if (!mutationOriginIsAllowed(request)) return invalidOriginResponse()
  if (!emailVerificationIsAvailable(env)) {
    return json({ error: 'Email confirmation is temporarily unavailable.' }, { status: 503 })
  }
  const session = await authenticateRequest(request, env)
  if (!session?.user?.id) return unauthenticatedResponse()
  if (session.user.emailVerified) return json({ status: true, alreadyVerified: true })
  let payload
  try {
    payload = JSON.parse(await (await readLimitedBody(request, 1024)).text() || '{}')
  } catch (error) {
    return json({ error: 'Invalid confirmation request.' }, { status: error.status || 400 })
  }
  if (verify && !/^\d{6}$/.test(String(payload?.otp || ''))) {
    return json({ error: 'Enter the six-digit code from your email.' }, { status: 400 })
  }
  const email = session.user.email.toLowerCase()
  // Key by address, so account recreation cannot reset mail/guessing limits.
  const rateLimit = await enforceUserRateLimit(env, email, verify ? 'email-code-check' : 'email-code-send', verify ? 5 : 1, 60)
  if (rateLimit) return rateLimit
  if (!verify) {
    const hourlyLimit = await enforceUserRateLimit(env, email, 'email-code-hour', 5, 3600)
    if (hourlyLimit) return hourlyLimit
  }
  const path = verify ? 'verify-email' : 'send-verification-otp'
  const headers = new Headers(request.headers)
  headers.set('content-type', 'application/json')
  headers.delete('content-length')
  // The signed-in identity supplies the recipient; ignore client-supplied addresses/types.
  return createAuth(env).handler(new Request(new URL(`/api/auth/email-otp/${path}`, request.url), {
    method: 'POST', headers,
    body: JSON.stringify(verify ? { email, otp: payload.otp } : { email, type: 'email-verification' }),
  }))
}

function storeBeatView(row) {
  return {
    id: row.id,
    title: row.title,
    priceCents: row.price_cents,
    licenseName: row.license_name,
    licenseTerms: row.license_terms,
    previewUrl: `/api/audio/store-${encodeURIComponent(row.id)}`,
  }
}

async function handleStoreCatalog(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, price_cents, license_name, license_terms FROM store_beats
     WHERE is_published = 1 AND deleted_at IS NULL ORDER BY sort_order, created_at`,
  ).all()
  return json({ beats: results.map(storeBeatView), checkoutReady: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) })
}

function verifiedBuyer(session) {
  const user = session?.user
  return user?.id && user.emailVerified === true
    ? String(user.email || '').trim().toLowerCase() : ''
}

export async function handleStoreCheckout(request, env, authenticate = authenticateRequest) {
  if (!mutationOriginIsAllowed(request)) return invalidOriginResponse()
  const session = await authenticate(request, env)
  const email = verifiedBuyer(session)
  if (!email) return json({ error: 'Sign in and verify your email before buying a beat.' }, { status: 401 })
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: 'Checkout is not ready yet.' }, { status: 503 })
  }
  const limited = await enforceUserRateLimit(env, session.user.id, 'beat-checkout', 10, 60)
  if (limited) return limited
  let payload
  try {
    payload = JSON.parse(await (await readLimitedBody(request, 1024)).text() || '{}')
  } catch {
    return json({ error: 'Invalid checkout request.' }, { status: 400 })
  }
  if (typeof payload.beatId !== 'string' || !UUID_PATTERN.test(payload.beatId) || payload.acceptedLicense !== true) {
    return json({ error: 'Choose a beat and accept its license terms.' }, { status: 400 })
  }
  const beat = await env.DB.prepare(
    `SELECT id, title, price_cents, license_name, license_terms FROM store_beats
     WHERE id = ?1 AND is_published = 1 AND deleted_at IS NULL AND price_cents IS NOT NULL`,
  ).bind(payload.beatId).first()
  if (!beat) return json({ error: 'Beat not found.' }, { status: 404 })
  const order = {
    id: crypto.randomUUID(),
    beat_id: beat.id,
    buyer_email: email,
    amount_cents: beat.price_cents,
    license_name: beat.license_name,
    license_terms: beat.license_terms,
  }
  await env.DB.prepare(
    `INSERT INTO beat_orders (id, beat_id, buyer_email, amount_cents, license_name, license_terms)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(order.id, order.beat_id, order.buyer_email, order.amount_cents, order.license_name, order.license_terms).run()
  let checkout
  try {
    const origin = new URL(env.BETTER_AUTH_URL || request.url).origin
    checkout = await createCheckoutSession(env, order, beat, origin)
  } catch (error) {
    await env.DB.prepare("UPDATE beat_orders SET status = 'failed' WHERE id = ?1 AND status = 'pending'")
      .bind(order.id).run()
    console.error('Stripe Checkout session failed', error)
    return json({ error: 'Checkout could not start. Please try again.' }, { status: 502 })
  }
  await env.DB.prepare('UPDATE beat_orders SET stripe_session_id = ?2 WHERE id = ?1')
    .bind(order.id, checkout.id).run()
  return json({ url: checkout.url })
}

export async function handleStripeWebhook(request, env, now = Date.now()) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Not found' }, { status: 404 })
  let body
  try {
    body = new Uint8Array(await (await readLimitedBody(request, 64 * 1024)).arrayBuffer())
  } catch {
    return json({ error: 'Invalid webhook body.' }, { status: 400 })
  }
  if (!await verifyStripeSignature(body, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET, now)) {
    return json({ error: 'Invalid webhook signature.' }, { status: 400 })
  }
  let event
  try {
    event = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return json({ error: 'Invalid webhook JSON.' }, { status: 400 })
  }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    return json({ received: true })
  }
  const checkout = event.data?.object
  const orderId = checkout?.metadata?.order_id
  if (!UUID_PATTERN.test(orderId || '') || checkout.client_reference_id !== orderId ||
      checkout.mode !== 'payment' || checkout.currency !== 'usd') {
    return json({ error: 'Invalid checkout details.' }, { status: 400 })
  }
  if (checkout.payment_status !== 'paid') return json({ received: true })
  const order = await env.DB.prepare(
    'SELECT id, amount_cents, stripe_session_id, status FROM beat_orders WHERE id = ?1',
  ).bind(orderId).first()
  if (!order || Number(order.amount_cents) !== checkout.amount_total ||
      (order.stripe_session_id && order.stripe_session_id !== checkout.id)) {
    return json({ error: 'Checkout did not match the order.' }, { status: 400 })
  }
  await env.DB.prepare(
    `UPDATE beat_orders SET status = 'paid', stripe_session_id = ?2,
       paid_at = COALESCE(paid_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     WHERE id = ?1 AND status = 'pending' AND (stripe_session_id = ?2 OR stripe_session_id IS NULL)`,
  ).bind(orderId, checkout.id).run()
  return json({ received: true })
}

export async function handleStorePurchases(request, env, orderId, download = false, authenticate = authenticateRequest) {
  const session = await authenticate(request, env)
  const email = verifiedBuyer(session)
  if (!email) return json({ error: 'Sign in with your verified email to access purchases.' }, { status: 401 })
  const limited = await enforceUserRateLimit(env, session.user.id, 'beat-purchases', 120, 60)
  if (limited) return limited
  if (!orderId) {
    const { results } = await env.DB.prepare(
      `SELECT o.id, o.beat_id, b.title, o.license_name, o.status, o.created_at
       FROM beat_orders o JOIN store_beats b ON b.id = o.beat_id
       WHERE o.buyer_email = ?1 AND o.status = 'paid' ORDER BY o.created_at DESC`,
    ).bind(email).all()
    return json({ purchases: results.map((row) => ({
      orderId: row.id, beatId: row.beat_id, title: row.title, licenseName: row.license_name,
    })) })
  }
  if (!UUID_PATTERN.test(orderId)) return json({ error: 'Order not found.' }, { status: 404 })
  const order = await env.DB.prepare(
    `SELECT o.id, o.status, o.license_name, o.license_terms,
       b.title, b.full_object_key, b.full_mime_type, b.full_filename
     FROM beat_orders o JOIN store_beats b ON b.id = o.beat_id
     WHERE o.id = ?1 AND o.buyer_email = ?2`,
  ).bind(orderId, email).first()
  if (!order) return json({ error: 'Order not found.' }, { status: 404 })
  if (!download) return json({
    orderId: order.id, status: order.status, title: order.title,
    licenseName: order.license_name, licenseTerms: order.license_terms,
  })
  if (order.status !== 'paid') return json({ error: 'Payment is still processing.' }, { status: 402 })
  const object = await env.AUDIO.get(order.full_object_key)
  if (!object) return json({ error: 'Beat file is temporarily unavailable.' }, { status: 404 })
  const extension = order.full_mime_type === 'audio/wav' ? 'wav' : 'mp3'
  const headers = new Headers({
    'content-type': order.full_mime_type,
    'content-disposition': makeDownloadDisposition(order.title, order.id, extension),
    'cache-control': 'private, no-store',
    'content-length': String(object.size),
  })
  return new Response(request.method === 'HEAD' ? null : object.body, { headers })
}

async function validWaveFile(file) {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  return header.length === 12 &&
    String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...header.slice(8, 12)) === 'WAVE'
}

export async function handleStoreManagement(request, env, authenticate = authenticateRequest) {
  if (request.method !== 'GET' && !mutationOriginIsAllowed(request)) return invalidOriginResponse()
  const session = await authenticate(request, env)
  if (!isCatalogEditor(session?.user)) return json({ error: 'Not found' }, { status: 404 })
  const limited = await enforceUserRateLimit(env, session.user.id, 'store-management', 30, 60)
  if (limited) return limited
  const url = new URL(request.url)
  if (url.pathname === '/api/manage/store-beats' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, title, price_cents, license_name, license_terms, is_published,
         full_filename, created_at FROM store_beats
       WHERE deleted_at IS NULL ORDER BY sort_order, created_at`,
    ).all()
    return json({ beats: results.map((row) => ({
      ...storeBeatView(row),
      published: Boolean(row.is_published), fullFilename: row.full_filename,
    })), checkoutReady: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) })
  }
  if (url.pathname === '/api/manage/store-beats' && request.method === 'POST') {
    if (Number(request.headers.get('content-length') || 0) > MAX_STORE_REQUEST_BYTES) {
      return json({ error: 'The upload is too large.' }, { status: 413 })
    }
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return json({ error: 'Upload a preview and a full beat file.' }, { status: 415 })
    }
    let form
    try {
      const body = await readLimitedBody(request, MAX_STORE_REQUEST_BYTES)
      form = await new Response(body, { headers: { 'content-type': contentType } }).formData()
    } catch (error) {
      return json({ error: 'The upload is too large or malformed.' }, { status: error.status === 413 ? 413 : 400 })
    }
    const title = String(form.get('title') || '').trim().replace(/\s+/g, ' ')
    const preview = form.get('preview')
    const full = form.get('full')
    if (title.length < 2 || title.length > 120 || form.get('rightsConfirmed') !== 'yes') {
      return json({ error: 'Enter a title and confirm you have rights to sell this beat.' }, { status: 400 })
    }
    if (!(preview instanceof File) || !preview.size || preview.size > MAX_STORE_PREVIEW_BYTES ||
        !/\.mp3$/i.test(preview.name) || !await validateMp3File(preview)) {
      return json({ error: 'Choose a valid preview MP3 under 10 MB.' }, { status: 400 })
    }
    const isWav = full instanceof File && /\.wav$/i.test(full.name)
    if (!(full instanceof File) || !full.size || full.size > MAX_STORE_FILE_BYTES ||
        !(isWav ? await validWaveFile(full) : /\.mp3$/i.test(full.name) && await validateMp3File(full))) {
      return json({ error: 'Choose a valid full MP3 or WAV under 40 MB.' }, { status: 400 })
    }
    const beatId = crypto.randomUUID()
    const previewKey = `store/${beatId}/preview.mp3`
    const fullKey = `store/${beatId}/full.${isWav ? 'wav' : 'mp3'}`
    const totalSize = preview.size + full.size
    const configuredBudget = Number(env.R2_STORAGE_BUDGET_BYTES)
    const storageBudget = Number.isFinite(configuredBudget) && configuredBudget > 0
      ? Math.min(configuredBudget, MAX_R2_STORAGE_BYTES) : MAX_R2_STORAGE_BYTES
    const reserved = await env.DB.prepare(
      `INSERT INTO audio_storage_reservations (id, byte_size, purpose)
       SELECT ?1, ?2, 'catalog_import' WHERE
         (SELECT COALESCE(SUM(byte_size), 0) FROM tracks) +
         (SELECT COALESCE(SUM(byte_size), 0) FROM submission_tracks) +
         (SELECT COALESCE(SUM(preview_byte_size + full_byte_size), 0) FROM store_beats) +
         (SELECT COALESCE(SUM(byte_size), 0) FROM audio_storage_reservations) + ?2 <= ?3`,
    ).bind(beatId, totalSize, storageBudget).run()
    if (Number(reserved.meta?.changes || 0) !== 1) {
      return json({ error: 'Audio storage is full.' }, { status: 507 })
    }
    const uploaded = []
    try {
      await env.AUDIO.put(previewKey, preview.stream(), {
        httpMetadata: { contentType: 'audio/mpeg', cacheControl: 'public, max-age=3600' },
      })
      uploaded.push(previewKey)
      await env.AUDIO.put(fullKey, full.stream(), {
        httpMetadata: { contentType: isWav ? 'audio/wav' : 'audio/mpeg', cacheControl: 'private, no-store' },
      })
      uploaded.push(fullKey)
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO store_beats
           (id, title, preview_object_key, preview_byte_size, full_object_key,
            full_filename, full_mime_type, full_byte_size,
            sort_order)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
             (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM store_beats))`,
        ).bind(beatId, title, previewKey, preview.size, fullKey,
          full.name.slice(0, 240), isWav ? 'audio/wav' : 'audio/mpeg', full.size),
        env.DB.prepare('DELETE FROM audio_storage_reservations WHERE id = ?1').bind(beatId),
      ])
    } catch (error) {
      const cleaned = await cleanupObjects(env, [previewKey, fullKey])
      if (cleaned) await releaseStorageReservation(env, beatId)
      throw error
    }
    return json({ ok: true, beatId }, { status: 201 })
  }
  const edit = /^\/api\/manage\/store-beats\/([^/]+)$/.exec(url.pathname)
  if (!edit || !['PATCH', 'DELETE'].includes(request.method) || !UUID_PATTERN.test(edit[1])) {
    return json({ error: 'Not found' }, { status: 404 })
  }
  if (request.method === 'DELETE') {
    const beat = await env.DB.prepare(
      `SELECT id, preview_object_key, full_object_key,
         EXISTS(SELECT 1 FROM beat_orders WHERE beat_id = store_beats.id) AS has_orders
       FROM store_beats WHERE id = ?1 AND deleted_at IS NULL`,
    ).bind(edit[1]).first()
    if (!beat) return json({ error: 'Beat not found.' }, { status: 404 })
    if (beat.has_orders) {
      await env.DB.prepare(
        `UPDATE store_beats SET is_published = 0,
           deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1`,
      ).bind(edit[1]).run()
      return json({ ok: true, archived: true })
    }
    await env.DB.prepare('DELETE FROM store_beats WHERE id = ?1').bind(edit[1]).run()
    const cleaned = await cleanupObjects(env, [beat.preview_object_key, beat.full_object_key])
    if (!cleaned) console.warn('Deleted beat left an orphaned audio object', edit[1])
    return json({ ok: true, archived: false })
  }
  let changes
  try {
    changes = JSON.parse(await (await readLimitedBody(request, 16 * 1024)).text() || '{}')
  } catch {
    return json({ error: 'Invalid beat settings.' }, { status: 400 })
  }
  const title = String(changes.title || '').trim().replace(/\s+/g, ' ')
  const price = Number(changes.priceCents)
  const licenseName = String(changes.licenseName || '').trim()
  const licenseTerms = String(changes.licenseTerms || '').trim()
  const published = changes.published === true
  if (title.length < 2 || title.length > 120 || !Number.isSafeInteger(price) || price < 100 || price > 1000000 ||
      licenseName.length < 2 || licenseName.length > 80 || licenseTerms.length < 20 || licenseTerms.length > 10000 ||
      (published && (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET))) {
    return json({ error: 'Set a title, price, license name and terms before publishing; Stripe must also be connected.' }, { status: 400 })
  }
  const result = await env.DB.prepare(
    `UPDATE store_beats SET title = ?2, price_cents = ?3, license_name = ?4,
       license_terms = ?5, is_published = ?6,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1 AND deleted_at IS NULL`,
  ).bind(edit[1], title, price, licenseName, licenseTerms, published ? 1 : 0).run()
  if (Number(result.meta?.changes || 0) !== 1) return json({ error: 'Beat not found.' }, { status: 404 })
  return json({ ok: true })
}

export async function handleMixtapeManagement(request, env, authenticate = authenticateRequest) {
  if (request.method !== 'GET' && !mutationOriginIsAllowed(request)) return invalidOriginResponse()
  const session = await authenticate(request, env)
  const user = session?.user
  if (!isCatalogEditor(user)) {
    return json({ error: 'Not found' }, { status: 404 })
  }

  const limited = await enforceUserRateLimit(env, user.id, 'mixtape-management', 60, 60)
  if (limited) return limited
  const url = new URL(request.url)
  if (url.pathname === '/api/manage/mixtapes' && request.method === 'GET') {
    const response = await handleCatalog(env)
    response.headers.set('cache-control', 'no-store')
    return response
  }

  const upload = /^\/api\/manage\/mixtapes\/([^/]+)\/tracks$/.exec(url.pathname)
  if (upload && request.method === 'POST') {
    const mixtapeId = decodeURIComponent(upload[1])
    const mixtape = await env.DB.prepare('SELECT id FROM mixtapes WHERE id = ?1 AND is_published = 1')
      .bind(mixtapeId).first()
    if (!mixtape) return json({ error: 'Mixtape not found.' }, { status: 404 })
    if (Number(request.headers.get('content-length') || 0) > MAX_SONG_BYTES + 16384) {
      return json({ error: 'The MP3 must be under 20 MB.' }, { status: 413 })
    }
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return json({ error: 'Choose an MP3 file.' }, { status: 415 })
    }
    let form
    try {
      const body = await readLimitedBody(request, MAX_SONG_BYTES + 16384)
      form = await new Response(body, { headers: { 'content-type': contentType } }).formData()
    } catch (error) {
      return json({ error: 'The upload is too large or malformed.' }, { status: error.status === 413 ? 413 : 400 })
    }
    const song = form.get('song')
    if (!(song instanceof File) || !song.size || song.size > MAX_SONG_BYTES ||
        !/\.mp3$/i.test(song.name) ||
        !['', 'audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(song.type) ||
        !await validateMp3File(song)) {
      return json({ error: 'Choose a valid MP3 file under 20 MB.' }, { status: 400 })
    }
    const configuredBudget = Number(env.R2_STORAGE_BUDGET_BYTES)
    const storageBudget = Number.isFinite(configuredBudget) && configuredBudget > 0
      ? Math.min(configuredBudget, MAX_R2_STORAGE_BYTES) : MAX_R2_STORAGE_BYTES
    const trackId = crypto.randomUUID()
    const objectKey = `catalog/${trackId}-${safeObjectFilename(song.name)}`
    const reservation = await env.DB.prepare(
      `INSERT INTO audio_storage_reservations (id, byte_size, purpose)
       SELECT ?1, ?2, 'catalog_import' WHERE
         (SELECT COALESCE(SUM(byte_size), 0) FROM tracks) +
         (SELECT COALESCE(SUM(byte_size), 0) FROM submission_tracks) +
         (SELECT COALESCE(SUM(preview_byte_size + full_byte_size), 0) FROM store_beats) +
         (SELECT COALESCE(SUM(byte_size), 0) FROM audio_storage_reservations) + ?2 <= ?3`,
    ).bind(trackId, song.size, storageBudget).run()
    if (Number(reservation.meta?.changes || 0) !== 1) {
      return json({ error: 'Audio storage is full.' }, { status: 507 })
    }
    try {
      await env.AUDIO.put(objectKey, song.stream(), {
        httpMetadata: { contentType: 'audio/mpeg', cacheControl: 'public, max-age=3600' },
      })
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO tracks (id, mixtape_id, title, object_key, byte_size, sort_order, is_published)
           VALUES (?1, ?2, ?3, ?4, ?5,
             (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tracks WHERE mixtape_id = ?2), 1)`,
        ).bind(trackId, mixtapeId, cleanTrackTitle(song.name), objectKey, song.size),
        env.DB.prepare('DELETE FROM audio_storage_reservations WHERE id = ?1').bind(trackId),
      ])
    } catch (error) {
      const cleaned = await cleanupObjects(env, [objectKey])
      if (cleaned) await releaseStorageReservation(env, trackId)
      throw error
    }
    return json({ ok: true, trackId }, { status: 201 })
  }

  const trackRoute = /^\/api\/manage\/tracks\/([^/]+)$/.exec(url.pathname)
  if (!trackRoute || !['PATCH', 'DELETE'].includes(request.method)) {
    return json({ error: 'Not found' }, { status: 404 })
  }
  const trackId = decodeURIComponent(trackRoute[1])
  const track = await env.DB.prepare(
    'SELECT id, mixtape_id, sort_order, object_key FROM tracks WHERE id = ?1 AND is_published = 1',
  ).bind(trackId).first()
  if (!track) return json({ error: 'Song not found.' }, { status: 404 })

  if (request.method === 'DELETE') {
    // Keep the row for historical download-credit references, while removing playback and storage.
    await env.DB.prepare(
      `UPDATE tracks SET is_published = 0,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1`,
    ).bind(trackId).run()
    try {
      await env.AUDIO.delete(track.object_key)
      await env.DB.prepare('UPDATE tracks SET byte_size = 0 WHERE id = ?1').bind(trackId).run()
    } catch (error) {
      // Keep the recorded bytes in the storage budget if object cleanup fails.
      console.error('Could not remove deleted mixtape audio', error)
    }
    return json({ ok: true })
  }

  let payload
  try {
    payload = JSON.parse(await (await readLimitedBody(request, 2048)).text() || '{}')
  } catch {
    return json({ error: 'Invalid move request.' }, { status: 400 })
  }
  const targetId = String(payload.mixtapeId || '')
  if (targetId && targetId !== track.mixtape_id) {
    const destination = await env.DB.prepare('SELECT id FROM mixtapes WHERE id = ?1 AND is_published = 1')
      .bind(targetId).first()
    if (!destination) return json({ error: 'Mixtape not found.' }, { status: 404 })
    await env.DB.prepare(
      `UPDATE tracks SET mixtape_id = ?2,
         sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tracks WHERE mixtape_id = ?2),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1`,
    ).bind(trackId, targetId).run()
    return json({ ok: true })
  }
  if (!['up', 'down'].includes(payload.direction)) {
    return json({ error: 'Choose a destination or direction.' }, { status: 400 })
  }
  const adjacent = await env.DB.prepare(
    `SELECT id, sort_order FROM tracks WHERE mixtape_id = ?1 AND is_published = 1
       AND (sort_order ${payload.direction === 'up' ? '<' : '>'} ?2
         OR (sort_order = ?2 AND id ${payload.direction === 'up' ? '<' : '>'} ?3))
       ORDER BY sort_order ${payload.direction === 'up' ? 'DESC' : 'ASC'},
         id ${payload.direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
  ).bind(track.mixtape_id, track.sort_order, trackId).first()
  if (!adjacent) return json({ ok: true })
  await env.DB.prepare(
    `UPDATE tracks SET sort_order = CASE id
       WHEN ?1 THEN ?3 WHEN ?2 THEN ?4 END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id IN (?1, ?2)`,
  ).bind(trackId, adjacent.id, adjacent.sort_order, track.sort_order).run()
  return json({ ok: true })
}

function isCatalogEditor(user) {
  return Boolean(user?.id && user.emailVerified === true &&
    MIXTAPE_EDITORS.has(String(user.email || '').trim().toLowerCase()))
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url)

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true })
  }
  if (url.pathname === '/api/auth/config' && request.method === 'GET') {
    const providers = getAuthProviderAvailability(env)
    return json({
      email: true,
      emailVerification: emailVerificationIsAvailable(env),
      google: providers.google,
      providers,
    })
  }
  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    const providers = getAuthProviderAvailability(env)
    if (!authRequestIsAllowed(request, providers)) {
      return json({ error: 'Not found' }, { status: 404 })
    }
    if (request.method === 'POST') {
      let body
      try {
        body = await readLimitedBody(request, 16 * 1024)
      } catch (error) {
        return json({ error: 'The account request is too large.' }, { status: error.status || 400 })
      }
      request = new Request(request.url, { method: request.method, headers: request.headers, body })
    }
    return createAuth(env).handler(request)
  }
  if (url.pathname === '/api/account' && request.method === 'GET') {
    return handleAccount(request, env)
  }
  if (url.pathname === '/api/account/email-code' && request.method === 'POST') {
    return handleEmailConfirmation(request, env)
  }
  if (url.pathname === '/api/account/confirm-email' && request.method === 'POST') {
    return handleEmailConfirmation(request, env, true)
  }
  if (url.pathname === '/api/credits' && request.method === 'GET') {
    return handleCredits(request, env)
  }
  if (url.pathname === '/api/credits/weekly-claim' && request.method === 'POST') {
    return handleWeeklyCreditClaim(request, env)
  }
  if (url.pathname.startsWith('/api/download/') && request.method === 'POST') {
    return handleDownload(
      request,
      env,
      decodeURIComponent(url.pathname.slice('/api/download/'.length)),
    )
  }
  if (url.pathname === '/api/catalog' && request.method === 'GET') {
    return handleCatalog(env)
  }
  if (url.pathname === '/api/store/beats' && request.method === 'GET') {
    return handleStoreCatalog(env)
  }
  if (url.pathname === '/api/store/checkout' && request.method === 'POST') {
    return handleStoreCheckout(request, env)
  }
  if (url.pathname === '/api/store/webhook' && request.method === 'POST') {
    return handleStripeWebhook(request, env)
  }
  if (url.pathname === '/api/store/purchases' && request.method === 'GET') {
    return handleStorePurchases(request, env)
  }
  const orderRoute = /^\/api\/store\/orders\/([^/]+)(\/download)?$/.exec(url.pathname)
  if (orderRoute && ['GET', 'HEAD'].includes(request.method)) {
    return handleStorePurchases(request, env, orderRoute[1], Boolean(orderRoute[2]))
  }
  if (url.pathname.startsWith('/api/manage/store-beats')) {
    return handleStoreManagement(request, env)
  }
  if (url.pathname.startsWith('/api/manage/')) {
    return handleMixtapeManagement(request, env)
  }
  if (url.pathname === '/api/weekly' && request.method === 'GET') {
    return handleWeekly(env)
  }
  if (url.pathname === '/api/submissions' && request.method === 'POST') {
    return handleSubmission(request, env, ctx)
  }
  const submissionMediaMatch = /^\/api\/submissions\/([^/]+)\/tracks\/([^/]+)$/.exec(url.pathname)
  if (submissionMediaMatch && ['GET', 'HEAD'].includes(request.method)) {
    return handleSubmissionMedia(request, env, submissionMediaMatch[1], submissionMediaMatch[2])
  }
  if (url.pathname.startsWith('/api/audio/') && ['GET', 'HEAD'].includes(request.method)) {
    return handleAudio(request, env, decodeURIComponent(url.pathname.slice('/api/audio/'.length)))
  }
  if (url.pathname.startsWith('/api/')) {
    return json({ error: 'Not found' }, { status: 404 })
  }

  return env.ASSETS.fetch(request)
}

export default {
  async fetch(request, env, ctx) {
    try {
      return secureResponse(await handleRequest(request, env, ctx), request)
    } catch (error) {
      console.error('Crash Beats Worker error', error)
      return secureResponse(json({ error: 'Something went wrong. Please try again.' }, { status: 500 }), request)
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(retrySheetSync(env))
  },
}
