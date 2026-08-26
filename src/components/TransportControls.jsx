import { Pause, Play, Shuffle, SkipBack, SkipForward } from 'lucide-react'

function TransportButton({ label, icon: Icon, active = false, onClick }) {
  return (
    <button
      type="button"
      className={`transport-button ${active ? 'is-latched' : ''}`}
      aria-label={label}
      aria-pressed={label === 'Shuffle' ? active : undefined}
      onClick={onClick}
    >
      <span className="transport-button__cap">
        <Icon aria-hidden="true" strokeWidth={2.8} />
      </span>
      <span className="transport-button__label">{label}</span>
    </button>
  )
}

export function TransportControls({
  isPlaying,
  isShuffle,
  hasTrack,
  onPrevious,
  onPlay,
  onPause,
  onNext,
  onShuffle,
}) {
  return (
    <div className="transport" aria-label="Playback controls">
      <TransportButton label="Previous" icon={SkipBack} onClick={onPrevious} />
      <TransportButton label="Play" icon={Play} active={hasTrack && isPlaying} onClick={onPlay} />
      <TransportButton label="Pause" icon={Pause} active={hasTrack && !isPlaying} onClick={onPause} />
      <TransportButton label="Next" icon={SkipForward} onClick={onNext} />
      <TransportButton label="Shuffle" icon={Shuffle} active={isShuffle} onClick={onShuffle} />
    </div>
  )
}

