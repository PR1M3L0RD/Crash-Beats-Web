import { Apple, Download, ListMusic, LoaderCircle, Music2, UserPlus, UserRound, Volume2 } from 'lucide-react'
import { PixelDisplay } from './PixelDisplay'
import { RadioTuner } from './RadioTuner'
import { Speaker } from './Speaker'
import { TapeDeck } from './TapeDeck'
import { TransportControls } from './TransportControls'

function SocialIcon({ id }) {
  if (id === 'youtube') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" />
        <path d="m10 8 6 4-6 4Z" fill="#3b1713" />
      </svg>
    )
  }
  if (id === 'instagram') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="17.6" cy="6.7" r="1.15" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  if (id === 'spotify') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
        <path d="M6.8 9.1c3.7-1.1 7.8-.8 10.8.8M7.5 12.3c3.1-.8 6.5-.5 9.3.8M8.2 15.3c2.7-.6 5.3-.35 7.8.75" fill="none" stroke="#252520" strokeWidth="1.45" strokeLinecap="round" />
      </svg>
    )
  }

  if (id === 'apple') return <Apple aria-hidden="true" />

  if (id === 'soundcloud') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1" y="14" width="1.4" height="4" rx="0.7" fill="currentColor" />
        <rect x="3.5" y="12.5" width="1.4" height="7" rx="0.7" fill="currentColor" />
        <rect x="6" y="10.5" width="1.4" height="10.5" rx="0.7" fill="currentColor" />
        <rect x="8.5" y="9" width="1.4" height="12" rx="0.7" fill="currentColor" />
        <path d="M10.8 8.8a5.7 5.7 0 0 1 8.1 4.4h.2a3.4 3.4 0 1 1 0 6.8h-8.3Z" fill="currentColor" />
      </svg>
    )
  }

  if (id === 'tiktok') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 3h3.1c.25 1.85 1.35 3.25 3.4 3.85V10a8.2 8.2 0 0 1-3.4-1.2v6a6.3 6.3 0 1 1-6.3-6.3v3.25a3.05 3.05 0 1 0 3.2 3.05Z" fill="currentColor" />
      </svg>
    )
  }

  return <Music2 aria-hidden="true" />
}

