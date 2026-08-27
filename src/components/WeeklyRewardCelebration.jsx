import { useEffect, useId, useRef } from 'react'

const CONFETTI_PIECES = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  lane: (index * 37) % 100,
  delay: (index % 6) * 90,
  turn: (index * 47) % 360,
}))

export function WeeklyRewardCelebration({
  open,
  amount = 2,
  credits,
  onClose,
  autoDismissMs = 5200,
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dismissRef = useRef(null)
  const previousFocusRef = useRef(null)

  useEffect(() => {
    if (!open || !autoDismissMs || !onClose) return undefined
    const timeout = window.setTimeout(onClose, autoDismissMs)
    return () => window.clearTimeout(timeout)
  }, [autoDismissMs, onClose, open])

  useEffect(() => {
    if (!open) return undefined
    previousFocusRef.current = document.activeElement
    window.requestAnimationFrame(() => dismissRef.current?.focus())

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && onClose) {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        dismissRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus?.()
    }
  }, [onClose, open])

  if (!open) return null

  return (
    <section
      className="weekly-reward-celebration"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="weekly-reward-celebration__confetti" aria-hidden="true">
        {CONFETTI_PIECES.map((piece) => (
          <i
            key={piece.id}
            className={`weekly-reward-celebration__confetti-piece weekly-reward-celebration__confetti-piece--${piece.id % 4}`}
            style={{
              '--confetti-lane': `${piece.lane}%`,
              '--confetti-delay': `${piece.delay}ms`,
              '--confetti-turn': `${piece.turn}deg`,
            }}
          />
        ))}
      </div>
      <div className="weekly-reward-celebration__card">
        <p className="weekly-reward-celebration__eyebrow">CRASH WEEKLY // DROP UNLOCKED</p>
        <div className="weekly-reward-celebration__credit-mark" aria-hidden="true">+{amount}</div>
        <h2 id={titleId}>Two fresh download credits.</h2>
        <p id={descriptionId}>
          Your weekly visit paid off. Pick any regular Crash Beats track and make it yours.
        </p>
        {Number.isFinite(credits) && (
          <p className="weekly-reward-celebration__balance">
            New balance <strong>{credits}</strong>
          </p>
        )}
        {onClose && (
          <button ref={dismissRef} className="weekly-reward-celebration__dismiss" type="button" onClick={onClose}>
            Back to the boombox
          </button>
        )}
      </div>
    </section>
  )
}
