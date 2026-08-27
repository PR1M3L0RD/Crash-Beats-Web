import { describe, expect, it } from 'vitest'
import { getWeeklyArtist, parseWeeklyArtistsCsv } from './weeklyArtists'

describe('weekly artist schedule', () => {
  it('parses the public sheet format and quoted values', () => {
    const artists = parseWeeklyArtistsCsv(
      'Artist:,Socials:,Music:\r\n"Big, Slay",https://instagram.com/slay,https://open.spotify.com/artist/1',
    )

    expect(artists).toEqual([
      {
        name: 'Big, Slay',
        socialHref: 'https://instagram.com/slay',
        musicHref: 'https://open.spotify.com/artist/1',
        appleMusicHref: '',
        soundcloudHref: '',
      },
    ])
  })

  it('parses the Featured section from the current A:C sheet layout', () => {
    const artists = parseWeeklyArtistsCsv([
      'Featured:,,,,,,,,Form entries:,,',
      'Artist:,Insta:,Spotify:,,,,,,Artist:,Insta:,Spotify:',
      'Big Slay,https://instagram.com/savi.global,https://open.spotify.com/artist/123,,,,,,,,',
    ].join('\n'))

    expect(artists).toHaveLength(1)
    expect(artists[0].name).toBe('Big Slay')
  })

  it('parses Apple Music and SoundCloud from the featured columns', () => {
    const artists = parseWeeklyArtistsCsv([
      'Featured:,,,,,,,,Form entries:,,,,',
      'Artist:,Insta:,Spotify:,Apple:,SC:,,,,Artist:,Insta:,Spotify:,Apple:,SC:',
      'New Artist,https://instagram.com/newartist,https://open.spotify.com/artist/123,https://music.apple.com/us/artist/new-artist/123,https://soundcloud.com/newartist,,,,,,,,',
    ].join('\n'))

    expect(artists[0]).toMatchObject({
      appleMusicHref: 'https://music.apple.com/us/artist/new-artist/123',
      soundcloudHref: 'https://soundcloud.com/newartist',
    })
  })

  it('advances once per week and stays on the last listed artist', () => {
    const artists = [{ name: 'One' }, { name: 'Two' }]
    const start = new Date('2026-08-24T00:00:00Z')

    expect(getWeeklyArtist(artists, new Date('2026-08-24T12:00:00Z'), start).name).toBe('One')
    expect(getWeeklyArtist(artists, new Date('2026-08-31T00:00:00Z'), start).name).toBe('Two')
    expect(getWeeklyArtist(artists, new Date('2026-11-01T00:00:00Z'), start).name).toBe('Two')
  })
})
