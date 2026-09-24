import { useEffect, useRef, useState } from 'react'
import { StoreManager } from './StoreManager'

async function request(path, options) {
  const response = await fetch(path, { credentials: 'include', ...options })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'The change could not be saved.')
  return payload
}

export function MixtapeManager({ onClose, onChanged }) {
  const dialogRef = useRef(null)
  const fileRef = useRef(null)
  const [mixtapes, setMixtapes] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [section, setSection] = useState('mixtapes')

  const refresh = async () => {
    const payload = await request('/api/manage/mixtapes')
    setMixtapes(payload.mixtapes)
    setSelectedId((current) => payload.mixtapes.some((tape) => tape.id === current)
      ? current : payload.mixtapes[0]?.id || '')
  }

  useEffect(() => {
    let active = true
    request('/api/manage/mixtapes').then((payload) => {
      if (!active) return
      setMixtapes(payload.mixtapes)
      setSelectedId(payload.mixtapes[0]?.id || '')
    }).catch((failure) => { if (active) setError(failure.message) })
    dialogRef.current?.querySelector('button')?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
      if (!controls.length) return
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault()
        controls.at(-1).focus()
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault()
        controls[0].focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { active = false; document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  const change = async (path, options) => {
    setBusy(true)
    setError('')
    try {
      await request(path, options)
      await Promise.all([refresh(), onChanged()])
      return true
    } catch (failure) {
      setError(failure.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const selected = mixtapes.find((tape) => tape.id === selectedId)
  return (
    <div className="mixtape-manager" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="mixtape-manager__dialog" role="dialog" aria-modal="true" aria-label="Manage mixtapes" ref={dialogRef} tabIndex={-1}>
        <header className="mixtape-manager__header">
          <h2>Manage music</h2>
          <button type="button" onClick={onClose} aria-label="Close mixtape manager">×</button>
        </header>
        <div className="mixtape-manager__tabs" aria-label="Music sections">
          <button type="button" aria-pressed={section === 'mixtapes'} onClick={() => setSection('mixtapes')}>Mixtapes</button>
          <button type="button" aria-pressed={section === 'store'} onClick={() => setSection('store')}>Beat store</button>
        </div>
        {section === 'store' ? <StoreManager /> : <div className="mixtape-manager__body">
          <nav className="mixtape-manager__menu" aria-label="Mixtapes">
            {mixtapes.map((tape) => (
              <button key={tape.id} type="button" className={tape.id === selectedId ? 'is-selected' : ''}
                aria-current={tape.id === selectedId ? 'page' : undefined} onClick={() => setSelectedId(tape.id)}>
                {tape.title} <small>{tape.tracks.length}</small>
              </button>
            ))}
          </nav>
          <div className="mixtape-manager__tracks">
            {selected && <>
              <h3>{selected.title}</h3>
              <form onSubmit={(event) => {
                event.preventDefault()
                const file = fileRef.current?.files?.[0]
                if (!file) return
                const body = new FormData()
                body.set('song', file)
                void change(`/api/manage/mixtapes/${encodeURIComponent(selected.id)}/tracks`, { method: 'POST', body })
                  .then((saved) => { if (saved && fileRef.current) fileRef.current.value = '' })
              }}>
                <label>Upload MP3 <input ref={fileRef} type="file" accept=".mp3,audio/mpeg" required disabled={busy} /></label>
                <button type="submit" disabled={busy}>Upload song</button>
              </form>
              <ol>
                {selected.tracks.map((track, index) => (
                  <li key={track.id}>
                    <span>{track.title}</span>
                    <div className="mixtape-manager__actions">
                      <button type="button" aria-label={`Move ${track.title} up`} title="Move up" disabled={busy || index === 0}
                        onClick={() => change(`/api/manage/tracks/${encodeURIComponent(track.id)}`, {
                          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ direction: 'up' }),
                        })}>↑</button>
                      <button type="button" aria-label={`Move ${track.title} down`} title="Move down" disabled={busy || index === selected.tracks.length - 1}
                        onClick={() => change(`/api/manage/tracks/${encodeURIComponent(track.id)}`, {
                          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ direction: 'down' }),
                        })}>↓</button>
                      <select aria-label={`Move ${track.title} to mixtape`} value={selected.id} disabled={busy}
                        onChange={(event) => change(`/api/manage/tracks/${encodeURIComponent(track.id)}`, {
                          method: 'PATCH', headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ mixtapeId: event.target.value }),
                        })}>
                        {mixtapes.map((tape) => <option key={tape.id} value={tape.id}>{tape.title}</option>)}
                      </select>
                      <button type="button" disabled={busy} onClick={() => {
                        if (window.confirm(`Delete “${track.title}” from Crash Beats?`)) {
                          void change(`/api/manage/tracks/${encodeURIComponent(track.id)}`, { method: 'DELETE' })
                        }
                      }}>Delete</button>
                    </div>
                  </li>
                ))}
              </ol>
              {!selected.tracks.length && <p>No songs in this mixtape yet.</p>}
            </>}
            {error && <p className="mixtape-manager__error" role="alert">{error}</p>}
          </div>
        </div>}
      </section>
    </div>
  )
}
