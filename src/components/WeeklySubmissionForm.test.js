import { describe, expect, it } from 'vitest'
import { hasSubmissionMinimums } from './WeeklySubmissionForm'

const mp3 = (overrides = {}) => ({
  name: 'track.mp3',
  type: 'audio/mpeg',
  size: 1024,
  ...overrides,
})

describe('Weekly submission minimums', () => {
  it('requires both an artist link and at least one valid MP3', () => {
    expect(hasSubmissionMinimums({}, [])).toBe(false)
    expect(hasSubmissionMinimums({ instagramUrl: 'https://instagram.com/artist' }, [])).toBe(false)
    expect(hasSubmissionMinimums({}, [mp3()])).toBe(false)
    expect(hasSubmissionMinimums(
      { instagramUrl: 'https://instagram.com/artist' },
      [mp3()],
    )).toBe(true)
  })

  it('keeps submission disabled for invalid or oversized uploads', () => {
    const values = { spotifyUrl: 'https://open.spotify.com/artist/123' }
    expect(hasSubmissionMinimums(values, [mp3({ name: 'notes.txt', type: 'text/plain' })])).toBe(false)
    expect(hasSubmissionMinimums(values, [mp3({ size: 20 * 1024 * 1024 + 1 })])).toBe(false)
  })
})
