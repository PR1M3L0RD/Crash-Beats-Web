import { useEffect, useId, useRef, useState } from 'react'
import {
  ARTIST_LINK_DEFINITIONS,
  validateArtistLinks,
} from '../../shared/artist-links.js'
import '../weekly-form.css'

const MAX_FILES = 3
const MAX_FILE_BYTES = 20 * 1024 * 1024
const TURNSTILE_SITE_KEY = '0x4AAAAAAEdQQ_eE5VY7afge'
const ACCEPTED_FILE_TYPES = new Set([
  '',
  'application/octet-stream',
  'audio/mp3',
  'audio/mpeg',
])

const EMPTY_FORM = {
  artistName: '',
  instagramUrl: '',
  spotifyUrl: '',
  appleMusicUrl: '',
  soundcloudUrl: '',
  rightsConfirmed: false,
  website: '',
}

const ARTIST_LINK_FIELDS = new Set(
  Object.keys(ARTIST_LINK_DEFINITIONS),
)

let turnstileLoader = null

function validateFiles(files) {
  if (!files.length || files.length > MAX_FILES) {
    return `Choose between 1 and ${MAX_FILES} MP3 files.`
  }

  const invalidFile = files.find(
    (file) => !/\.mp3$/i.test(file.name) || !ACCEPTED_FILE_TYPES.has(file.type),
  )
  if (invalidFile) return `${invalidFile.name} is not an MP3 file.`

  const oversizedFile = files.find((file) => file.size > MAX_FILE_BYTES)
  if (oversizedFile) return `${oversizedFile.name} is larger than 20 MB.`

  return ''
}

export function hasSubmissionMinimums(values, files) {
  const hasArtistLink = Object.keys(ARTIST_LINK_DEFINITIONS).some(
    (field) => Boolean(String(values?.[field] || '').trim()),
  )
  return hasArtistLink && !validateFiles(files || [])
}

function validateForm(values, files) {
  const errors = {}
  const artistName = values.artistName.trim().replace(/\s+/g, ' ')

  if (artistName.length < 2 || artistName.length > 80) {
    errors.artistName = 'Enter an artist name between 2 and 80 characters.'
  }
  Object.assign(errors, validateArtistLinks(values).errors)

  const fileError = validateFiles(files)
  if (fileError) errors.songs = fileError
  if (!values.rightsConfirmed) {
    errors.rightsConfirmed = 'Confirm that you have permission to submit these songs.'
  }

  return errors
}

function formatFileSize(bytes) {
  const megabytes = bytes / (1024 * 1024)
  return `${megabytes >= 10 ? megabytes.toFixed(1) : megabytes.toFixed(2)} MB`
}

async function responsePayload(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}))
  }

  const message = await response.text().catch(() => '')
  return message ? { error: message } : {}
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (turnstileLoader) return turnstileLoader

  turnstileLoader = new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-crash-turnstile]')
    const resolveWhenReady = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('Turnstile loaded without its browser API.'))
    }

    if (!script) {
      script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.crashTurnstile = 'true'
      script.addEventListener('load', resolveWhenReady, { once: true })
      script.addEventListener('error', () => reject(new Error('Turnstile failed to load.')), { once: true })
      document.head.append(script)
    } else {
      script.addEventListener('load', resolveWhenReady, { once: true })
      script.addEventListener('error', () => reject(new Error('Turnstile failed to load.')), { once: true })
    }
  }).catch((error) => {
    document.querySelector('script[data-crash-turnstile]')?.remove()
    turnstileLoader = null
    throw error
  })

  return turnstileLoader
}

