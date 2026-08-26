const regularFiles = import.meta.glob('../../reg songs/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})

const featuredFiles = import.meta.glob('../../featured songs/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})

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
  ybg: 'YBG',
  'ybg 1': 'YBG I',
  'ybg 2': 'YBG II',
}

function titleCase(value) {
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim()
  return (
    titleOverrides[normalized] ||
    normalized.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
  )
}

function createTrack(fileName, folder = 'regular') {
  const files = folder === 'featured' ? featuredFiles : regularFiles
  const directory = folder === 'featured' ? 'featured songs' : 'reg songs'
  const key = `../../${directory}/${fileName}.mp3`
  const src = files[key]

  if (!src) {
    throw new Error(`Missing audio file: ${key}`)
  }

  const [name, feature] = fileName.split(/\s+ft\.\s+/i)

  return {
    id: `${folder}-${fileName}`.replace(/\s+/g, '-').toLowerCase(),
    title: titleCase(name),
    credit: feature ? `ft. ${titleCase(feature)}` : 'Crash Beats',
    src,
  }
}

const tape = (details, tracks, folder = 'regular') => ({
  ...details,
  tracks: tracks.map((track) => createTrack(track, folder)),
})

export const mixtapes = [
  tape(
    {
      id: 'velvet-static',
      title: 'Velvet Static',
      subtitle: 'Slow burns & soft focus',
      catalog: 'CB-001',
      side: 'A',
      accent: '#e85d3f',
      accent2: '#f3bd55',
      ink: '#251b18',
    },
    [
      'you are mine',
      'somebody',
      'sade',
      'remember',
      'let go',
      'fine',
      'cari',
      'answer',
      'wonder',
      'unique',
    ],
  ),
  tape(
    {
      id: 'midnight-circuit',
      title: 'Midnight Circuit',
      subtitle: 'After-hours transmissions',
      catalog: 'CB-002',
      side: 'B',
      accent: '#2da7a1',
      accent2: '#cfdfc4',
      ink: '#102b2d',
    },
    [
      'moon',
      'lofi',
      'reverse',
      'going',
      'guit',
      'guit 2',
      'ebo 2',
      'doodly',
      'amb',
      'ch',
    ],
  ),
  tape(
    {
      id: 'heatwave-fm',
      title: 'Heatwave FM',
      subtitle: 'Windows down, volume up',
      catalog: 'CB-003',
      side: 'A',
      accent: '#ed7b2f',
      accent2: '#f5dc68',
      ink: '#392017',
    },
    [
      'afro',
      'dance',
      'west',
      'air fryer',
      'pastrami',
      'boompa',
      'squeak',
      'twiz',
      'bryson',
      'mama',
    ],
  ),
  tape(
    {
      id: 'concrete-voltage',
      title: 'Concrete Voltage',
      subtitle: 'Heavy drums & loose wires',
      catalog: 'CB-004',
      side: 'B',
      accent: '#aa3d52',
      accent2: '#d9a7b0',
      ink: '#2e1720',
    },
    [
      'ybg 1',
      'minimum wage',
      'filth',
      'doom',
      'strrrr',
      'blump beat',
      'bent',
      'erre',
      'cc',
      '45',
    ],
  ),
  tape(
    {
      id: 'crash-and-friends',
      title: 'Crash & Friends',
      subtitle: 'The feature presentation',
      catalog: 'CB-005',
      side: 'X',
      accent: '#6260aa',
      accent2: '#f08db3',
      ink: '#201b3b',
    },
    [
      'CRASH X BAILEY 1',
      'CRASH X BAILEY 2',
      'afro ft. bailey sample',
      'amore ft. bailey sample',
      'disguise ft. bailey sample',
      'fl ft. bailey sample',
      'floescent ft. big slay',
      'isn ft. big slay',
      'kl ft. big slay',
      'ronny rice ft. bailey sample',
      'safe gear ft. big slay',
      'ybg 2 ft. bailey sample',
    ],
    'featured',
  ),
]

export const socials = [
  {
    id: 'instagram',
    label: 'Crash Beats on Instagram',
    shortLabel: 'IG',
    href: 'https://www.instagram.com/crash_beats_/',
  },
  {
    id: 'spotify',
    label: 'Crash Beats on Spotify',
    shortLabel: 'SP',
    href: 'https://open.spotify.com/artist/7rimiNKT9JZKIBZhZmvXAZ',
  },
  {
    id: 'apple',
    label: 'Crash Beats on Apple Music',
    shortLabel: 'AM',
    href: 'https://music.apple.com/us/artist/crashbeats/1834828709',
  },
]
