import { describe, expect, it } from 'vitest'
import {
  ARTIST_LINK_DEFINITIONS,
  normalizeArtistLink,
  validateArtistLinks,
} from './artist-links.js'

const EMPTY_LINKS = {
  instagramUrl: '',
  spotifyUrl: '',
  appleMusicUrl: '',
  soundcloudUrl: '',
}

describe('artist link definitions', () => {
  it('defines all four form fields', () => {
    expect(Object.keys(ARTIST_LINK_DEFINITIONS)).toEqual(Object.keys(EMPTY_LINKS))
  })
})

describe('normalizeArtistLink', () => {
  it.each([
    [
      'instagramUrl',
      ' https://www.instagram.com/crash.beats_08/?utm_source=form#music ',
      'https://instagram.com/crash.beats_08',
    ],
    [
      'spotifyUrl',
      'https://www.open.spotify.com/artist/4abc123/?si=tracking#top',
      'https://open.spotify.com/artist/4abc123',
    ],
    [
      'appleMusicUrl',
      'https://www.music.apple.com/us/artist/crash-beats/123456789/?uo=4#songs',
      'https://music.apple.com/us/artist/crash-beats/123456789',
    ],
    [
      'appleMusicUrl',
      'https://music.apple.com/artist/crash-beats/123456789/',
      'https://music.apple.com/artist/crash-beats/123456789',
    ],
    [
      'soundcloudUrl',
      'https://www.soundcloud.com/crash-beats/?utm_campaign=form#tracks',
      'https://soundcloud.com/crash-beats',
    ],
  ])('normalizes a valid %s link', (fieldName, input, expected) => {
    expect(normalizeArtistLink(input, fieldName)).toBe(expected)
  })

  it.each([
    ['instagramUrl', 'http://instagram.com/crashbeats'],
    ['instagramUrl', 'https://instagram.com/crashbeats/song'],
    ['instagramUrl', 'https://instagram.com.evil.test/crashbeats'],
    ['spotifyUrl', 'https://open.spotify.com/album/abc123'],
    ['spotifyUrl', 'https://spotify.com/artist/abc123'],
    ['appleMusicUrl', 'https://music.apple.com/us/album/crash-beats/123456789'],
    ['appleMusicUrl', 'https://music.apple.com/us/artist/crash-beats/not-a-number'],
    ['soundcloudUrl', 'https://soundcloud.com/crash-beats/a-track'],
    ['soundcloudUrl', 'https://on.soundcloud.com/share-code'],
    ['soundcloudUrl', 'https://user:secret@soundcloud.com/crash-beats'],
  ])('rejects an invalid %s link', (fieldName, input) => {
    expect(normalizeArtistLink(input, fieldName)).toBe('')
  })

  it('returns an empty string for blank values and unknown fields', () => {
    expect(normalizeArtistLink('   ', 'instagramUrl')).toBe('')
    expect(normalizeArtistLink('https://example.com/artist', 'unknownUrl')).toBe('')
  })
})

describe('validateArtistLinks', () => {
  it.each([
    ['instagramUrl', 'https://instagram.com/crashbeats'],
    ['spotifyUrl', 'https://open.spotify.com/artist/abc123'],
    ['appleMusicUrl', 'https://music.apple.com/gb/artist/crash-beats/123456789'],
    ['soundcloudUrl', 'https://soundcloud.com/crash-beats'],
  ])('accepts %s as the only populated link', (fieldName, value) => {
    const result = validateArtistLinks({ ...EMPTY_LINKS, [fieldName]: value })

    expect(result).toEqual({
      valid: true,
      errors: {},
      values: { ...EMPTY_LINKS, [fieldName]: value },
    })
  })

  it('requires at least one populated link', () => {
    expect(validateArtistLinks(EMPTY_LINKS)).toEqual({
      valid: false,
      errors: { links: 'Add at least one valid artist link.' },
      values: EMPTY_LINKS,
    })
  })

  it('reports every populated invalid field even when another link is valid', () => {
    const result = validateArtistLinks({
      instagramUrl: 'https://instagram.com/crashbeats',
      spotifyUrl: 'https://open.spotify.com/track/not-an-artist',
      appleMusicUrl: '',
      soundcloudUrl: 'not a URL',
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual({
      spotifyUrl: 'Enter a valid Spotify artist URL.',
      soundcloudUrl: 'Enter a valid SoundCloud artist URL.',
    })
    expect(result.values).toEqual({
      instagramUrl: 'https://instagram.com/crashbeats',
      spotifyUrl: '',
      appleMusicUrl: '',
      soundcloudUrl: '',
    })
  })

  it('always returns canonical strings for all four fields', () => {
    expect(validateArtistLinks({
      appleMusicUrl: 'https://www.music.apple.com/us/artist/crash-beats/123/?i=456',
    }).values).toEqual({
      instagramUrl: '',
      spotifyUrl: '',
      appleMusicUrl: 'https://music.apple.com/us/artist/crash-beats/123',
      soundcloudUrl: '',
    })
  })
})