export function WeeklySubmissionForm({ onClose = () => {} }) {
  const id = useId()
  const titleRef = useRef(null)
  const successRef = useRef(null)
  const fileInputRef = useRef(null)
  const requestRef = useRef(null)
  const turnstileContainerRef = useRef(null)
  const turnstileWidgetRef = useRef(null)
  const instagramUrlRef = useRef(null)
  const fieldRefs = {
    artistName: useRef(null),
    links: instagramUrlRef,
    instagramUrl: instagramUrlRef,
    spotifyUrl: useRef(null),
    appleMusicUrl: useRef(null),
    soundcloudUrl: useRef(null),
    songs: fileInputRef,
    rightsConfirmed: useRef(null),
    turnstileToken: turnstileContainerRef,
  }

  const [values, setValues] = useState(EMPTY_FORM)
  const [files, setFiles] = useState([])
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [status, setStatus] = useState('idle')
  const [submissionId, setSubmissionId] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileLoadError, setTurnstileLoadError] = useState('')
  const [turnstileAttempt, setTurnstileAttempt] = useState(0)
  const showingForm = status !== 'success'

  useEffect(() => {
    titleRef.current?.focus()

    return () => requestRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!showingForm) return undefined
    let active = true

    void loadTurnstile()
      .then((turnstile) => {
        if (!active || !turnstileContainerRef.current) return
        turnstileWidgetRef.current = turnstile.render(turnstileContainerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          size: window.matchMedia('(max-width: 374px)').matches ? 'compact' : 'flexible',
          action: 'weekly_submission',
          callback: (token) => {
            setTurnstileToken(token)
            setTurnstileLoadError('')
            setErrors((current) => {
              if (!current.turnstileToken) return current
              const next = { ...current }
              delete next.turnstileToken
              return next
            })
          },
          'expired-callback': () => setTurnstileToken(''),
          'error-callback': (errorCode) => {
            setTurnstileToken('')
            const code = errorCode ? ` (${errorCode})` : ''
            setTurnstileLoadError(`The security check could not load${code}. Try again below.`)
          },
        })
      })
      .catch(() => {
        if (active) setTurnstileLoadError('The security check could not load. Try again below.')
      })

    return () => {
      active = false
      if (turnstileWidgetRef.current !== null && window.turnstile) {
        window.turnstile.remove(turnstileWidgetRef.current)
        turnstileWidgetRef.current = null
      }
    }
  }, [showingForm, turnstileAttempt])

  useEffect(() => {
    if (status === 'success') successRef.current?.focus()
  }, [status])

  const ids = {
    title: `${id}-title`,
    intro: `${id}-intro`,
    artistName: `${id}-artist-name`,
    artistNameError: `${id}-artist-name-error`,
    instagramUrl: `${id}-instagram-url`,
    instagramUrlHint: `${id}-instagram-url-hint`,
    instagramUrlError: `${id}-instagram-url-error`,
    spotifyUrl: `${id}-spotify-url`,
    spotifyUrlHint: `${id}-spotify-url-hint`,
    spotifyUrlError: `${id}-spotify-url-error`,
    appleMusicUrl: `${id}-apple-music-url`,
    appleMusicUrlHint: `${id}-apple-music-url-hint`,
    appleMusicUrlError: `${id}-apple-music-url-error`,
    soundcloudUrl: `${id}-soundcloud-url`,
    soundcloudUrlHint: `${id}-soundcloud-url-hint`,
    soundcloudUrlError: `${id}-soundcloud-url-error`,
    linksLegend: `${id}-links-legend`,
    linksHint: `${id}-links-hint`,
    linksError: `${id}-links-error`,
    songs: `${id}-songs`,
    songsHint: `${id}-songs-hint`,
    songsError: `${id}-songs-error`,
    rightsConfirmed: `${id}-rights-confirmed`,
    rightsConfirmedError: `${id}-rights-confirmed-error`,
    turnstileError: `${id}-turnstile-error`,
    website: `${id}-website`,
    serverError: `${id}-server-error`,
  }

  function updateValue(event) {
    const { name, type, checked, value } = event.currentTarget
    setValues((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
    setErrors((current) => {
      if (!current[name] && !(ARTIST_LINK_FIELDS.has(name) && current.links)) return current
      const next = { ...current }
      delete next[name]
      if (ARTIST_LINK_FIELDS.has(name)) delete next.links
      return next
    })
    setServerError('')
  }

  function updateFiles(event) {
    const nextFiles = Array.from(event.currentTarget.files || [])
    const fileError = validateFiles(nextFiles)
    setFiles(nextFiles)
    setErrors((current) => {
      const next = { ...current }
      if (fileError) next.songs = fileError
      else delete next.songs
      return next
    })
    setServerError('')
  }

  function focusFirstError(nextErrors) {
    const firstField = [
      'artistName',
      'links',
      'instagramUrl',
      'spotifyUrl',
      'appleMusicUrl',
      'soundcloudUrl',
      'songs',
      'rightsConfirmed',
      'turnstileToken',
    ].find((field) => nextErrors[field])

    if (firstField) {
      window.requestAnimationFrame(() => fieldRefs[firstField].current?.focus())
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (status === 'submitting') return

    const nextErrors = validateForm(values, files)
    if (!turnstileToken) nextErrors.turnstileToken = 'Complete the security check.'
    setErrors(nextErrors)
    setServerError('')

    if (Object.keys(nextErrors).length) {
      focusFirstError(nextErrors)
      return
    }

    const body = new FormData()
    const normalizedLinks = validateArtistLinks(values).values
    body.append('artistName', values.artistName.trim().replace(/\s+/g, ' '))
    Object.keys(ARTIST_LINK_DEFINITIONS).forEach((field) => {
      body.append(field, normalizedLinks[field])
    })
    body.append('rightsConfirmed', 'yes')
    body.append('website', values.website)
    body.append('turnstileToken', turnstileToken)
    files.forEach((file) => body.append('songs', file, file.name))

    const controller = new AbortController()
    requestRef.current = controller
    setStatus('submitting')

    try {
      const response = await fetch('/api/submissions', {
        method: 'POST',
        body,
        signal: controller.signal,
      })
      const payload = await responsePayload(response)

      if (!response.ok) {
        const fieldErrors = payload.fields && typeof payload.fields === 'object'
          ? payload.fields
          : {}
        setErrors(fieldErrors)
        setServerError(payload.error || 'Your submission could not be sent. Please try again.')
        setStatus('error')
        setTurnstileToken('')
        if (turnstileWidgetRef.current !== null) {
          window.turnstile?.reset(turnstileWidgetRef.current)
        }
        focusFirstError(fieldErrors)
        return
      }

      setSubmissionId(typeof payload.submissionId === 'string' ? payload.submissionId : '')
      setValues(EMPTY_FORM)
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      setStatus('success')
    } catch (error) {
      if (error.name === 'AbortError') return
      setServerError('We could not reach the submission desk. Check your connection and try again.')
      setStatus('error')
      setTurnstileToken('')
      if (turnstileWidgetRef.current !== null) {
        window.turnstile?.reset(turnstileWidgetRef.current)
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null
    }
  }

  function handleClose() {
    requestRef.current?.abort()
    onClose()
  }

  function startAnotherSubmission() {
    setValues(EMPTY_FORM)
    setFiles([])
    setErrors({})
    setServerError('')
    setSubmissionId('')
    setTurnstileToken('')
    setStatus('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
    window.requestAnimationFrame(() => titleRef.current?.focus())
  }

  function retryTurnstile() {
    setTurnstileLoadError('')
    setTurnstileToken('')
    setTurnstileAttempt((current) => current + 1)
  }

  if (status === 'success') {
    return (
      <section className="weekly-form-page weekly-form-page--success" aria-labelledby={ids.title}>
        <div className="weekly-form-page__grain" aria-hidden="true" />
        <button className="weekly-form__close" type="button" onClick={handleClose}>
          <span aria-hidden="true">&larr;</span> Back to the player
        </button>

        <div className="weekly-form__success-card" ref={successRef} tabIndex="-1">
          <span className="weekly-form__eyebrow">TRANSMISSION RECEIVED</span>
          <span className="weekly-form__success-mark" aria-hidden="true">&#10003;</span>
          <h1 id={ids.title}>Your tape is in the queue.</h1>
          <p>
            Thanks for trusting Crash Beats with your music. We&rsquo;ll review the tracks and
            reach out through your submitted profiles if they&rsquo;re selected for Crash Weekly.
          </p>
          {submissionId && (
            <p className="weekly-form__reference">
              Confirmation <span>{submissionId.slice(0, 8).toUpperCase()}</span>
            </p>
          )}
          <div className="weekly-form__success-actions">
            <button className="weekly-form__button weekly-form__button--primary" type="button" onClick={handleClose}>
              Return to the player
            </button>
            <button className="weekly-form__button weekly-form__button--quiet" type="button" onClick={startAnotherSubmission}>
              Submit another artist
            </button>
          </div>
        </div>
      </section>
    )
  }

  const submitting = status === 'submitting'
  const submissionMinimumsMet = hasSubmissionMinimums(values, files)

  return (
    <section className="weekly-form-page" aria-labelledby={ids.title} aria-describedby={ids.intro}>
      <div className="weekly-form-page__grain" aria-hidden="true" />
      <button className="weekly-form__close" type="button" onClick={handleClose}>
        <span aria-hidden="true">&larr;</span> Back to the player
      </button>

      <div className="weekly-form__layout">
        <header className="weekly-form__hero">
          <div className="weekly-form__signal" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </div>
          <p className="weekly-form__eyebrow">CRASH WEEKLY // OPEN CALL</p>
          <h1 id={ids.title} ref={titleRef} tabIndex="-1">
            Put your sound <span>on the shelf.</span>
          </h1>
          <p id={ids.intro} className="weekly-form__intro">
            Send up to three finished tracks for a chance to be the next featured artist on
            Crash Weekly.
          </p>

          <ol className="weekly-form__steps" aria-label="Submission process">
            <li><span>01</span> Add your artist links</li>
            <li><span>02</span> Load your best MP3s</li>
            <li><span>03</span> Send the transmission</li>
          </ol>

          <p className="weekly-form__fine-print">
            MP3 only <span aria-hidden="true">&bull;</span> 20 MB maximum per track
            <span aria-hidden="true">&bull;</span> 1&ndash;3 tracks
          </p>
        </header>

        <form className="weekly-form" aria-busy={submitting} noValidate onSubmit={handleSubmit}>
          <div className="weekly-form__card-heading">
            <span>ARTIST INTAKE</span>
            <span aria-hidden="true">REC <i /></span>
          </div>

          {serverError && (
            <div className="weekly-form__alert" id={ids.serverError} role="alert">
              <strong>Transmission interrupted.</strong>
              <span>{serverError}</span>
            </div>
          )}

          <div className="weekly-form__field">
            <label htmlFor={ids.artistName}>Artist name</label>
            <input
              ref={fieldRefs.artistName}
              id={ids.artistName}
              name="artistName"
              type="text"
              autoComplete="organization"
              maxLength="80"
              value={values.artistName}
              aria-invalid={Boolean(errors.artistName)}
              aria-describedby={errors.artistName ? ids.artistNameError : undefined}
              onChange={updateValue}
              disabled={submitting}
              required
            />
            {errors.artistName && <p className="weekly-form__error" id={ids.artistNameError}>{errors.artistName}</p>}
          </div>

          <fieldset
            className="weekly-form__links"
            aria-describedby={`${ids.linksHint}${errors.links ? ` ${ids.linksError}` : ''}`}
          >
            <legend id={ids.linksLegend}>Artist links</legend>
            <p className="weekly-form__hint" id={ids.linksHint}>
              Add at least one. The other links can be left blank.
            </p>
            {errors.links && <p className="weekly-form__error" id={ids.linksError}>{errors.links}</p>}

            <div className="weekly-form__field">
              <label htmlFor={ids.instagramUrl}>Instagram profile URL</label>
              <input
                ref={fieldRefs.instagramUrl}
                id={ids.instagramUrl}
                name="instagramUrl"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://instagram.com/yourname"
                value={values.instagramUrl}
                aria-invalid={Boolean(errors.instagramUrl)}
                aria-describedby={`${ids.instagramUrlHint}${errors.instagramUrl ? ` ${ids.instagramUrlError}` : ''}`}
                onChange={updateValue}
                disabled={submitting}
              />
              <p className="weekly-form__hint" id={ids.instagramUrlHint}>Paste the full public profile link.</p>
              {errors.instagramUrl && <p className="weekly-form__error" id={ids.instagramUrlError}>{errors.instagramUrl}</p>}
            </div>

            <div className="weekly-form__field">
              <label htmlFor={ids.spotifyUrl}>Spotify artist URL</label>
              <input
                ref={fieldRefs.spotifyUrl}
                id={ids.spotifyUrl}
                name="spotifyUrl"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://open.spotify.com/artist/..."
                value={values.spotifyUrl}
                aria-invalid={Boolean(errors.spotifyUrl)}
                aria-describedby={`${ids.spotifyUrlHint}${errors.spotifyUrl ? ` ${ids.spotifyUrlError}` : ''}`}
                onChange={updateValue}
                disabled={submitting}
              />
              <p className="weekly-form__hint" id={ids.spotifyUrlHint}>Use the artist page, not an album or song link.</p>
              {errors.spotifyUrl && <p className="weekly-form__error" id={ids.spotifyUrlError}>{errors.spotifyUrl}</p>}
            </div>

            <div className="weekly-form__field">
              <label htmlFor={ids.appleMusicUrl}>Apple Music artist URL</label>
              <input
                ref={fieldRefs.appleMusicUrl}
                id={ids.appleMusicUrl}
                name="appleMusicUrl"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://music.apple.com/us/artist/..."
                value={values.appleMusicUrl}
                aria-invalid={Boolean(errors.appleMusicUrl)}
                aria-describedby={`${ids.appleMusicUrlHint}${errors.appleMusicUrl ? ` ${ids.appleMusicUrlError}` : ''}`}
                onChange={updateValue}
                disabled={submitting}
              />
              <p className="weekly-form__hint" id={ids.appleMusicUrlHint}>Use the artist page, not an album or song link.</p>
              {errors.appleMusicUrl && <p className="weekly-form__error" id={ids.appleMusicUrlError}>{errors.appleMusicUrl}</p>}
            </div>

            <div className="weekly-form__field">
              <label htmlFor={ids.soundcloudUrl}>SoundCloud profile URL</label>
              <input
                ref={fieldRefs.soundcloudUrl}
                id={ids.soundcloudUrl}
                name="soundcloudUrl"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://soundcloud.com/yourname"
                value={values.soundcloudUrl}
                aria-invalid={Boolean(errors.soundcloudUrl)}
                aria-describedby={`${ids.soundcloudUrlHint}${errors.soundcloudUrl ? ` ${ids.soundcloudUrlError}` : ''}`}
                onChange={updateValue}
                disabled={submitting}
              />
              <p className="weekly-form__hint" id={ids.soundcloudUrlHint}>Paste the full public artist profile link.</p>
              {errors.soundcloudUrl && <p className="weekly-form__error" id={ids.soundcloudUrlError}>{errors.soundcloudUrl}</p>}
            </div>
          </fieldset>

          <div className="weekly-form__field weekly-form__field--files">
            <label htmlFor={ids.songs}>Track uploads</label>
            <div className={`weekly-form__dropzone ${errors.songs ? 'has-error' : ''}`}>
              <span className="weekly-form__tape-icon" aria-hidden="true"><i /><i /></span>
              <strong>{files.length ? 'Change selected MP3s' : 'Choose 1–3 MP3s'}</strong>
              <span>Each file can be up to 20 MB</span>
              <input
                ref={fileInputRef}
                id={ids.songs}
                name="songs"
                type="file"
                accept=".mp3,audio/mpeg,audio/mp3"
                multiple
                aria-invalid={Boolean(errors.songs)}
                aria-describedby={`${ids.songsHint}${errors.songs ? ` ${ids.songsError}` : ''}`}
                onChange={updateFiles}
                disabled={submitting}
                required
              />
            </div>
            <p className="weekly-form__hint" id={ids.songsHint}>Select all tracks in one pass.</p>
            {errors.songs && <p className="weekly-form__error" id={ids.songsError}>{errors.songs}</p>}

            {files.length > 0 && (
              <ul className="weekly-form__file-list" aria-label="Selected tracks" aria-live="polite">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <strong>{file.name}</strong>
                    <small>{formatFileSize(file.size)}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="weekly-form__field weekly-form__field--rights">
            <label className="weekly-form__check" htmlFor={ids.rightsConfirmed}>
              <input
                ref={fieldRefs.rightsConfirmed}
                id={ids.rightsConfirmed}
                name="rightsConfirmed"
                type="checkbox"
                checked={values.rightsConfirmed}
                aria-invalid={Boolean(errors.rightsConfirmed)}
                aria-describedby={errors.rightsConfirmed ? ids.rightsConfirmedError : undefined}
                onChange={updateValue}
                disabled={submitting}
                required
              />
              <span aria-hidden="true" />
              <strong>I own these tracks or have permission to submit them for streaming.</strong>
            </label>
            {errors.rightsConfirmed && <p className="weekly-form__error" id={ids.rightsConfirmedError}>{errors.rightsConfirmed}</p>}
          </div>

          <div className="weekly-form__field weekly-form__field--turnstile">
            <div
              ref={turnstileContainerRef}
              tabIndex="-1"
              aria-label="Security check"
              aria-describedby={errors.turnstileToken || turnstileLoadError ? ids.turnstileError : undefined}
            />
            {(errors.turnstileToken || turnstileLoadError) && (
              <div>
                <p className="weekly-form__error" id={ids.turnstileError}>
                  {turnstileLoadError || errors.turnstileToken}
                </p>
                {turnstileLoadError && (
                  <button className="weekly-form__button weekly-form__button--quiet weekly-form__turnstile-retry" type="button" onClick={retryTurnstile}>
                    Retry security check
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="weekly-form__website" aria-hidden="true">
            <label htmlFor={ids.website}>Website</label>
            <input
              id={ids.website}
              name="website"
              type="text"
              value={values.website}
              autoComplete="off"
              tabIndex="-1"
              onChange={updateValue}
            />
          </div>

          <button
            className="weekly-form__submit"
            type="submit"
            disabled={submitting || !submissionMinimumsMet}
          >
            <span>{submitting ? 'Sending transmission…' : 'Submit to Crash Weekly'}</span>
            <i aria-hidden="true" />
          </button>
          <p className="weekly-form__privacy">
            Your files are used only to review and feature your submission.
          </p>
        </form>
      </div>
    </section>
  )
}
