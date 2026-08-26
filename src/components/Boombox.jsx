import { Music2, Radio, Volume2 } from 'lucide-react'
import { PixelDisplay } from './PixelDisplay'
import { Speaker } from './Speaker'
import { TapeDeck } from './TapeDeck'
import { TransportControls } from './TransportControls'

export function Boombox({
  player,
  socials,
  isLoading,
  deckMixtape,
  deckTargetRef,
  visualizerRef,
}) {
  return (
    <section
      className={`boombox ${player.isPlaying ? 'is-playing' : ''} ${player.analyserReady ? 'has-analyser' : ''}`}
      ref={visualizerRef}
      aria-label="Crash Beats boombox player"
    >
      <div className="boombox__handle" aria-hidden="true">
        <span className="handle-grip" />
      </div>
      <div className="boombox__top-edge" aria-hidden="true">
        <i /><i /><i /><i /><i /><i />
      </div>

      <div className="boombox__face">
        <header className="face-header">
          <div className="crash-mark" aria-label="Crash Beats">
            <span className="crash-mark__bolt">ϟ</span>
            <span className="crash-mark__words">
              <strong>CRASH</strong>
              <small>BEATS</small>
            </span>
          </div>

          <div className="radio-scale" aria-hidden="true">
            <div className="radio-scale__labels">
              <span>88</span><span>92</span><span>98</span><span>104</span><span>108</span>
            </div>
            <div className="radio-scale__line">
              <i /><i /><i /><i /><i /><i /><i /><i /><i />
              <span className="radio-needle" />
            </div>
          </div>

          <div className="source-panel">
            <span className={`power-led ${player.currentTrack ? 'is-on' : ''}`} aria-hidden="true" />
            {socials.map((social) => (
              <a
                key={social.id}
                className="social-preset"
                href={social.href}
                target="_blank"
                rel="noreferrer"
                aria-label={social.label}
                title={social.label}
                onClick={player.playClick}
              >
                {social.id === 'instagram' ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx="17.6" cy="6.7" r="1.15" fill="currentColor" stroke="none" />
                  </svg>
                ) : social.id === 'spotify' ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
                    <path d="M6.8 9.1c3.7-1.1 7.8-.8 10.8.8M7.5 12.3c3.1-.8 6.5-.5 9.3.8M8.2 15.3c2.7-.6 5.3-.35 7.8.75" fill="none" stroke="#252520" strokeWidth="1.45" strokeLinecap="round" />
                  </svg>
                ) : (
                  <Music2 aria-hidden="true" />
                )}
                <span>{social.shortLabel}</span>
              </a>
            ))}
          </div>
        </header>

        <div className="boombox__main-grid">
          <Speaker side="left" />

          <div className="boombox__center">
            <PixelDisplay
              mixtape={player.activeMixtape}
              track={player.currentTrack}
              trackIndex={player.trackIndex}
              currentTime={player.currentTime}
              duration={player.duration}
              remainingTime={player.remainingTime}
              isPlaying={player.isPlaying}
              isShuffle={player.isShuffle}
              error={player.error}
              onSeek={player.seek}
            />
            <TapeDeck
              mixtape={deckMixtape}
              isPlaying={player.isPlaying}
              isLoading={isLoading}
              targetRef={deckTargetRef}
            />
            <TransportControls
              isPlaying={player.isPlaying}
              isShuffle={player.isShuffle}
              hasTrack={Boolean(player.currentTrack)}
              onPrevious={player.previous}
              onPlay={player.play}
              onPause={player.pause}
              onNext={player.next}
              onShuffle={player.toggleShuffle}
            />
          </div>

          <Speaker side="right" />
        </div>

        <footer className="face-footer">
          <label className="volume-control">
            <Volume2 aria-hidden="true" />
            <span>VOLUME</span>
            <span
              className="volume-knob"
              style={{ '--knob-turn': `${-135 + player.volume * 270}deg` }}
              aria-hidden="true"
            >
              <i />
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={player.volume}
              aria-label="Volume"
              onChange={(event) => player.setVolume(Number(event.target.value))}
            />
          </label>

          <div className="footer-badge" aria-hidden="true">
            <Radio />
            <span>ORIGINAL SOUND SYSTEM</span>
          </div>

          <div className="model-stamp" aria-hidden="true">
            <strong>CRASH-808</strong>
            <span>STEREO BEAT MACHINE</span>
          </div>
        </footer>
      </div>
    </section>
  )
}
