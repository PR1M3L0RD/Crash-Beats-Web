const titleOverrides = {
  '45': 'Forty Five',
  amb: 'AMB',
  cc: 'CC',
  ch: 'CH',
  'ebo 2': 'EBO II',
  erre: 'ERRE',
  'guit 2': 'Guit II',
  isn: 'ISN',
  kl: 'KL',
  lofi: 'Lo-Fi',
  'crash x bailey 1': 'Crash × Bailey I',
  'crash x bailey 2': 'Crash × Bailey II',
  'crash beat master': 'Crash Beat Master',
  'diller no little boy': 'Diller — No Little Boy',
  'prog 3 copy': 'Prog III',
  recolection: 'Recollection',
  insaninty: 'Insanity',
  'opera mastwer': 'Opera Master',
  ybg: 'YBG',
  'ybg 1': 'YBG I',
  'ybg 2': 'YBG II',
}

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
  return (
    titleOverrides[normalized] ||
    normalized.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
  )
}

function slug(value) {
  return normalizeWords(withoutExtension(value))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildTrack(mixtape, filename, index) {
  const basename = withoutExtension(filename)
  const [name, feature] = basename.split(/\s+ft\.\s+/i)
  const id = `${mixtape.trackPrefix}-${slug(basename)}`

  return {
    id,
    title: titleCase(name),
    credit: feature ? `ft. ${titleCase(feature)}` : 'Crash Beats',
    featuredArtist: feature ? titleCase(feature) : null,
    filename,
    source: mixtape.source,
    objectKey: `library/${id}.mp3`,
    sortOrder: index,
    src: `/api/audio/${encodeURIComponent(id)}`,
  }
}

export const mixtapeDefinitions = [
  {
    id: 'velvet-static', title: 'Velvet Static', subtitle: 'Slow burns & soft focus',
    catalog: 'CB-001', side: 'A', accent: '#e85d3f', accent2: '#f3bd55', ink: '#251b18',
    trackPrefix: 'regular', source: { type: 'directory', path: 'reg songs' },
    tracks: [
      'you are mine.mp3', 'somebody.mp3', 'sade.mp3', 'remember.mp3', 'let go.mp3',
      'fine.mp3', 'cari.mp3', 'answer.mp3', 'wonder.mp3', 'unique.mp3',
    ],
  },
  {
    id: 'midnight-circuit', title: 'Midnight Circuit', subtitle: 'After-hours transmissions',
    catalog: 'CB-002', side: 'B', accent: '#2da7a1', accent2: '#cfdfc4', ink: '#102b2d',
    trackPrefix: 'regular', source: { type: 'directory', path: 'reg songs' },
    tracks: [
      'moon.mp3', 'lofi.mp3', 'reverse.mp3', 'going.mp3', 'guit.mp3',
      'guit 2.mp3', 'ebo 2.mp3', 'doodly.mp3', 'amb.mp3', 'ch.mp3',
    ],
  },
  {
    id: 'heatwave-fm', title: 'Heatwave FM', subtitle: 'Windows down, volume up',
    catalog: 'CB-003', side: 'A', accent: '#ed7b2f', accent2: '#f5dc68', ink: '#392017',
    trackPrefix: 'regular', source: { type: 'directory', path: 'reg songs' },
    tracks: [
      'afro.mp3', 'dance.mp3', 'west.mp3', 'air fryer.mp3', 'pastrami.mp3',
      'boompa.mp3', 'squeak.mp3', 'twiz.mp3', 'bryson.mp3', 'mama.mp3',
    ],
  },
  {
    id: 'concrete-voltage', title: 'Concrete Voltage', subtitle: 'Heavy drums & loose wires',
    catalog: 'CB-004', side: 'B', accent: '#aa3d52', accent2: '#d9a7b0', ink: '#2e1720',
    trackPrefix: 'regular', source: { type: 'directory', path: 'reg songs' },
    tracks: [
      'ybg 1.mp3', 'minimum wage.mp3', 'filth.mp3', 'doom.mp3', 'strrrr.mp3',
      'blump beat.mp3', 'bent.mp3', 'erre.mp3', 'cc.mp3', '45.mp3',
    ],
  },
  {
    id: 'crash-and-friends', title: 'Crash & Friends', subtitle: 'The feature presentation',
    catalog: 'CB-005', side: 'X', accent: '#6260aa', accent2: '#f08db3', ink: '#201b3b',
    trackPrefix: 'featured', source: { type: 'directory', path: 'featured songs' },
    tracks: [
      'CRASH X BAILEY 1.mp3', 'CRASH X BAILEY 2.mp3',
      'afro ft. bailey sample.mp3', 'amore ft. bailey sample.mp3',
      'disguise ft. bailey sample.mp3', 'fl ft. bailey sample.mp3',
      'floescent ft. big slay.mp3', 'isn ft. big slay.mp3',
      'kl ft. big slay.mp3', 'ronny rice ft. bailey sample.mp3',
      'safe gear ft. big slay.mp3', 'ybg 2 ft. bailey sample.mp3',
    ],
  },
  {
    id: 'boom-bap-broadcast', title: 'Boom Bap Broadcast', subtitle: 'Dusty drums & chopped soul',
    catalog: 'CB-006', side: 'B', accent: '#c8872d', accent2: '#eadb9d', ink: '#302214',
    trackPrefix: 'bap', source: { type: 'archive', path: 'more beats 4 thomas.zip', folder: 'bap' },
    tracks: [
      'a drug song.wav', 'bout damn time.wav', 'crymeariver.wav',
      'diller NO LITTLE BOY.wav', 'look at you tonight beat.wav', 'recolection.wav',
      'shibuya.wav', 'tape.wav', 'wave after.wav',
    ],
  },
  {
    id: 'crash-classics', title: 'Crash Classics', subtitle: 'Deep cuts from the vault',
    catalog: 'CB-007', side: 'C', accent: '#c3456d', accent2: '#efc6a4', ink: '#351627',
    trackPrefix: 'classic', source: { type: 'archive', path: 'more beats 4 thomas.zip', folder: 'classic' },
    tracks: [
      'accept it.wav', 'CRASH BEAT MASTER.wav', 'middle age.wav',
      'might have you later ultra.wav', 'one million cash.wav', 'perspective.wav',
      'prog_3 - Copy.wav', 'same place +20c.wav', 'so funny i ran into you master ultra.wav',
    ],
  },
  {
    id: 'rap-signal', title: 'Rap Signal', subtitle: 'Bars over pressure drums',
    catalog: 'CB-008', side: 'R', accent: '#4d72d8', accent2: '#a8d9ef', ink: '#14203e',
    trackPrefix: 'rap', source: { type: 'archive', path: 'more beats 4 thomas.zip', folder: 'rap' },
    tracks: [
      '808seem.wav', 'circles (1).wav', 'cranium.wav', 'don.wav', 'dont know.wav',
      'dont matter.wav', 'ger master.wav', 'never gon run out.wav', 'NINETEEN.wav',
      'percy leaving.wav', 'tevis scoot.wav', 'traps.mp3',
    ],
  },
  {
    id: 'aftershock-trap', title: 'Aftershock Trap', subtitle: 'Low end after midnight',
    catalog: 'CB-009', side: 'T', accent: '#8f5bd8', accent2: '#dc9ee8', ink: '#24143d',
    trackPrefix: 'trap', source: { type: 'archive', path: 'more beats 4 thomas.zip', folder: 'trap' },
    tracks: [
      '808s asf.wav', 'divine.wav', 'greatness.wav', 'insaninty.wav', 'kick back.wav',
      'meant that 104.wav', 'opera mastwer.wav', 'the mayor.wav', 'ultra.wav', 'you and i.wav',
    ],
  },
]

export const mixtapes = mixtapeDefinitions.map((definition, mixtapeIndex) => ({
  ...definition,
  sortOrder: mixtapeIndex,
  tracks: definition.tracks.map((filename, index) => buildTrack(definition, filename, index)),
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
      artist?.socialHref && { id: 'instagram', label: `${name} on Instagram`, shortLabel: 'IG', href: artist.socialHref },
      artist?.musicHref && { id: 'spotify', label: `${name} on Spotify`, shortLabel: 'SP', href: artist.musicHref },
    ].filter(Boolean),
  }
}

export const socials = [
  { id: 'instagram', label: 'Crash Beats on Instagram', shortLabel: 'IG', href: 'https://www.instagram.com/crash_beats_/' },
  { id: 'spotify', label: 'Crash Beats on Spotify', shortLabel: 'SP', href: 'https://open.spotify.com/artist/7rimiNKT9JZKIBZhZmvXAZ' },
  { id: 'apple', label: 'Crash Beats on Apple Music', shortLabel: 'AM', href: 'https://music.apple.com/us/artist/crashbeats/1834828709' },
  { id: 'tiktok', label: 'Crash Beats on TikTok', shortLabel: 'TT', href: 'https://www.tiktok.com/@crash_beats' },
]
