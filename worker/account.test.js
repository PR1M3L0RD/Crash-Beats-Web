import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAuthProviderAvailability } from './auth.js'
import {
  authRequestIsAllowed,
  getMondayUtcWeekKey,
  handleAccount,
  handleDownload,
  handleRequest,
  handleWeeklyCreditClaim,
  isInsufficientCreditsError,
  makeDownloadDisposition,
} from './index.js'

const initialMigration = readFileSync(
  new URL('../migrations/0001_initial.sql', import.meta.url),
  'utf8',
)
const accountMigration = readFileSync(
  new URL('../migrations/0003_auth_and_credits.sql', import.meta.url),
  'utf8',
)
const audioReservationMigration = readFileSync(
  new URL('../migrations/0002_audio_storage_reservations.sql', import.meta.url),
  'utf8',
)
const authRateLimitMigration = readFileSync(
  new URL('../migrations/0004_auth_rate_limit.sql', import.meta.url),
  'utf8',
)

function makeD1(database) {
  const d1 = {
    prepare(sql) {
      const statement = database.prepare(sql)
      let values = []

      return {
        bind(...nextValues) {
          values = nextValues
          return this
        },
        async first() {
          return statement.get(...values) ?? null
        },
        async run() {
          const result = statement.run(...values)
          return { meta: { changes: Number(result.changes) } }
        },
        async all() {
          const results = statement.all(...values)
          const meta = database.prepare(
            'SELECT changes() AS changes, last_insert_rowid() AS last_row_id',
          ).get()
          return { results, meta }
        },
      }
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.all()))
    },
    async exec(sql) {
      database.exec(sql)
      return { count: 1, duration: 0 }
    },
  }
  return d1
}

function authenticatedAs(user) {
  return async () => ({ user, session: { id: 'session-1', userId: user.id } })
}

