import { Cassette } from './Cassette'

export function MixtapeShelf({ mixtapes, activeId, onSelect }) {
  return (
    <section className="shelf-zone" aria-label="Mixtape shelf">
      <div className="shelf-heading" aria-hidden="true">
        <span>CRASH BEATS ARCHIVE</span>
        <span>SELECT A TAPE</span>
      </div>
      <div className="mixtape-row">
        {mixtapes.map((mixtape, index) => (
          <button
            className={`mixtape ${activeId === mixtape.id ? 'is-active' : ''}`}
            key={mixtape.id}
            type="button"
            style={{ '--tape-tilt': `${[-2.5, 1.5, -1, 2.2, -1.8][index]}deg` }}
            aria-label={`Play ${mixtape.title}, ${mixtape.tracks.length} tracks`}
            aria-pressed={activeId === mixtape.id}
            onClick={(event) => onSelect(mixtape, event)}
          >
            <Cassette mixtape={mixtape} />
            <span className="mixtape__count">{mixtape.tracks.length} TRACKS</span>
          </button>
        ))}
      </div>
      <div className="wood-shelf">
        <span className="wood-shelf__highlight" />
        <span className="wood-shelf__edge" />
      </div>
    </section>
  )
}