export function Boombox({
  player,
  socials,
  isLoading,
  deckMixtape,
  deckTargetRef,
  visualizerRef,
  onApply,
  tunerPosition,
  onTune,
  account,
  isDownloading,
  onDownload,
  onOpenAccount,
  onOpenWeeklyArtists,
}) {
  const weeklyMixtape = player.activeMixtape?.isWeekly
  const youtubeHref = socials.find((social) => social.id === 'youtube')?.href
  const currentTrackIsDownloadable = Boolean(player.currentTrack && !weeklyMixtape)
  const downloadCredits = account?.credits ?? 0
  const downloadDisabled =
    !currentTrackIsDownloadable ||
    !account?.user ||
    account?.loading ||
    downloadCredits < 1 ||
    isDownloading
  const downloadHint = !player.currentTrack
    ? 'Select a regular Crash Beats song to download'
    : weeklyMixtape
      ? 'Crash Weekly spotlight songs are streaming only'
      : !account?.user
        ? 'Sign in to download this song'
        : account?.loading
          ? 'Checking your download credits'
          : downloadCredits < 1
            ? 'Visit Crash Weekly next week to earn more download credits'
            : `Download ${player.currentTrack.title} for 1 credit`

  return (
    <section
      className={`boombox ${weeklyMixtape ? 'is-weekly' : ''} ${player.isPlaying ? 'is-playing' : ''} ${player.analyserReady ? 'has-analyser' : ''}`}
      ref={visualizerRef}
      aria-label={weeklyMixtape ? `Crash Weekly featuring ${player.activeMixtape.artist}` : 'Crash Beats boombox player'}
    >
      <div className="boombox__handle" aria-hidden="true">
        <span className="handle-grip" />
      </div>
      <div className="boombox__top-edge" aria-hidden="true">
        <i /><i /><i /><i /><i /><i />
      </div>

      <div className="boombox__face">
        <header className="face-header">
          {weeklyMixtape ? (
            <div className="weekly-header-presets">
              <a
                className="weekly-playlist-preset"
                href="https://open.spotify.com/embed/playlist/6x0UtOX1pL5oaJyldZrnCW?utm_source=generator&si=948f32c49e5e4670"
                target="_blank"
                rel="noreferrer"
                aria-label="Open the Crash Weekly playlist"
                title="Open the Crash Weekly playlist"
                onClick={player.playClick}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
                  <path d="M6.8 9.1c3.7-1.1 7.8-.8 10.8.8M7.5 12.3c3.1-.8 6.5-.5 9.3.8M8.2 15.3c2.7-.6 5.3-.35 7.8.75" fill="none" stroke="#252520" strokeWidth="1.45" strokeLinecap="round" />
                </svg>
                <span>PLAYLIST</span>
              </a>
              <button
                className="weekly-playlist-preset weekly-artists-preset"
                type="button"
                aria-label="View all weekly artists"
                title="View all weekly artists"
                onClick={() => {
                  player.playClick()
                  onOpenWeeklyArtists?.()
                }}
              >
                <ListMusic aria-hidden="true" />
                <span>ARTISTS</span>
              </button>
            </div>
          ) : (
            <div className="regular-header-presets">
              <button
                className="download-preset"
                type="button"
                disabled={downloadDisabled}
                aria-label={downloadHint}
                title={downloadHint}
                onClick={() => onDownload?.(player.currentTrack)}
              >
                {isDownloading ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Download aria-hidden="true" />}
                <span>{isDownloading ? 'SAVING' : 'DOWNLOAD'}</span>
                <small>{account?.user ? `${downloadCredits} CR` : 'SIGN IN'}</small>
              </button>
              {youtubeHref ? <a className="download-preset youtube-preset" href={youtubeHref} target="_blank" rel="noreferrer"
                aria-label="Crash Beats on YouTube" title="Crash Beats on YouTube" onClick={player.playClick}>
                <SocialIcon id="youtube" /><span>YOUTUBE</span><small>CHANNEL</small>
              </a> : <button className="download-preset youtube-preset" type="button" disabled
                aria-label="Crash Beats YouTube channel link is coming soon" title="YouTube channel link is coming soon">
                <SocialIcon id="youtube" /><span>YOUTUBE</span><small>SOON</small>
              </button>}
            </div>
          )}
          <h1 className="crash-mark" aria-label="Crash Beats">
            <span className="crash-mark__bolt">ϟ</span>
            <span className="crash-mark__words">
              <strong>CRASH</strong>
              <small>{weeklyMixtape ? 'WEEKLY' : 'BEATS'}</small>
            </span>
          </h1>

          {weeklyMixtape ? (
            <div className="weekly-tuner" aria-label={`Artist of the week: ${player.activeMixtape.artist}`}>
              <span>ARTIST OF THE WEEK</span>
              <strong>{player.activeMixtape.artist}</strong>
            </div>
          ) : (
            <RadioTuner value={tunerPosition} onChange={onTune} />
          )}

          <div className={`source-panel ${weeklyMixtape ? 'source-panel--weekly' : ''}`}>
            <span className={`power-led ${player.currentTrack ? 'is-on' : ''}`} aria-hidden="true" />
            {socials.filter((social) => social.id !== 'youtube').map((social) => social.href ? (
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
                <SocialIcon id={social.id} />
                <span>{social.shortLabel}</span>
              </a>
            ) : (
              <button
                key={social.id}
                className="social-preset social-preset--unavailable"
                type="button"
                disabled
                aria-label={`${social.label} is unavailable`}
                title={`${social.label} is unavailable`}
              >
                <SocialIcon id={social.id} />
                <span>{social.shortLabel}</span>
              </button>
            ))}
            {weeklyMixtape && (
              <button
                className="social-preset weekly-apply-preset"
                type="button"
                aria-label="Apply to be featured on Crash Weekly"
                title="Apply to Crash Weekly"
                onClick={onApply}
              >
                <UserPlus aria-hidden="true" />
                <span>APPLY</span>
              </button>
            )}
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

          <button
            className="account-preset"
            type="button"
            aria-label={account?.user
              ? `Open account for ${account.displayName || account.user.name || account.user.email}. ${downloadCredits} download credit${downloadCredits === 1 ? '' : 's'} available.`
              : 'Sign in or create an account'}
            title={account?.user ? 'Open account' : 'Sign in or create an account'}
            onClick={onOpenAccount}
          >
            <UserRound aria-hidden="true" />
            <span>{account?.user ? (account.displayName || account.user.name || 'MY ACCOUNT') : 'SIGN IN'}</span>
            <strong>{account?.user ? `${downloadCredits} DL` : 'ACCOUNT'}</strong>
          </button>

          <div className="model-stamp" aria-hidden="true">
            <strong>{weeklyMixtape ? 'CRASH-W' : 'CRASH-808'}</strong>
            <span>{weeklyMixtape ? 'WEEKLY ARTIST EDITION' : 'STEREO BEAT MACHINE'}</span>
          </div>
        </footer>
      </div>
    </section>
  )
}
