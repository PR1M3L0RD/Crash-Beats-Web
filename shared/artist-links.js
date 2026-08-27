const makeDefinition = (label, hostname, pathnamePattern) => Object.freeze({
  label,
  hostname,
  pathnamePattern,
  error: `Enter a valid ${label} artist URL.`,
})

export const ARTIST_LINK_DEFINITIONS = Object.freeze({
  instagramUrl: makeDefinition(
    'Instagram',
    'instagram.com',
    /^\/[a-z0-9._]+$/i,
  ),
  spotifyUrl: makeDefinition(
    'Spotify',
    'open.spotify.com',
    /^\/artist\/[^/]+$/i,
  ),
  appleMusicUrl: makeDefinition(
    'Apple Music',
    'music.apple.com',
    /^\/(?:[a-z]{2}\/)?artist\/[^/]+\/\d+$/i,
  ),
  soundcloudUrl: makeDefinition(
    'SoundCloud',
    'soundcloud.com',
    /^\/[^/]+$/,
  ),
})

export function normalizeArtistLink(value, fieldName) {
  const definition = ARTIST_LINK_DEFINITIONS[fieldName]
  const input = String(value ?? '').trim()
  if (!definition || !input) return ''

  try {
    const url = new URL(input)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    const pathname = url.pathname.replace(/\/+$/, '')

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      hostname !== definition.hostname ||
      !definition.pathnamePattern.test(pathname)
    ) {
      return ''
    }

    url.hostname = definition.hostname
    url.pathname = pathname
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}

export function validateArtistLinks(fields = {}) {
  const errors = {}
  const values = {}
  let populated = false

  for (const [fieldName, definition] of Object.entries(ARTIST_LINK_DEFINITIONS)) {
    const input = String(fields[fieldName] ?? '').trim()
    populated ||= Boolean(input)
    values[fieldName] = normalizeArtistLink(input, fieldName)

    if (input && !values[fieldName]) {
      errors[fieldName] = definition.error
    }
  }

  if (!populated) {
    errors.links = 'Add at least one valid artist link.'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values,
  }
}
