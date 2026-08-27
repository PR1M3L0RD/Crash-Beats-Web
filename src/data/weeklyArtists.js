export const WEEKLY_ARTISTS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/13jYGupkTRKLsz1V7Q4mQ-Wufgwot2EJwfsQC7U_6GZM/export?format=csv&gid=0'

export const WEEKLY_START_DATE = '2026-08-24T00:00:00Z'

export const fallbackWeeklyArtists = [
  {
    name: 'Big Slay',
    socialHref:
      'https://www.instagram.com/savi.global?utm_source=ig_web_button_share_sheet&igsi=ZDNlZDc0MzIxNw==',
    musicHref:
      'https://open.spotify.com/artist/3FdfHmxbjiS7KtxqvZ5j42?si=9na38GzHQOeQYmMCODlINA',
  },
]

function parseCsvRows(csv) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]

    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(value.trim())
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index += 1
      row.push(value.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }

  row.push(value.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function safeWebUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

export function parseWeeklyArtistsCsv(csv) {
  const rows = parseCsvRows(csv)
  const headerRowIndex = rows.findIndex(
    (row) => row[0]?.toLowerCase().replace(/:$/, '').trim() === 'artist',
  )
  if (headerRowIndex < 0) return []

  const headerRow = rows[headerRowIndex]
  const headers = headerRow.map((header) =>
    header.toLowerCase().replace(/:$/, '').trim(),
  )
  const artistIndex = headers.indexOf('artist')
  const socialIndex = Math.max(headers.indexOf('insta'), headers.indexOf('socials'))
  const musicIndex = Math.max(headers.indexOf('spotify'), headers.indexOf('music'))

  if (artistIndex < 0) return []

  return rows
    .slice(headerRowIndex + 1)
    .map((row) => ({
      name: row[artistIndex]?.trim() || '',
      socialHref: safeWebUrl(row[socialIndex] || ''),
      musicHref: safeWebUrl(row[musicIndex] || ''),
    }))
    .filter((artist) => artist.name)
}

export function getWeeklyArtist(
  artists,
  date = new Date(),
  startDate = new Date(WEEKLY_START_DATE),
) {
  if (!artists.length) return null

  const weekInMilliseconds = 7 * 24 * 60 * 60 * 1000
  const elapsedWeeks = Math.floor((date.getTime() - startDate.getTime()) / weekInMilliseconds)
  const index = Math.min(artists.length - 1, Math.max(0, elapsedWeeks))

  return { ...artists[index], scheduleIndex: index }
}
