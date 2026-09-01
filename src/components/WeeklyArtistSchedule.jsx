import { useEffect, useId, useRef } from 'react'

const STATUS_LABELS = {
  past: 'PAST',
  current: 'CURRENT',
  future: 'FUTURE',
}

function focusableElements(container) {
  return [...container.querySelectorAll(
    'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
  )]
}

export function WeeklyArtistSchedule({ open, onClose, schedule = [] }) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const currentArtistRef = useRef(null)
  const previousFocusRef = useRef(null)
  const currentArtist = schedule.find((artist) => artist.status === 'current')
  const currentScheduleIndex = currentArtist?.scheduleIndex

  useEffect(() => {
    if (!open) return undefined

    previousFocusRef.current = document.activeElement
    window.requestAnimationFrame(() => {
      closeRef.current?.focus()
    })

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const controls = focusableElements(dialogRef.current)
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus?.()
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    window.requestAnimationFrame(() => {
      currentArtistRef.current?.scrollIntoView({ block: 'center' })
    })
  }, [currentScheduleIndex, open])

  if (!open) return null

  return (
    <div
      className="weekly-artists-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="weekly-artists-modal__dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="weekly-artists-modal__header">
          <div>
            <p className="weekly-artists-modal__eyebrow">CRASH WEEKLY // ROTATION LOG</p>
            <h2 id={titleId}>Weekly artists</h2>
          </div>
          <button
            className="weekly-artists-modal__close"
            ref={closeRef}
            type="button"
            aria-label="Close weekly artist list"
            onClick={onClose}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </header>

        <p className="weekly-artists-modal__intro" id={descriptionId}>
          The complete broadcast order, from past features to artists still ahead.
        </p>
        <p className="sr-only" aria-live="polite">
          {currentArtist ? `Current weekly artist: ${currentArtist.name}.` : 'No current weekly artist.'}
        </p>

        {schedule.length ? (
          <ol
            className="weekly-artists-modal__list"
            aria-label="Past, current, and future weekly artists"
            tabIndex={0}
          >
            {schedule.map((artist, index) => {
              const status = STATUS_LABELS[artist.status] || STATUS_LABELS.future
              const isCurrent = artist.status === 'current'
              return (
                <li
                  className={`weekly-artists-modal__artist weekly-artists-modal__artist--${artist.status || 'future'}`}
                  key={artist.scheduleIndex ?? index}
                  ref={isCurrent ? currentArtistRef : undefined}
                  aria-current={isCurrent ? 'true' : undefined}
                >
                  <span className="weekly-artists-modal__number">
                    CW-{String((artist.scheduleIndex ?? index) + 1).padStart(3, '0')}
                  </span>
                  <strong>{artist.name}</strong>
                  <span className="weekly-artists-modal__status">
                    {isCurrent && <i aria-hidden="true" />}
                    {status}
                  </span>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="weekly-artists-modal__empty">No weekly artists are scheduled yet.</p>
        )}
      </section>
    </div>
  )
}
