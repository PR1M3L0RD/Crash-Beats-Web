export function Cassette({ mixtape, compact = false }) {
  return (
    <span
      className={`cassette ${compact ? 'cassette--compact' : ''}`}
      style={{
        '--tape-accent': mixtape.accent,
        '--tape-accent-2': mixtape.accent2,
        '--tape-ink': mixtape.ink,
      }}
      aria-hidden="true"
    >
      <span className="cassette__corner cassette__corner--tl" />
      <span className="cassette__corner cassette__corner--tr" />
      <span className="cassette__label">
        <span className="cassette__catalog">{mixtape.catalog}</span>
        <span className="cassette__title">{mixtape.title}</span>
        <span className="cassette__scribble">CRASH BEATS</span>
      </span>
      <span className="cassette__window">
        <span className="cassette__reel" />
        <span className="cassette__tape-line" />
        <span className="cassette__reel" />
      </span>
      <span className="cassette__side">{mixtape.side}</span>
    </span>
  )
}

