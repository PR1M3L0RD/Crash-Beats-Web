import { describe, expect, it } from 'vitest'
import { createWeeklyMixtape, mixtapes } from './mixtapes'

describe('mixtape catalog', () => {
  it('keeps every catalog track unique while balancing the sound-based tapes', () => {
    const tracks = mixtapes.flatMap((mixtape) => mixtape.tracks)

    expect(mixtapes.map(({ title, tracks: tapeTracks }) => [title, tapeTracks.length])).toEqual([
      ['Soft', 10],
      ['Night', 10],
      ['Heat', 10],
      ['Heavy', 10],
      ['Collabs', 12],
      ['Soul', 10],
      ['Classics', 10],
      ['Rap', 10],
      ['Trap', 10],
    ])
    expect(tracks).toHaveLength(92)
    expect(new Set(tracks.map((track) => track.id)).size).toBe(92)
  })

  it('preserves stable source prefixes and original storage locations after reassignment', () => {
    const sourceCounts = mixtapes
      .flatMap((mixtape) => mixtape.tracks)
      .reduce((counts, track) => {
        const prefix = track.id.split('-')[0]
        counts[prefix] = (counts[prefix] || 0) + 1
        expect(track.source.type).toMatch(/^(directory|archive)$/)
        return counts
      }, {})

    expect(sourceCounts).toEqual({
      regular: 40,
      featured: 12,
      bap: 9,
      classic: 9,
      rap: 12,
      trap: 10,
    })
  })

  it('continues to build the weekly artist tape from collaboration credits', () => {
    const weekly = createWeeklyMixtape({ name: 'Big Slay', scheduleIndex: 0 })

    expect(weekly.tracks).toHaveLength(4)
    expect(weekly.tracks.every((track) => track.featuredArtist === 'Big Slay')).toBe(true)
  })
})
