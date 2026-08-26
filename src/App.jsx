import { useRef, useState } from 'react'
import { Boombox } from './components/Boombox'
import { CassetteSpine } from './components/Cassette'
import { MixtapeShelf } from './components/MixtapeShelf'
import { mixtapes, socials } from './data/mixtapes'
import { useAudioPlayer } from './hooks/useAudioPlayer'

export default function App() {
  const visualizerRef = useRef(null)
  const [flyingTape, setFlyingTape] = useState(null)
  const [deckMixtape, setDeckMixtape] = useState(null)
  const player = useAudioPlayer(mixtapes, visualizerRef)

  const handleSelectMixtape = (mixtape, event) => {
    player.playClick()
    const rect = event.currentTarget.getBoundingClientRect()

    setDeckMixtape(null)
    setFlyingTape({
      mixtape,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    })
    player.selectMixtape(mixtape)
  }

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
          onAnimationEnd={() => {
            setDeckMixtape(flyingTape.mixtape)
            setFlyingTape(null)
          }}
        >
          <CassetteSpine mixtape={flyingTape.mixtape} />
        </div>
      )}

      <Boombox
        player={player}
        socials={socials}
        isLoading={Boolean(flyingTape)}
        deckMixtape={deckMixtape}
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
