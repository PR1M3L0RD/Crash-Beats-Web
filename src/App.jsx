import { useEffect, useMemo, useRef, useState } from 'react'
import { Boombox } from './components/Boombox'
import { Cassette, CassetteSpine } from './components/Cassette'
import { MixtapeShelf } from './components/MixtapeShelf'
import { SecretStation } from './components/SecretStation'
import { WeeklySubmissionForm } from './components/WeeklySubmissionForm'
import { createWeeklyMixtape, mixtapes, socials } from './data/mixtapes'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useCatalog } from './hooks/useCatalog'
import { useWeeklyArtist } from './hooks/useWeeklyArtist'
import secretSignal from './assets/secret-signal-animated.gif'

const TUNER_MAX = 108
const DEFAULT_TUNER_POSITION = 95.6

export default function App() {
  const visualizerRef = useRef(null)
  const deckTargetRef = useRef(null)
  const flightIdRef = useRef(0)
  const [flyingTape, setFlyingTape] = useState(null)
  const [deckMixtape, setDeckMixtape] = useState(null)
  const [tunerPosition, setTunerPosition] = useState(DEFAULT_TUNER_POSITION)
  const [isSubmissionOpen, setIsSubmissionOpen] = useState(
    () => window.location.pathname === '/weekly/apply',
  )
  const weekly = useWeeklyArtist()
  const catalogMixtapes = useCatalog(mixtapes)
  const weeklyMixtape = useMemo(
    () => createWeeklyMixtape(weekly.artist, weekly.tracks),
    [weekly],
  )
  const availableMixtapes = useMemo(
    () => [weeklyMixtape, ...catalogMixtapes],
    [catalogMixtapes, weeklyMixtape],
  )
  const player = useAudioPlayer(availableMixtapes, visualizerRef)
  const isSecretStation = tunerPosition >= TUNER_MAX
  const isWeekly = Boolean(player.activeMixtape?.isWeekly)
  const activeSocials = isWeekly ? player.activeMixtape.socials : socials

  useEffect(() => {
    const handlePopState = () => {
      setIsSubmissionOpen(window.location.pathname === '/weekly/apply')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const openSubmissionForm = () => {
    player.pause()
    window.history.pushState({}, '', '/weekly/apply')
    setIsSubmissionOpen(true)
  }

  const closeSubmissionForm = () => {
    window.history.replaceState({}, '', '/')
    setIsSubmissionOpen(false)
  }

  const handleSelectMixtape = (mixtape, event) => {
    player.playClick()
    const sourceRect = event.currentTarget.getBoundingClientRect()
    const deckRect = deckTargetRef.current?.getBoundingClientRect()

    if (!deckRect) return

    const sourceX = sourceRect.left + sourceRect.width / 2
    const sourceY = sourceRect.top + sourceRect.height / 2
    const targetX = deckRect.left + deckRect.width / 2
    const targetY = deckRect.top + deckRect.height / 2
    const faceWidth = deckRect.width * 0.78
    const faceHeight = faceWidth / 1.58
    const seatedHeight = deckRect.height * 0.72
    const seatedRatio = Math.min(1, seatedHeight / faceHeight)
    const seatTilt = Math.acos(seatedRatio) * (180 / Math.PI)
    const liftDistance = Math.min(
      18,
      sourceRect.height * 0.1,
      Math.max(0, sourceRect.top - 4),
    )
    const approachY = targetY - faceHeight * 0.62
    const flipProgress = 0.52

    setDeckMixtape(null)
    setFlyingTape({
      id: flightIdRef.current += 1,
      mixtape,
      sourceX,
      sourceY,
      sourceWidth: event.currentTarget.offsetWidth,
      sourceHeight: event.currentTarget.offsetHeight,
      liftY: sourceY - liftDistance,
      flipX: sourceX + (targetX - sourceX) * 0.42,
      flipY: sourceY + (approachY - sourceY) * flipProgress,
      approachY,
      entryY: targetY - faceHeight * 0.18,
      targetX,
      targetY,
      faceWidth,
      faceHeight,
      seatTilt,
      startTilt:
        getComputedStyle(event.currentTarget).getPropertyValue('--tape-tilt').trim() || '0deg',
    })
    player.selectMixtape(mixtape)
  }

  return (
    <main className={`app-stage ${!isSubmissionOpen && isWeekly ? 'is-weekly' : ''}`}>
      {isSubmissionOpen ? (
        <WeeklySubmissionForm onClose={closeSubmissionForm} />
      ) : (
        <>
          <div className="wallpaper-grain" aria-hidden="true" />
          <MixtapeShelf
            mixtapes={availableMixtapes}
            activeId={player.activeMixtape?.id}
            loadingId={flyingTape?.mixtape.id}
            onSelect={handleSelectMixtape}
          />

          {flyingTape && (
            <div
              key={flyingTape.id}
              className="flying-tape"
              style={{
                '--flight-source-x': `${flyingTape.sourceX}px`,
                '--flight-source-y': `${flyingTape.sourceY}px`,
                '--flight-source-width': `${flyingTape.sourceWidth}px`,
                '--flight-source-height': `${flyingTape.sourceHeight}px`,
                '--flight-lift-y': `${flyingTape.liftY}px`,
                '--flight-flip-x': `${flyingTape.flipX}px`,
                '--flight-flip-y': `${flyingTape.flipY}px`,
                '--flight-approach-y': `${flyingTape.approachY}px`,
                '--flight-entry-y': `${flyingTape.entryY}px`,
                '--flight-target-x': `${flyingTape.targetX}px`,
                '--flight-target-y': `${flyingTape.targetY}px`,
                '--flight-face-width': `${flyingTape.faceWidth}px`,
                '--flight-face-height': `${flyingTape.faceHeight}px`,
                '--flight-seat-tilt-mid': `${flyingTape.seatTilt * 0.45}deg`,
                '--flight-seat-tilt': `${flyingTape.seatTilt}deg`,
                '--flight-start-tilt': flyingTape.startTilt,
              }}
              aria-hidden="true"
              onAnimationEnd={(event) => {
                if (event.target !== event.currentTarget) return
                setDeckMixtape(flyingTape.mixtape)
                setFlyingTape(null)
              }}
            >
              <span className="flying-tape__spine">
                <CassetteSpine mixtape={flyingTape.mixtape} />
              </span>
              <span className="flying-tape__face">
                <Cassette mixtape={flyingTape.mixtape} />
              </span>
            </div>
          )}

          <Boombox
            player={player}
            socials={activeSocials}
            isLoading={Boolean(flyingTape)}
            deckMixtape={deckMixtape}
            deckTargetRef={deckTargetRef}
            visualizerRef={visualizerRef}
            onApply={openSubmissionForm}
            tunerPosition={tunerPosition}
            onTune={setTunerPosition}
          />

          {isSecretStation && (
            <SecretStation
              imageSrc={secretSignal}
              tunerPosition={tunerPosition}
              onTune={setTunerPosition}
            />
          )}
        </>
      )}

      <audio ref={player.audioRef} preload="metadata" {...player.audioEvents} />
      <p className="sr-only" aria-live="polite">
        {player.currentTrack
          ? `${player.isPlaying ? 'Playing' : 'Paused'} ${player.currentTrack.title} from ${player.activeMixtape.title}`
          : 'Select a mixtape to begin.'}
      </p>
    </main>
  )
}
