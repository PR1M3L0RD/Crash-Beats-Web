import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthProviderAvailability } from './auth.js'
import {
  authRequestIsAllowed,
  getMondayUtcWeekKey,
  handleAccount,
  handleCredits,
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
const accountCreditIdentityMigration = readFileSync(
  new URL('../migrations/0006_account_credit_identity.sql', import.meta.url),
  'utf8',
)
const emailCreditLedgerMigration = readFileSync(
  new URL('../migrations/0007_email_credit_ledger.sql', import.meta.url),
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
      database.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.all())
        database.exec('COMMIT')
        return results
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
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
    emailVerified: true,
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
    expect(authRequestIsAllowed(new Request('https://crash.test/api/auth/update-user', {
      method: 'POST',
    }))).toBe(true)
    expect(authRequestIsAllowed(new Request('https://crash.test/api/auth/delete-user', {
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
    database.exec(accountCreditIdentityMigration)
    database.exec(emailCreditLedgerMigration)
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
      emailVerification: false,
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

    const updateResponse = await authRequest('/api/auth/update-user', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ name: 'Updated Listener' }),
    })
    expect(updateResponse.status).toBe(200)

    const deleteResponse = await authRequest('/api/auth/delete-user', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({}),
    })
    expect(deleteResponse.status).toBe(200)
    expect(database.prepare('SELECT COUNT(*) AS count FROM "rateLimit"').get().count).toBeGreaterThan(0)
  })

  async function confirmationFixture(email = 'confirmation@example.com') {
    const messages = []
    const delivery = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(url).toBe('https://api.resend.com/emails')
      messages.push(JSON.parse(init.body))
      return Response.json({ id: 'test-email' })
    })
    const authEnv = { ...env, BETTER_AUTH_SECRET: 'a-test-secret-with-more-than-thirty-two-characters', BETTER_AUTH_URL: 'https://crash.test', RESEND_API_KEY: 'test-resend-key', AUTH_EMAIL_FROM: 'Crash Beats <accounts@crash.test>' }
    let cookie = ''
    const request = (path, body, headers = {}) => handleRequest(new Request(`https://crash.test${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin: 'https://crash.test', 'cf-connecting-ip': '127.0.0.8', 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), authEnv)
    const signup = await request('/api/auth/sign-up/email', { name: 'Code Listener', email, password: 'a-long-test-password' })
    expect(signup.status).toBe(200)
    cookie = signup.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ')
    return { request, messages, delivery, authEnv, code: () => messages.at(-1).text.match(/code is (\d{6})/)[1] }
  }

  it('confirms a recreated email with a real code and restores credits without replaying rewards', async () => {
    await handleWeeklyCreditClaim(new Request('https://crash.test/api/credits/weekly-claim', { method: 'POST' }), env, authenticatedAs(user))
    database.prepare('DELETE FROM "user" WHERE id = ?').run(user.id)
    const fixture = await confirmationFixture(user.email)
    try {
      expect((await fixture.request('/api/credits')).status).toBe(403)
      const sent = await fixture.request('/api/account/email-code', { email: 'attacker@example.com', type: 'sign-in' })
      expect(sent.status).toBe(200)
      expect(fixture.messages[0].to).toEqual([user.email])
      const code = fixture.code()
      const stored = database.prepare('SELECT value FROM verification').all()
      expect(stored.length).toBeGreaterThan(0)
      expect(stored.every((row) => !row.value.includes(code))).toBe(true)
      expect((await fixture.request('/api/account/confirm-email', { otp: code })).status).toBe(200)
      const account = await (await fixture.request('/api/account')).json()
      expect(account.user.emailVerified).toBe(true)
      expect(account.credits).toBe(2)
      const reward = await (await fixture.request('/api/credits/weekly-claim', {})).json()
      expect(reward).toMatchObject({ awarded: false, credits: 2 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM verification').get().count).toBe(0)
      expect((await fixture.request('/api/account/confirm-email', { otp: code })).status).toBe(200)
      expect(database.prepare('SELECT COUNT(*) AS count FROM credit_events').get().count).toBe(1)
    } finally { fixture.delivery.mockRestore() }
  })

  it('rejects wrong, exhausted, expired, and replayed codes', async () => {
    const fixture = await confirmationFixture()
    try {
      expect((await fixture.request('/api/account/email-code', {})).status).toBe(200)
      const code = fixture.code()
      const wrong = code === '000000' ? '111111' : '000000'
      for (let attempt = 0; attempt < 5; attempt += 1) {
        // Reset transport throttling to exercise the independent per-code attempt limit.
        database.exec('DELETE FROM "rateLimit"')
        expect((await fixture.request('/api/account/confirm-email', { otp: wrong })).status).toBe(400)
      }
      database.exec('DELETE FROM "rateLimit"')
      expect((await fixture.request('/api/account/confirm-email', { otp: code })).status).toBe(403)
      database.exec('DELETE FROM "rateLimit"')
      await fixture.request('/api/account/email-code', {})
      database.prepare('UPDATE verification SET expiresAt = ?').run(new Date(0).toISOString())
      expect((await fixture.request('/api/account/confirm-email', { otp: fixture.code() })).status).toBe(400)
      expect(database.prepare('SELECT emailVerified FROM "user" WHERE email = ?').get('confirmation@example.com').emailVerified).toBe(0)
    } finally { fixture.delivery.mockRestore() }
  })

  it('invalidates the previous code when a new code is requested', async () => {
    const fixture = await confirmationFixture()
    try {
      await fixture.request('/api/account/email-code', {})
      const original = fixture.code()
      database.exec('DELETE FROM "rateLimit"')
      await fixture.request('/api/account/email-code', {})
      const replacement = fixture.code()
      // Independent random codes can very rarely match; avoid a probabilistic assertion.
      if (original !== replacement) expect((await fixture.request('/api/account/confirm-email', { otp: original })).status).toBe(400)
      expect((await fixture.request('/api/account/confirm-email', { otp: replacement })).status).toBe(200)
    } finally { fixture.delivery.mockRestore() }
  })

  it('limits resends, binds confirmation to a session, and hides unused OTP endpoints', async () => {
    const fixture = await confirmationFixture()
    try {
      expect((await fixture.request('/api/account/email-code', {}, { cookie: '' })).status).toBe(401)
      expect((await fixture.request('/api/account/email-code', {}, { origin: 'https://evil.test' })).status).toBe(403)
      expect((await fixture.request('/api/auth/email-otp/send-verification-otp', {})).status).toBe(404)
      expect((await fixture.request('/api/auth/email-otp/get-verification-otp')).status).toBe(404)
      expect((await fixture.request('/api/auth/sign-in/email-otp', {})).status).toBe(404)
      expect((await fixture.request('/api/account/email-code', {})).status).toBe(200)
      const limited = await fixture.request('/api/account/email-code', {})
      expect(limited.status).toBe(429)
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(fixture.messages).toHaveLength(1)
      expect((await fixture.request('/api/account/confirm-email', { otp: '123' })).status).toBe(400)
    } finally { fixture.delivery.mockRestore() }
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

  it('does not replay a weekly reward after an account is recreated with the same email', async () => {
    const request = new Request('https://crash.test/api/credits/weekly-claim', {
      method: 'POST',
      headers: { origin: 'https://crash.test' },
    })
    const now = new Date('2026-08-27T23:59:59.000Z')
    await handleWeeklyCreditClaim(request, env, authenticatedAs(user), now)

    database.prepare('DELETE FROM "user" WHERE id = ?').run(user.id)
    const recreatedUser = insertUser(database, { id: 'user-2' })
    const recreated = await handleWeeklyCreditClaim(
      request,
      env,
      authenticatedAs(recreatedUser),
      now,
    )

    expect(await recreated.json()).toEqual({
      awarded: false,
      amount: 0,
      credits: 2,
      weekKey: '2026-08-24',
    })
  })

  it('rolls back the weekly claim if the credit ledger write fails', async () => {
    database.exec("CREATE TRIGGER fail_grant BEFORE INSERT ON credit_events BEGIN SELECT RAISE(ABORT, 'test failure'); END;")
    const request = new Request('https://crash.test/api/credits/weekly-claim', { method: 'POST' })
    await expect(handleWeeklyCreditClaim(request, env, authenticatedAs(user))).rejects.toThrow('test failure')
    expect(database.prepare('SELECT COUNT(*) AS count FROM account_credit_claims').get().count).toBe(0)
    database.exec('DROP TRIGGER fail_grant')
    expect((await (await handleWeeklyCreditClaim(request, env, authenticatedAs(user))).json()).awarded).toBe(true)
  })

  it('does not expose or spend deleted-account credits through an unverified replacement', async () => {
    const request = new Request('https://crash.test/api/credits/weekly-claim', { method: 'POST' })
    await handleWeeklyCreditClaim(request, env, authenticatedAs(user))
    database.prepare('DELETE FROM "user" WHERE id = ?').run(user.id)
    const replacement = insertUser(database, { id: 'replacement', emailVerified: false })
    const authenticate = authenticatedAs(replacement)
    const account = await handleAccount(new Request('https://crash.test/api/account'), env, authenticate)
    expect((await account.json()).credits).toBe(0)
    for (const response of [
      await handleCredits(new Request('https://crash.test/api/credits'), env, authenticate),
      await handleWeeklyCreditClaim(request, env, authenticate),
      await handleDownload(new Request('https://crash.test/api/download/track', { method: 'POST' }), env, 'track', authenticate),
    ]) {
      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe('EMAIL_VERIFICATION_REQUIRED')
    }
    expect(database.prepare('SELECT SUM(delta) AS balance FROM credit_events').get().balance).toBe(2)
  })

  it('allows a new unverified account to earn and read its own credits', async () => {
    const authenticate = authenticatedAs({ ...user, emailVerified: false })
    const response = await handleWeeklyCreditClaim(new Request('https://crash.test/api/credits/weekly-claim', { method: 'POST' }), env, authenticate)
    expect((await response.json()).credits).toBe(2)
    const credits = await handleCredits(new Request('https://crash.test/api/credits'), env, authenticate)
    expect((await credits.json()).credits).toBe(2)
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
