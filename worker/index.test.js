import { describe, expect, it, vi } from 'vitest'
import {
  audioPreconditionStatus,
  buildPublicWeeklySchedule,
  hasConsecutiveMp3Frames,
  handleRequest,
  ifRangeMatches,
  normalizeFeaturedArtists,
  normalizeSocialUrl,
  parseByteRange,
  parseFeaturedArtistsCsv,
  publicWeeklyArtist,
  selectWeeklyArtist,
  validateMp3File,
  validateSubmissionFields,
} from './index'

describe('Worker weekly artist parsing', () => {
  it('reads the Featured A:C section from the live sheet layout', () => {
    const csv = [
      'Featured:,,,,,,,,Form entries:,,',
      'Artist:,Insta:,Spotify:,,,,,,Artist:,Insta:,Spotify:',
      'Big Slay,https://www.instagram.com/savi.global/?utm_source=test,https://open.spotify.com/artist/123?si=test,,,,,,,,',
    ].join('\n')

    expect(parseFeaturedArtistsCsv(csv)).toEqual([
      {
        name: 'Big Slay',
        socialHref: 'https://instagram.com/savi.global',
        musicHref: 'https://open.spotify.com/artist/123',
        appleMusicHref: '',
        soundcloudHref: '',
      },
    ])
  })

  it('holds on the final artist after the schedule ends', () => {
    const artists = [{ name: 'One' }, { name: 'Two' }]
    expect(
      selectWeeklyArtist(
        artists,
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-08-24T00:00:00Z'),
      ).name,
    ).toBe('Two')
  })

  it('validates and normalizes an Apps Script schedule response', () => {
    expect(normalizeFeaturedArtists([
      {
        name: '  Big Slay  ',
        socialHref: 'https://www.instagram.com/savi.global/?utm_source=test',
        musicHref: 'https://open.spotify.com/artist/123?si=test',
        submissionId: '123e4567-e89b-42d3-a456-426614174000',
      },
      { name: '', socialHref: 'https://instagram.com/empty' },
    ])).toEqual([
      {
        name: 'Big Slay',
        socialHref: 'https://instagram.com/savi.global',
        musicHref: 'https://open.spotify.com/artist/123',
        appleMusicHref: '',
        soundcloudHref: '',
        submissionId: '123e4567-e89b-42d3-a456-426614174000',
      },
    ])
  })

  it('reads multiple artists and every public link from Featured A:E', () => {
    const csv = [
      'Featured:,,,,,,,,Form entries:,,,,',
      'Artist:,Insta:,Spotify:,Apple:,SC:,,,,Artist:,Insta:,Spotify:,Apple:,SC:',
      'First Artist,https://instagram.com/first,https://open.spotify.com/artist/first,https://music.apple.com/us/artist/first/123,https://soundcloud.com/first,,,,,,,,',
      'Second Artist,https://instagram.com/second,https://open.spotify.com/artist/second,https://music.apple.com/us/artist/second/456,https://soundcloud.com/second,,,,,,,,',
    ].join('\n')

    expect(parseFeaturedArtistsCsv(csv)).toEqual([
      {
        name: 'First Artist',
        socialHref: 'https://instagram.com/first',
        musicHref: 'https://open.spotify.com/artist/first',
        appleMusicHref: 'https://music.apple.com/us/artist/first/123',
        soundcloudHref: 'https://soundcloud.com/first',
      },
      {
        name: 'Second Artist',
        socialHref: 'https://instagram.com/second',
        musicHref: 'https://open.spotify.com/artist/second',
        appleMusicHref: 'https://music.apple.com/us/artist/second/456',
        soundcloudHref: 'https://soundcloud.com/second',
      },
    ])
  })

  it('publishes the complete ordered schedule without private submission IDs', () => {
    const artists = [
      { name: 'Past Artist', submissionId: '123e4567-e89b-42d3-a456-426614174000' },
      { name: 'Current Artist', submissionId: '223e4567-e89b-42d3-a456-426614174000' },
      { name: 'Future Artist', submissionId: '323e4567-e89b-42d3-a456-426614174000' },
    ]

    expect(buildPublicWeeklySchedule(artists, 1)).toEqual([
      { name: 'Past Artist', scheduleIndex: 0, status: 'past' },
      { name: 'Current Artist', scheduleIndex: 1, status: 'current' },
      { name: 'Future Artist', scheduleIndex: 2, status: 'future' },
    ])
    expect(publicWeeklyArtist({
      ...artists[1],
      socialHref: 'https://instagram.com/current',
      scheduleIndex: 1,
    })).toEqual({
      name: 'Current Artist',
      socialHref: 'https://instagram.com/current',
      musicHref: '',
      appleMusicHref: '',
      soundcloudHref: '',
      scheduleIndex: 1,
    })
  })

  it('returns the full sanitized schedule from the weekly endpoint', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      artists: [
        { name: 'Past Artist', socialHref: 'https://instagram.com/past' },
        { name: 'Current Artist', musicHref: 'https://open.spotify.com/artist/current' },
        { name: 'Future Artist', appleMusicHref: 'https://music.apple.com/us/artist/future/123' },
      ],
    }), { headers: { 'content-type': 'application/json' } }))
    const statement = {
      bind() { return this },
      async all() { return { results: [] } },
    }

    try {
      const response = await handleRequest(
        new Request('https://crash-beats.com/api/weekly?week=2026-08-31'),
        {
          DB: { prepare: () => statement },
          GOOGLE_SHEETS_WEBHOOK_URL: 'https://script.google.com/macros/s/example/exec',
          GOOGLE_SHEETS_WEBHOOK_SECRET: 'sheet-secret',
          WEEKLY_START_DATE: '2026-08-24T00:00:00Z',
        },
        {},
      )
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.artist).toMatchObject({ name: 'Current Artist', scheduleIndex: 1 })
      expect(payload.artist).not.toHaveProperty('submissionId')
      expect(payload.currentScheduleIndex).toBe(1)
      expect(payload.schedule).toEqual([
        { name: 'Past Artist', scheduleIndex: 0, status: 'past' },
        { name: 'Current Artist', scheduleIndex: 1, status: 'current' },
        { name: 'Future Artist', scheduleIndex: 2, status: 'future' },
      ])
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock).toHaveBeenCalledWith(
        'https://script.google.com/macros/s/example/exec?secret=sheet-secret',
        { cf: { cacheTtl: 300, cacheEverything: true } },
      )
    } finally {
      fetchMock.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('Worker submission validation', () => {
  it('normalizes approved social hosts and strips tracking data', () => {
    expect(normalizeSocialUrl('https://www.instagram.com/test/?utm_source=foo', 'instagram')).toBe(
      'https://instagram.com/test',
    )
    expect(normalizeSocialUrl('https://evil.example/test', 'instagram')).toBe('')
  })

  it('requires an artist name plus at least one supported artist URL', () => {
    expect(validateSubmissionFields({
      artistName: '  New Artist ',
      instagramUrl: 'https://instagram.com/newartist',
    })).toEqual({
      valid: true,
      errors: {},
      values: {
        artistName: 'New Artist',
        instagramUrl: 'https://instagram.com/newartist',
        spotifyUrl: '',
        appleMusicUrl: '',
        soundcloudUrl: '',
      },
    })

    expect(validateSubmissionFields({
      artistName: 'Apple Artist',
      appleMusicUrl: 'https://music.apple.com/us/artist/apple-artist/123?uo=4',
    })).toMatchObject({
      valid: true,
      values: {
        instagramUrl: '',
        spotifyUrl: '',
        appleMusicUrl: 'https://music.apple.com/us/artist/apple-artist/123',
        soundcloudUrl: '',
      },
    })

    expect(validateSubmissionFields({ artistName: 'x' }).valid).toBe(false)
  })

  it('requires two structurally consecutive MPEG frames', () => {
    const frames = new Uint8Array(838)
    frames.set([0xff, 0xfb, 0x90, 0x64], 0)
    frames.set([0xff, 0xfb, 0x90, 0x64], 417)
    expect(hasConsecutiveMp3Frames(frames)).toBe(true)

    const singleFrame = new Uint8Array(838)
    singleFrame.set([0xff, 0xfb, 0x90, 0x64], 0)
    expect(hasConsecutiveMp3Frames(singleFrame)).toBe(false)
    expect(hasConsecutiveMp3Frames(new TextEncoder().encode('not really an mp3'))).toBe(false)
  })

  it('skips a valid ID3 tag before checking MPEG frames', async () => {
    const taggedFrames = new Uint8Array(848)
    taggedFrames.set([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0], 0)
    taggedFrames.set([0xff, 0xfb, 0x90, 0x64], 10)
    taggedFrames.set([0xff, 0xfb, 0x90, 0x64], 427)
    expect(await validateMp3File(new File([taggedFrames], 'track.mp3'))).toBe(true)
  })
})

describe('Worker audio delivery', () => {
  it('parses exact, open-ended, and suffix ranges', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({ offset: 0, length: 100 })
    expect(parseByteRange('bytes=900-', 1000)).toEqual({ offset: 900, length: 100 })
    expect(parseByteRange('bytes=-50', 1000)).toEqual({ offset: 950, length: 50 })
    expect(parseByteRange('bytes=1000-', 1000)).toBeNull()
  })

  it('ignores malformed and multi-range headers', () => {
    expect(parseByteRange('', 1000)).toBeUndefined()
    expect(parseByteRange('items=0-4', 1000)).toBeUndefined()
    expect(parseByteRange('bytes=0-1,4-5', 1000)).toBeUndefined()
  })

  it('matches only strong ETags or fresh HTTP dates for If-Range', () => {
    const object = { httpEtag: '"abc"', uploaded: new Date('2026-08-26T12:00:00Z') }
    expect(ifRangeMatches('"abc"', object)).toBe(true)
    expect(ifRangeMatches('W/"abc"', object)).toBe(false)
    expect(ifRangeMatches('Wed, 26 Aug 2026 12:00:00 GMT', object)).toBe(true)
    expect(ifRangeMatches('Wed, 26 Aug 2026 11:59:59 GMT', object)).toBe(false)
  })

  it('evaluates cache preconditions with HTTP GET semantics', () => {
    const object = { httpEtag: '"abc"', uploaded: new Date('2026-08-26T12:00:00Z') }
    expect(audioPreconditionStatus(new Headers({ 'If-None-Match': 'W/"abc"' }), object)).toBe(304)
    expect(audioPreconditionStatus(new Headers({ 'If-Match': '"stale"' }), object)).toBe(412)
    expect(audioPreconditionStatus(new Headers({ 'If-Match': '"abc"' }), object)).toBe(0)
    expect(audioPreconditionStatus(new Headers({ 'If-Modified-Since': 'Wed, 26 Aug 2026 12:00:00 GMT' }), object)).toBe(304)
  })
})
