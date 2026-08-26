export function TapeDeck({ mixtape, isPlaying, isLoading }) {
  return (
    <div className={`tape-deck ${isLoading ? 'is-loading' : ''}`}>
      <div className="tape-deck__door">
        <div className="tape-deck__glass">
          {mixtape ? (
            <div
              className="loaded-tape"
              style={{
                '--tape-accent': mixtape.accent,
                '--tape-accent-2': mixtape.accent2,
              }}
            >
              <div className="loaded-tape__label">
                <span>{mixtape.catalog}</span>
                <strong>{mixtape.title}</strong>
              </div>
              <div className="loaded-tape__reels">
                <i className={isPlaying ? 'is-spinning' : ''} />
                <span />
                <i className={isPlaying ? 'is-spinning is-reverse' : ''} />
              </div>
            </div>
          ) : (
            <span className="empty-deck">NO TAPE</span>
          )}
        </div>
      </div>
      <span className="tape-deck__caption">AUTO REVERSE · FULL LOGIC CONTROL</span>
    </div>
  )
}

