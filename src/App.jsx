import { useRef, useState } from 'react'
import { Boombox } from './components/Boombox'
import { Cassette, CassetteSpine } from './components/Cassette'
import { MixtapeShelf } from './components/MixtapeShelf'
import { mixtapes, socials } from './data/mixtapes'
import { useAudioPlayer } from './hooks/useAudioPlayer'

export default function App() {
  const visualizerRef = useRef(null)
  const deckTargetRef = useRef(null)
  const flightIdRef = useRef(0)
  const [flyingTape, setFlyingTape] = useState(null)
  const [deckMixtape, setDeckMixtape] = useState(null)
  const player = useAudioPlayer(mixtapes, visualizerRef)

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
    <main className="app-stage">
      <div className="wallpaper-grain" aria-hidden="true" />
      <MixtapeShelf
        mixtapes={mixtapes}
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
        socials={socials}
        isLoading={Boolean(flyingTape)}
        deckMixtape={deckMixtape}
        deckTargetRef={deckTargetRef}
        visualizerRef={visualizerRef}
      />

      <audio ref={player.audioRef} preload="metadata" {...player.audioEvents} />
      <p className="sr-only" aria-live="polite">
        {player.currentTrack
          ? `${player.isPlaying ? 'Playing' : 'Paused'} ${player.currentTrack.title} from ${player.activeMixtape.title}`
          : 'Select a mixtape to begin.'}
      </p>
    </main>
  )
}