function insertUser(database, user = {}) {
  const record = {
    id: 'user-1',
    name: 'Crash Listener',
    email: 'listener@example.com',
    ...user,
  }
  database.prepare(
    `INSERT INTO "user"
       (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(
    record.id,
    record.name,
    record.email,
    '2026-08-27T12:00:00.000Z',
    '2026-08-27T12:00:00.000Z',
  )
  return record
}

function insertTrack(database, { trackId = 'track-1', published = 1, mixtapePublished = 1 } = {}) {
  database.prepare(
    `INSERT INTO mixtapes
       (id, title, catalog, accent, accent2, ink, is_published)
     VALUES (?, 'Crash Tape', ?, '#111', '#222', '#fff', ?)`,
  ).run(`mixtape-${trackId}`, `CB-${trackId}`, mixtapePublished)
  database.prepare(
    `INSERT INTO tracks
       (id, mixtape_id, title, object_key, mime_type, byte_size, is_published)
     VALUES (?, ?, 'Night Drive', ?, 'audio/mpeg', 4, ?)`,
  ).run(trackId, `mixtape-${trackId}`, `catalog/${trackId}.mp3`, published)
}

describe('account and credit helpers', () => {
  it('uses Monday at 00:00 UTC as the weekly boundary', () => {
    expect(getMondayUtcWeekKey('2026-08-30T23:59:59.999Z')).toBe('2026-08-24')
    expect(getMondayUtcWeekKey('2026-08-31T00:00:00.000Z')).toBe('2026-08-31')
    expect(() => getMondayUtcWeekKey('not-a-date')).toThrow(TypeError)
  })

  it('only advertises fully configured social providers', () => {
    expect(getAuthProviderAvailability({
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    })).toEqual({ google: true })
  })

  it('allows only the auth endpoints used by the account UI', () => {
    expect(authRequestIsAllowed(new Request('https://crash.test/api/auth/get-session'))).toBe(true)
    expect(authRequestIsAllowed(new Request('https://crash.test/api/auth/sign-in/email', {
      method: 'POST',
    }))).toBe(true)
    expect(authRequestIsAllowed(
      new Request('https://crash.test/api/auth/callback/google'),
      { google: true },
    )).toBe(true)
    expect(authRequestIsAllowed(
      new Request('https://crash.test/api/auth/callback/google'),
      { google: false },
    )).toBe(false)
    expect(authRequestIsAllowed(new Request('https://crash.test/api/auth/not-a-route'))).toBe(false)
  })

  it('builds a safe attachment name and recognizes nested D1 trigger errors', () => {
    const disposition = makeDownloadDisposition('Nuit / été', 'track-1')
    expect(disposition).toContain('attachment;')
    expect(disposition).not.toContain('/')
    expect(disposition).toContain("filename*=UTF-8''Nuit%20%C3%A9t%C3%A9.mp3")
    expect(isInsufficientCreditsError(
      new Error('D1 failed', { cause: new Error('SQLITE_CONSTRAINT: insufficient_credits') }),
    )).toBe(true)
  })
})

describe('account and credit routes', () => {
  let database
  let env
  let user

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    database.exec(initialMigration)
    database.exec(audioReservationMigration)
    database.exec(accountMigration)
    database.exec(authRateLimitMigration)
    user = insertUser(database)
    env = {
      DB: makeD1(database),
      AUDIO: {
        async get(key) {
          return {
            body: new Uint8Array([0xff, 0xfb, 0x90, 0x64]),
            size: 4,
            httpEtag: '"audio-etag"',
            uploaded: new Date('2026-08-27T12:00:00.000Z'),
            writeHttpMetadata(headers) {
              headers.set('content-type', 'audio/mpeg')
            },
            key,
          }
        },
      },
    }
  })

  afterEach(() => database.close())

  it('returns auth availability without disclosing credential values', async () => {
    const response = await handleRequest(new Request('https://crash.test/api/auth/config'), {
      GOOGLE_CLIENT_ID: 'private-id',
      GOOGLE_CLIENT_SECRET: 'private-secret',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      email: true,
      google: true,
      providers: { google: true },
    })
  })

  it('rejects unknown auth paths before initializing Better Auth or writing rate-limit rows', async () => {
    const response = await handleRequest(
      new Request('https://crash.test/api/auth/unbounded-random-path'),
      {
        get DB() {
          throw new Error('Unknown auth routes must not touch D1')
        },
      },
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })

  it('runs a real Better Auth email session against the migration schema', async () => {
    const authEnv = {
      ...env,
      BETTER_AUTH_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
      BETTER_AUTH_URL: 'https://crash.test',
    }
    const authRequest = (path, init = {}) => handleRequest(new Request(`https://crash.test${path}`, {
      ...init,
      headers: {
        origin: 'https://crash.test',
        'cf-connecting-ip': '127.0.0.2',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    }), authEnv)

    const signUp = await authRequest('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Schema Listener',
        email: 'schema@example.com',
        password: 'correct horse battery staple',
      }),
    })
    expect(signUp.status).toBe(200)
    const cookie = (signUp.headers.getSetCookie?.() || [signUp.headers.get('set-cookie')])
      .filter(Boolean)
      .map((value) => value.split(';', 1)[0])
      .join('; ')
    expect(cookie).toContain('better-auth.session_token=')

    const sessionResponse = await authRequest('/api/auth/get-session', {
      headers: { cookie },
    })
    expect(sessionResponse.status).toBe(200)
    expect(await sessionResponse.json()).toMatchObject({
      user: { email: 'schema@example.com' },
    })

    const accountResponse = await authRequest('/api/account', {
      headers: { cookie },
    })
    expect(accountResponse.status).toBe(200)
    expect(await accountResponse.json()).toMatchObject({
      user: { email: 'schema@example.com' },
      credits: 0,
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM "rateLimit"').get().count).toBeGreaterThan(0)
  })

  it('starts a configured Google OAuth flow', async () => {
    const response = await handleRequest(new Request('https://crash.test/api/auth/sign-in/social', {
      method: 'POST',
      headers: {
        origin: 'https://crash.test',
        'content-type': 'application/json',
        'cf-connecting-ip': '127.0.0.3',
      },
      body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
    }), {
      ...env,
      BETTER_AUTH_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
      BETTER_AUTH_URL: 'https://crash.test',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(new URL(payload.url).hostname).toBe('accounts.google.com')
    expect(payload.redirect).toBe(true)
  })

  it('rejects protected routes before reading account or audio data', async () => {
    const protectedEnv = {
      get DB() {
        throw new Error('DB should not be read')
      },
      get AUDIO() {
        throw new Error('R2 should not be read')
      },
    }
    const noSession = async () => null

    const accountResponse = await handleAccount(
      new Request('https://crash.test/api/account'),
      protectedEnv,
      noSession,
    )
    const claimResponse = await handleWeeklyCreditClaim(
      new Request('https://crash.test/api/credits/weekly-claim', { method: 'POST' }),
      protectedEnv,
      noSession,
    )
    const downloadResponse = await handleDownload(
      new Request('https://crash.test/api/download/track-1', { method: 'POST' }),
      protectedEnv,
      'track-1',
      noSession,
    )

    expect(accountResponse.status).toBe(401)
    expect(claimResponse.status).toBe(401)
    expect(downloadResponse.status).toBe(401)
  })

  it('rejects cross-origin mutations before checking the session', async () => {
    let authenticationAttempted = false
    const response = await handleWeeklyCreditClaim(
      new Request('https://crash.test/api/credits/weekly-claim', {
        method: 'POST',
        headers: { origin: 'https://attacker.test' },
      }),
      {},
      async () => {
        authenticationAttempted = true
        return { user }
      },
    )

    expect(response.status).toBe(403)
    expect(authenticationAttempted).toBe(false)
  })

  it('awards exactly two credits once per server-computed week', async () => {
    const request = new Request('https://crash.test/api/credits/weekly-claim', {
      method: 'POST',
      headers: { origin: 'https://crash.test' },
    })
    const authenticate = authenticatedAs(user)
    const now = new Date('2026-08-27T23:59:59.000Z')

    const first = await handleWeeklyCreditClaim(request, env, authenticate, now)
    const duplicate = await handleWeeklyCreditClaim(request, env, authenticate, now)

    expect(await first.json()).toEqual({
      awarded: true,
      amount: 2,
      credits: 2,
      weekKey: '2026-08-24',
    })
    expect(await duplicate.json()).toEqual({
      awarded: false,
      amount: 0,
      credits: 2,
      weekKey: '2026-08-24',
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM credit_events').get().count).toBe(1)
  })

  it('rate-limits repeated weekly claim writes per account', async () => {
    const authenticate = authenticatedAs(user)
    const now = new Date('2026-08-27T12:00:00.000Z')
    const request = () => handleWeeklyCreditClaim(
      new Request('https://crash.test/api/credits/weekly-claim', { method: 'POST' }),
      env,
      authenticate,
      now,
    )

    const responses = []
    for (let attempt = 0; attempt < 13; attempt += 1) responses.push(await request())

    expect(responses.slice(0, 12).every((response) => response.status === 200)).toBe(true)
    expect(responses[12].status).toBe(429)
    expect(responses[12].headers.get('retry-after')).toBeTruthy()
    expect(database.prepare(
      'SELECT COALESCE(SUM(delta), 0) AS credits FROM credit_events WHERE user_id = ?',
    ).get(user.id).credits).toBe(2)
  })

  it('spends one credit per published catalog download and never goes negative', async () => {
    insertTrack(database)
    const authenticate = authenticatedAs(user)
    await handleWeeklyCreditClaim(
      new Request('https://crash.test/api/credits/weekly-claim', { method: 'POST' }),
      env,
      authenticate,
      new Date('2026-08-27T12:00:00.000Z'),
    )
    const download = () => handleDownload(
      new Request('https://crash.test/api/download/track-1', { method: 'POST' }),
      env,
      'track-1',
      authenticate,
    )

    const responses = await Promise.all([download(), download(), download()])
    const successful = responses.filter((response) => response.status === 200)
    const [denied] = responses.filter((response) => response.status === 402)

    expect(successful).toHaveLength(2)
    expect(successful.every((response) => response.headers.get('content-disposition')?.includes('attachment;'))).toBe(true)
    expect(successful.every((response) => Number(response.headers.get('x-credits-remaining')) >= 0)).toBe(true)
    expect(denied).toBeTruthy()
    expect(denied.status).toBe(402)
    expect(await denied.json()).toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      credits: 0,
    })
    expect(database.prepare(
      'SELECT COALESCE(SUM(delta), 0) AS credits FROM credit_events WHERE user_id = ?',
    ).get(user.id).credits).toBe(0)
  })

  it('does not spend credits on unpublished catalog records', async () => {
    insertTrack(database, { trackId: 'draft-track', published: 0 })
    const response = await handleDownload(
      new Request('https://crash.test/api/download/draft-track', { method: 'POST' }),
      env,
      'draft-track',
      authenticatedAs(user),
    )

    expect(response.status).toBe(404)
    expect(database.prepare('SELECT COUNT(*) AS count FROM credit_events').get().count).toBe(0)
  })

  it('never exposes a Weekly submission track through the catalog download route', async () => {
    database.prepare(
      `INSERT INTO artist_submissions
        (id, artist_name, instagram_url, spotify_url, status)
       VALUES ('submission-1', 'Weekly Artist', 'https://instagram.com/weekly',
         'https://open.spotify.com/artist/weekly', 'featured')`,
    ).run()
    database.prepare(
      `INSERT INTO submission_tracks
        (id, submission_id, title, original_filename, object_key, mime_type, byte_size, is_published)
       VALUES ('weekly-only-track', 'submission-1', 'Weekly Exclusive', 'exclusive.mp3',
         'submissions/exclusive.mp3', 'audio/mpeg', 4, 1)`,
    ).run()

    const response = await handleDownload(
      new Request('https://crash.test/api/download/weekly-only-track', { method: 'POST' }),
      env,
      'weekly-only-track',
      authenticatedAs(user),
    )

    expect(response.status).toBe(404)
    expect(database.prepare('SELECT COUNT(*) AS count FROM credit_events').get().count).toBe(0)
  })

  it('does not spend a credit when the R2 object is missing', async () => {
    insertTrack(database, { trackId: 'missing-audio' })
    const authenticate = authenticatedAs(user)
    await handleWeeklyCreditClaim(
      new Request('https://crash.test/api/credits/weekly-claim', { method: 'POST' }),
      env,
      authenticate,
      new Date('2026-08-27T12:00:00.000Z'),
    )
    env.AUDIO.get = async () => null

    const response = await handleDownload(
      new Request('https://crash.test/api/download/missing-audio', { method: 'POST' }),
      env,
      'missing-audio',
      authenticate,
    )

    expect(response.status).toBe(404)
    expect(database.prepare(
      'SELECT COALESCE(SUM(delta), 0) AS credits FROM credit_events WHERE user_id = ?',
    ).get(user.id).credits).toBe(2)
  })

  it('serves a same-key download retry without charging a second credit', async () => {
    insertTrack(database, { trackId: 'prelude-track' })
    insertTrack(database, { trackId: 'retry-track' })
    const authenticate = authenticatedAs(user)
    await handleWeeklyCreditClaim(
      new Request('https://crash.test/api/credits/weekly-claim', { method: 'POST' }),
      env,
      authenticate,
      new Date(),
    )
    const prelude = await handleDownload(
      new Request('https://crash.test/api/download/prelude-track', { method: 'POST' }),
      env,
      'prelude-track',
      authenticate,
    )
    expect(prelude.status).toBe(200)
    const requestKey = '8a1075d6-9b67-4c80-923c-69544fdf315f'
    const download = () => handleDownload(
      new Request('https://crash.test/api/download/retry-track', {
        method: 'POST',
        headers: { 'idempotency-key': requestKey },
      }),
      env,
      'retry-track',
      authenticate,
      new Date(),
    )

    const first = await download()
    const retry = await download()

    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(retry.headers.get('x-download-idempotency-key')).toBe(requestKey)
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM credit_events
       WHERE user_id = ? AND kind = 'download' AND reference_key = ?`,
    ).get(user.id, requestKey).count).toBe(1)
    expect(database.prepare(
      'SELECT COALESCE(SUM(delta), 0) AS credits FROM credit_events WHERE user_id = ?',
    ).get(user.id).credits).toBe(0)
  })
})
