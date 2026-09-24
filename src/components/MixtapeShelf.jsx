import { Fragment } from 'react'
import { CassetteSpine } from './Cassette'

const tapeTilts = [-0.8, -1.1, 0.7, -0.35, 0.8, -0.6]

export function MixtapeShelf({ mixtapes, activeId, loadingId, onSelect, onOpenStore }) {
  const weeklyMixtape = mixtapes.find((mixtape) => mixtape.isWeekly)
  const displayedMixtapes = [
    ...(weeklyMixtape ? [weeklyMixtape] : []),
    ...mixtapes.filter((mixtape) => !mixtape.isWeekly),
  ]

  return (
    <section className="shelf-zone" aria-label="Mixtape shelf">
      <div className="shelf-heading" aria-hidden="true">
        <span>BEATS FOR YOUR NEXT RECORD · CRASH WEEKLY</span>
      </div>
      <button className="beat-store-launch" type="button" onClick={onOpenStore}>SHOP BEATS ↗</button>
      <div className="mixtape-row">
        {displayedMixtapes.map((mixtape, index) => (
          <Fragment key={mixtape.id}>
            {index === 1 && <span className="mixtape-row__divider" aria-hidden="true" />}
            <button
              className={`mixtape ${mixtape.isWeekly ? 'mixtape--weekly' : ''} ${activeId === mixtape.id ? 'is-active' : ''} ${loadingId === mixtape.id ? 'is-in-flight' : ''}`}
              type="button"
              style={{ '--tape-tilt': `${tapeTilts[index] ?? 0}deg` }}
              aria-label={mixtape.tracks.length
                ? `Play ${mixtape.title}${mixtape.artist ? ` featuring ${mixtape.artist}` : ''}, ${mixtape.tracks.length} tracks`
                : `${mixtape.title}, no tracks`}
              disabled={!mixtape.tracks.length}
              aria-pressed={activeId === mixtape.id}
              onClick={(event) => onSelect(mixtape, event)}
            >
              {mixtape.isWeekly && <span className="mixtape__weekly-tag">THIS WEEK</span>}
              <CassetteSpine mixtape={mixtape} />
            </button>
          </Fragment>
        ))}
      </div>
      <div className="wood-shelf">
        <span className="wood-shelf__highlight" />
        <span className="wood-shelf__edge" />
      </div>
    </section>
  )
}
