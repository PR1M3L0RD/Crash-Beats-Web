import { Fragment, useEffect, useMemo, useState } from 'react'
import { CassetteSpine } from './Cassette'

const tapeTilts = [-0.8, -1.1, 0.7, -0.35, 0.8, -0.6]
const archivePageSize = 5

export function MixtapeShelf({ mixtapes, activeId, loadingId, onSelect }) {
  const [page, setPage] = useState(0)
  const weeklyMixtape = mixtapes.find((mixtape) => mixtape.isWeekly)
  const archiveMixtapes = useMemo(
    () => mixtapes.filter((mixtape) => !mixtape.isWeekly),
    [mixtapes],
  )
  const pageCount = Math.max(1, Math.ceil(archiveMixtapes.length / archivePageSize))
  const displayedMixtapes = [
    ...(weeklyMixtape ? [weeklyMixtape] : []),
    ...archiveMixtapes.slice(page * archivePageSize, (page + 1) * archivePageSize),
  ]

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1))
  }, [pageCount])

  return (
    <section className="shelf-zone" aria-label="Mixtape shelf">
      <div className="shelf-heading" aria-hidden="true">
        <span>CRASH WEEKLY + ARCHIVE</span>
        <span>SELECT A TAPE</span>
      </div>
      {pageCount > 1 && (
        <nav className="shelf-pagination" aria-label="Mixtape shelf pages">
          <button
            type="button"
            aria-label="Previous mixtapes"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            ‹
          </button>
          <span>{page + 1} / {pageCount}</span>
          <button
            type="button"
            aria-label="Next mixtapes"
            disabled={page === pageCount - 1}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          >
            ›
          </button>
        </nav>
      )}
      <div className="mixtape-row">
        {displayedMixtapes.map((mixtape, index) => (
          <Fragment key={mixtape.id}>
            {index === 1 && <span className="mixtape-row__divider" aria-hidden="true" />}
            <button
              className={`mixtape ${mixtape.isWeekly ? 'mixtape--weekly' : ''} ${activeId === mixtape.id ? 'is-active' : ''} ${loadingId === mixtape.id ? 'is-in-flight' : ''}`}
              type="button"
              style={{ '--tape-tilt': `${tapeTilts[index] ?? 0}deg` }}
              aria-label={`Play ${mixtape.title}${mixtape.artist ? ` featuring ${mixtape.artist}` : ''}, ${mixtape.tracks.length} tracks`}
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
