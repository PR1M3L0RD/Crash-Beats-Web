import { formatTime } from '../utils/player'

export function PixelDisplay({
  mixtape,
  track,
  trackIndex,
  currentTime,
  duration,
  remainingTime,
  isPlaying,
  isShuffle,
  error,
  onSeek,
}) {
  const progress = duration ? (currentTime / duration) * 100 : 0
  const status = error || (track ? (isPlaying ? 'PLAY' : 'PAUSE') : 'READY')

  return (
    <div className="display-shell">
      <div className="display-screws" aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="pixel-display" aria-live="polite">
        <div className="pixel-display__topline">
          <span>{mixtape ? mixtape.catalog : 'CB-TAPE DECK'}</span>
          <span className={error ? 'display-error' : ''}>{status}</span>
          <span>
            {track && mixtape
              ? `${String(trackIndex + 1).padStart(2, '0')}/${String(mixtape.tracks.length).padStart(2, '0')}`
              : '--/--'}
          </span>
        </div>
        <div className="pixel-display__track">
          <span className="pixel-display__title">
            {track ? track.title : 'SELECT A MIXTAPE'}
          </span>
          <span className="pixel-display__credit">
            {track ? track.credit : 'FROM THE SHELF ABOVE'}
          </span>
        </div>
        <div className="pixel-display__meter">
          <span className="time-code">{formatTime(currentTime)}</span>
          <div className="progress-wrap">
            <div className="progress-leds" style={{ '--progress': `${progress}%` }} />
            <input
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || 0)}
              aria-label="Song progress"
              aria-valuetext={`${formatTime(currentTime)} elapsed, ${formatTime(remainingTime)} remaining`}
              disabled={!track || !duration}
              onChange={(event) => onSeek(Number(event.target.value))}
            />
          </div>
          <span className="time-code">−{formatTime(remainingTime)}</span>
        </div>
        <div className="pixel-display__flags" aria-hidden="true">
          <span className={isShuffle ? 'is-lit' : ''}>SHUF</span>
          <span>STEREO</span>
          <span className={isPlaying ? 'is-lit' : ''}>▶</span>
        </div>
      </div>
    </div>
  )
}

