function withoutExtension(value) {
  return value.replace(/\.(mp3|wav)$/i, '')
}

function normalizeWords(value) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9×&. ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleCase(value) {
  const normalized = normalizeWords(withoutExtension(value))
  return normalized.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

function slug(value) {
  return normalizeWords(withoutExtension(value))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildTrack(trackDefinition, index) {
  const { filename, source, trackPrefix } = trackDefinition
  const basename = withoutExtension(filename)
  const [name, feature] = basename.split(/\s+ft\.\s+/i)
  const id = `${trackPrefix}-${slug(basename)}`

  return {
    id,
    title: titleCase(name),
    credit: feature ? `ft. ${titleCase(feature)}` : 'Crash Beats',
    featuredArtist: feature ? titleCase(feature) : null,
    filename,
    source,
    objectKey: `library/${id}.mp3`,
    sortOrder: index,
    src: `/api/audio/${encodeURIComponent(id)}`,
  }
}

const trackSources = {
  regular: { trackPrefix: 'regular', source: { type: 'directory', path: 'reg songs' } },
  featured: { trackPrefix: 'featured', source: { type: 'directory', path: 'featured songs' } },
  bap: { trackPrefix: 'bap', source: { type: 'archive', path: 'more beats 4 thomas.zip', folder: 'bap' } },
  classic: { trackPrefix: 'classic', source: { type: 'archive', path: 'more beats 4 thomas.zip', folder: 'classic' } },
  rap: { trackPrefix: 'rap', source: { type: 'archive', path: 'more beats 4 thomas.zip', folder: 'rap' } },
  trap: { trackPrefix: 'trap', source: { type: 'archive', path: 'more beats 4 thomas.zip', folder: 'trap' } },
}

function sourceTracks(sourceId, filenames) {
  return filenames.map((filename) => ({ ...trackSources[sourceId], filename }))
}

export const mixtapeDefinitions = [
  {
    id: 'velvet-static', title: 'Soft', subtitle: 'Slow burns & soft focus',
    catalog: 'CB-001', side: 'A', accent: '#e85d3f', accent2: '#f3bd55', ink: '#251b18',
    tracks: [
      ...sourceTracks('regular', ['guit 2.mp3', 'mama.mp3', 'lofi.mp3', 'remember.mp3']),
      ...sourceTracks('classic', ['so funny i ran into you master ultra.wav', 'accept it.wav']),
      ...sourceTracks('bap', ['recolection.wav', 'tape.wav', 'a drug song.wav']),
      ...sourceTracks('trap', ['you and i.wav']),
    ],
  },
  {
    id: 'midnight-circuit', title: 'Night', subtitle: 'After-hours transmissions',
    catalog: 'CB-002', side: 'B', accent: '#2da7a1', accent2: '#cfdfc4', ink: '#102b2d',
    tracks: [
      ...sourceTracks('classic', ['perspective.wav', 'one million cash.wav']),
      ...sourceTracks('regular', ['guit.mp3', 'somebody.mp3', 'let go.mp3', '45.mp3', 'reverse.mp3']),
      ...sourceTracks('trap', ['divine.wav', 'ultra.wav', 'the mayor.wav']),
    ],
  },
  {
    id: 'heatwave-fm', title: 'Heat', subtitle: 'Windows down, volume up',
    catalog: 'CB-003', side: 'A', accent: '#ed7b2f', accent2: '#f5dc68', ink: '#392017',
    tracks: [
      ...sourceTracks('regular', ['afro.mp3', 'dance.mp3', 'filth.mp3', 'wonder.mp3', 'ch.mp3']),
      ...sourceTracks('bap', ['shibuya.wav']),
      ...sourceTracks('rap', ['NINETEEN.wav', 'don.wav', 'tevis scoot.wav', 'never gon run out.wav']),
    ],
  },
  {
    id: 'concrete-voltage', title: 'Heavy', subtitle: 'Heavy drums & loose wires',
    catalog: 'CB-004', side: 'B', accent: '#aa3d52', accent2: '#d9a7b0', ink: '#2e1720',
    tracks: [
      ...sourceTracks('regular', ['cari.mp3', 'erre.mp3', 'unique.mp3', 'boompa.mp3', 'going.mp3', 'bent.mp3']),
      ...sourceTracks('trap', ['insaninty.wav']),
      ...sourceTracks('classic', ['CRASH BEAT MASTER.wav']),
      ...sourceTracks('rap', ['dont know.wav', 'ger master.wav']),
    ],
  },
  {
    id: 'crash-and-friends', title: 'Collabs', subtitle: 'The feature presentation',
    catalog: 'CB-005', side: 'X', accent: '#6260aa', accent2: '#f08db3', ink: '#201b3b',
    tracks: sourceTracks('featured', [
      'CRASH X BAILEY 1.mp3', 'CRASH X BAILEY 2.mp3',
      'afro ft. bailey sample.mp3', 'amore ft. bailey sample.mp3',
      'disguise ft. bailey sample.mp3', 'fl ft. bailey sample.mp3',
      'floescent ft. big slay.mp3', 'isn ft. big slay.mp3',
      'kl ft. big slay.mp3', 'ronny rice ft. bailey sample.mp3',
      'safe gear ft. big slay.mp3', 'ybg 2 ft. bailey sample.mp3',
    ]),
  },
  {
    id: 'boom-bap-broadcast', title: 'Soul', subtitle: 'Dusty drums & chopped soul',
    catalog: 'CB-006', side: 'B', accent: '#c8872d', accent2: '#eadb9d', ink: '#302214',
    tracks: [
      ...sourceTracks('regular', [
        'air fryer.mp3', 'west.mp3', 'bryson.mp3', 'sade.mp3', 'minimum wage.mp3',
        'you are mine.mp3',
      ]),
      ...sourceTracks('bap', ['look at you tonight beat.wav', 'crymeariver.wav', 'diller NO LITTLE BOY.wav']),
      ...sourceTracks('rap', ['percy leaving.wav']),
    ],
  },
  {
    id: 'crash-classics', title: 'Classics', subtitle: 'Deep cuts from the vault',
    catalog: 'CB-007', side: 'C', accent: '#c3456d', accent2: '#efc6a4', ink: '#351627',
    tracks: [
      ...sourceTracks('classic', [
        'might have you later ultra.wav', 'same place +20c.wav', 'prog_3 - Copy.wav', 'middle age.wav',
      ]),
      ...sourceTracks('regular', ['ybg 1.mp3', 'answer.mp3', 'amb.mp3']),
      ...sourceTracks('rap', ['dont matter.wav']),
      ...sourceTracks('bap', ['bout damn time.wav', 'wave after.wav']),
    ],
  },
  {
    id: 'rap-signal', title: 'Rap', subtitle: 'Bars over pressure drums',
    catalog: 'CB-008', side: 'R', accent: '#4d72d8', accent2: '#a8d9ef', ink: '#14203e',
    tracks: [
      ...sourceTracks('regular', ['doodly.mp3', 'strrrr.mp3', 'twiz.mp3', 'ebo 2.mp3', 'squeak.mp3']),
      ...sourceTracks('rap', ['circles (1).wav', 'cranium.wav', 'traps.mp3']),
      ...sourceTracks('trap', ['opera mastwer.wav', 'kick back.wav']),
    ],
  },
  {
    id: 'aftershock-trap', title: 'Trap', subtitle: 'Low end after midnight',
    catalog: 'CB-009', side: 'T', accent: '#8f5bd8', accent2: '#dc9ee8', ink: '#24143d',
    tracks: [
      ...sourceTracks('trap', ['greatness.wav', '808s asf.wav', 'meant that 104.wav']),
      ...sourceTracks('regular', ['cc.mp3', 'pastrami.mp3', 'doom.mp3', 'fine.mp3', 'blump beat.mp3', 'moon.mp3']),
      ...sourceTracks('rap', ['808seem.wav']),
    ],
  },
]

export const mixtapes = mixtapeDefinitions.map((definition, mixtapeIndex) => ({
  ...definition,
  sortOrder: mixtapeIndex,
  tracks: definition.tracks.map((trackDefinition, index) => buildTrack(trackDefinition, index)),
}))

function normalizeArtistName(value) {
  return normalizeWords(value || '')
}

export function createWeeklyMixtape(artist, suppliedTracks = []) {
  const name = artist?.name || 'Big Slay'
  const scheduleNumber = (artist?.scheduleIndex ?? 0) + 1
  const normalizedArtist = normalizeArtistName(name)
  const matchingTracks = mixtapes
    .flatMap((mixtape) => mixtape.tracks)
    .filter((track) => normalizeArtistName(track.featuredArtist) === normalizedArtist)

  return {
    id: 'crash-weekly', title: 'Crash Weekly', subtitle: `Artist of the week · ${name}`,
    catalog: `CW-${String(scheduleNumber).padStart(3, '0')}`, side: 'W',
    accent: '#ff4ecb', accent2: '#53f4ff', ink: '#241039',
    isWeekly: true, artist: name,
    tracks: suppliedTracks.length ? suppliedTracks : matchingTracks,
    socials: [
      { id: 'instagram', label: `${name} on Instagram`, shortLabel: 'IG', href: artist?.socialHref || '' },
      { id: 'spotify', label: `${name} on Spotify`, shortLabel: 'SP', href: artist?.musicHref || '' },
      { id: 'apple', label: `${name} on Apple Music`, shortLabel: 'AM', href: artist?.appleMusicHref || '' },
      { id: 'soundcloud', label: `${name} on SoundCloud`, shortLabel: 'SC', href: artist?.soundcloudHref || '' },
    ],
  }
}

export const socials = [
  { id: 'instagram', label: 'Crash Beats on Instagram', shortLabel: 'IG', href: 'https://www.instagram.com/crash_beats_/' },
  { id: 'spotify', label: 'Crash Beats on Spotify', shortLabel: 'SP', href: 'https://open.spotify.com/artist/7rimiNKT9JZKIBZhZmvXAZ' },
  { id: 'apple', label: 'Crash Beats on Apple Music', shortLabel: 'AM', href: 'https://music.apple.com/us/artist/crashbeats/1834828709' },
  { id: 'soundcloud', label: 'Crash Beats on SoundCloud', shortLabel: 'SC', href: 'https://on.soundcloud.com/wTyI8La7jR0J0ImwQX' },
  { id: 'tiktok', label: 'Crash Beats on TikTok', shortLabel: 'TT', href: 'https://www.tiktok.com/@crash_beats' },
]
