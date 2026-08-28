import { describe, expect, it } from 'vitest'
import {
  audioPreconditionStatus,
  hasConsecutiveMp3Frames,
  ifRangeMatches,
  normalizeFeaturedArtists,
  normalizeSocialUrl,
  parseByteRange,
  parseFeaturedArtistsCsv,
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
