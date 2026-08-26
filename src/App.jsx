import { useEffect, useRef, useState } from 'react'
import { Boombox } from './components/Boombox'
import { Cassette } from './components/Cassette'
import { MixtapeShelf } from './components/MixtapeShelf'
import { mixtapes, socials } from './data/mixtapes'
import { useAudioPlayer } from './hooks/useAudioPlayer'

export default function App() {
  const visualizerRef = useRef(null)
  const insertTimerRef = useRef(null)
  const [flyingTape, setFlyingTape] = useState(null)
  const player = useAudioPlayer(mixtapes, visualizerRef)

  const handleSelectMixtape = (mixtape, event) => {
    player.playClick()
    const rect = event.currentTarget.getBoundingClientRect()

    window.clearTimeout(insertTimerRef.current)
    setFlyingTape({
      mixtape,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    })
    insertTimerRef.current = window.setTimeout(() => setFlyingTape(null), 840)
    player.selectMixtape(mixtape)
  }

  useEffect(
    () => () => {
      window.clearTimeout(insertTimerRef.current)
    },
    [],
  )

  return (
    <main className="app-stage">
      <div className="wallpaper-grain" aria-hidden="true" />
      <MixtapeShelf
        mixtapes={mixtapes}
        activeId={player.activeMixtape?.id}
        onSelect={handleSelectMixtape}
      />

      {flyingTape && (
        <div
          className="flying-tape"
          style={{
            '--fly-left': `${flyingTape.left}px`,
            '--fly-top': `${flyingTape.top}px`,
            '--fly-width': `${flyingTape.width}px`,
            '--fly-height': `${flyingTape.height}px`,
          }}
          aria-hidden="true"
        >
          <Cassette mixtape={flyingTape.mixtape} compact />
        </div>
      )}

      <Boombox
        player={player}
        socials={socials}
        isLoading={Boolean(flyingTape)}
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
