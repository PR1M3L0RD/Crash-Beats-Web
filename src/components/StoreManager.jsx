import { useEffect, useState } from 'react'

async function storeRequest(path, options) {
  const response = await fetch(path, { credentials: 'include', ...options })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'The beat could not be saved.')
  return result
}

export function StoreManager() {
  const [beats, setBeats] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [checkoutReady, setCheckoutReady] = useState(false)
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [licenseName, setLicenseName] = useState('')
  const [licenseTerms, setLicenseTerms] = useState('')
  const [published, setPublished] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async (preferredId) => {
    const result = await storeRequest('/api/manage/store-beats')
    setBeats(result.beats)
    setCheckoutReady(result.checkoutReady)
    setSelectedId((current) => preferredId || (result.beats.some((beat) => beat.id === current) ? current : result.beats[0]?.id || ''))
  }

  useEffect(() => { void refresh().catch((failure) => setError(failure.message)) }, [])
  useEffect(() => {
    const beat = beats.find((entry) => entry.id === selectedId)
    if (!beat) return
    setTitle(beat.title)
    setPrice(beat.priceCents ? (beat.priceCents / 100).toFixed(2) : '')
    setLicenseName(beat.licenseName || '')
    setLicenseTerms(beat.licenseTerms || '')
    setPublished(beat.published)
  }, [beats, selectedId])

  const upload = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true)
    setError('')
    try {
      const result = await storeRequest('/api/manage/store-beats', {
        method: 'POST', body: new FormData(form),
      })
      form.reset()
      await refresh(result.beatId)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (!/^\d+(?:\.\d{1,2})?$/.test(price)) throw new Error('Enter a price in dollars and cents.')
      await storeRequest(`/api/manage/store-beats/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title, priceCents: Math.round(Number(price) * 100), licenseName, licenseTerms, published,
        }),
      })
      await refresh(selectedId)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const beat = beats.find((entry) => entry.id === selectedId)
    if (!beat || !window.confirm(`Delete “${beat.title}”? It will be removed from the store immediately.`)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await storeRequest(`/api/manage/store-beats/${encodeURIComponent(selectedId)}`, { method: 'DELETE' })
      await refresh('')
      setNotice(result.archived ? 'Beat removed. Existing buyer downloads were preserved.' : 'Beat and audio files deleted.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="store-manager">
    <p>Upload a short preview MP3 and a separate full MP3 or WAV. New beats stay private until you set a price and license, connect Stripe, and publish them.</p>
    <form className="store-manager__form" onSubmit={upload}>
      <h3>Add a beat for sale</h3>
      <label>Beat title<input name="title" required minLength="2" maxLength="120" disabled={busy} /></label>
      <label>Short preview MP3 (up to 10 MB)<input name="preview" type="file" accept=".mp3,audio/mpeg" required disabled={busy} /></label>
      <label>Full buyer file (MP3 or WAV, up to 40 MB)<input name="full" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" required disabled={busy} /></label>
      <label className="store-manager__check"><input name="rightsConfirmed" type="checkbox" value="yes" required disabled={busy} /> I have the rights to sell this beat and its audio.</label>
      <button type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload draft'}</button>
    </form>
    <div className="store-manager__list" aria-label="Store beats">
      {beats.map((beat) => <button key={beat.id} type="button" className={selectedId === beat.id ? 'is-selected' : ''}
        onClick={() => setSelectedId(beat.id)}>{beat.title} <small>{beat.published ? 'Live' : 'Draft'}</small></button>)}
    </div>
    {selectedId && <form className="store-manager__form" onSubmit={save}>
      <h3>Sale details</h3>
      <label>Beat title<input value={title} onChange={(event) => setTitle(event.target.value)} minLength="2" maxLength="120" required disabled={busy} /></label>
      <label>Price (USD)<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="25.00" required disabled={busy} /></label>
      <label>License name<input value={licenseName} onChange={(event) => setLicenseName(event.target.value)} maxLength="80" placeholder="Your license name" required disabled={busy} /></label>
      <label>Full license terms<textarea value={licenseTerms} onChange={(event) => setLicenseTerms(event.target.value)} minLength="20" maxLength="10000" rows="6" required disabled={busy} /></label>
      <label className="store-manager__check"><input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} disabled={busy || !checkoutReady} /> Publish for sale</label>
      {!checkoutReady && <p>Stripe checkout needs its API key and webhook secret before a beat can go live.</p>}
      <div className="store-manager__actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save beat'}</button>
        <button className="store-manager__delete" type="button" disabled={busy} onClick={remove}>Delete beat</button>
      </div>
    </form>}
    {notice && <p className="store-manager__notice" role="status">{notice}</p>}
    {error && <p className="mixtape-manager__error" role="alert">{error}</p>}
  </div>
}
