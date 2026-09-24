import { useEffect, useRef, useState } from 'react'

async function storeRequest(path, options) {
  const response = await fetch(path, { credentials: 'include', ...options })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'The beat store is unavailable right now.')
  return result
}

function money(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export function BeatStore({ account, onClose, onOpenAccount, onWeekly }) {
  const dialogRef = useRef(null)
  const audioRef = useRef(null)
  const [beats, setBeats] = useState([])
  const [loading, setLoading] = useState(true)
  const [purchases, setPurchases] = useState([])
  const [checkoutReady, setCheckoutReady] = useState(false)
  const [acceptedBeatId, setAcceptedBeatId] = useState('')
  const [playingBeatId, setPlayingBeatId] = useState('')
  const [buyingBeatId, setBuyingBeatId] = useState('')
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const orderId = new URLSearchParams(window.location.search).get('order')
  const verified = Boolean(account.user?.emailVerified)

  useEffect(() => {
    let active = true
    storeRequest('/api/store/beats').then((data) => {
      if (!active) return
      setBeats(data.beats)
      setCheckoutReady(data.checkoutReady)
    }).catch((failure) => { if (active) setError(failure.message) })
      .finally(() => { if (active) setLoading(false) })
    dialogRef.current?.querySelector('button')?.focus()
    const keydown = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], summary')]
      if (!controls.length) return
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault()
        controls.at(-1).focus()
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault()
        controls[0].focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { active = false; document.removeEventListener('keydown', keydown); audioRef.current?.pause() }
  }, [onClose])

  useEffect(() => {
    if (!verified) { setPurchases([]); return }
    let active = true
    storeRequest('/api/store/purchases').then((data) => {
      if (active) setPurchases(data.purchases)
    }).catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [account.user?.id, verified])

  useEffect(() => {
    if (!orderId || !verified) return undefined
    let active = true
    let timer
    let attempts = 0
    const check = async () => {
      try {
        const result = await storeRequest(`/api/store/orders/${encodeURIComponent(orderId)}`)
        if (!active) return
        setOrder(result)
        if (result.status === 'pending' && attempts++ < 20) timer = window.setTimeout(check, 3000)
      } catch (failure) {
        if (active) setError(failure.message)
      }
    }
    void check()
    return () => { active = false; window.clearTimeout(timer) }
  }, [orderId, verified])

  const playPreview = (beat) => {
    const audio = audioRef.current
    if (!audio) return
    if (playingBeatId === beat.id && !audio.paused) {
      audio.pause()
      setPlayingBeatId('')
      return
    }
    audio.src = beat.previewUrl
    setPlayingBeatId(beat.id)
    void audio.play().catch(() => setError('The preview could not be played.'))
  }

  const buy = async (beat) => {
    if (!verified) { onOpenAccount(); return }
    setBuyingBeatId(beat.id)
    setError('')
    try {
      const result = await storeRequest('/api/store/checkout', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ beatId: beat.id, acceptedLicense: acceptedBeatId === beat.id }),
      })
      const url = new URL(result.url)
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('Checkout returned an invalid URL.')
      window.location.assign(url.href)
    } catch (failure) {
      setError(failure.message)
      setBuyingBeatId('')
    }
  }

  return <div className="beat-store" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="beat-store__dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Beat store" tabIndex={-1}>
      <header className="beat-store__header">
        <div><span>CRASH BEATS</span><h2>Beat Store</h2><p>Find the sound for your next record. Listen to a preview, review the license, then buy securely.</p></div>
        <button type="button" onClick={onClose} aria-label="Close beat store">×</button>
      </header>
      {order && <div className="beat-store__order" role="status">
        {order.status === 'paid' ? <><strong>Payment complete: {order.title}</strong><p>Your {order.licenseName} is ready.</p>
          <a href={`/api/store/orders/${encodeURIComponent(order.orderId)}/download`}>Download purchased beat</a>
          <details><summary>Purchased license terms</summary><p>{order.licenseTerms}</p></details>
        </> : <><strong>{order.status === 'pending' ? 'Payment is processing' : 'Checkout was not completed'}</strong>
          <p>{order.status === 'pending' ? 'We’ll unlock the file as soon as Stripe confirms payment.' : 'You can choose a beat below and try again.'}</p></>}
      </div>}
      {orderId && !verified && <p className="beat-store__order">Sign in with your verified account to access this purchase. <button type="button" onClick={onOpenAccount}>Open account</button></p>}
      {error && <p className="beat-store__error" role="alert">{error}</p>}
      {purchases.length > 0 && <div className="beat-store__purchases"><h3>Your purchases</h3>
        {purchases.map((purchase) => <a key={purchase.orderId} href={`/api/store/orders/${encodeURIComponent(purchase.orderId)}/download`}>
          {purchase.title} · {purchase.licenseName} — Download
        </a>)}
      </div>}
      {loading ? <p>Loading beats…</p> : beats.length ? <div className="beat-store__grid">
        {beats.map((beat) => <article className="beat-store__card" key={beat.id}>
          <div className="beat-store__card-top"><span>BEAT {String(beats.indexOf(beat) + 1).padStart(2, '0')}</span><strong>{money(beat.priceCents)}</strong></div>
          <h3>{beat.title}</h3>
          <p>{beat.licenseName}</p>
          <button type="button" onClick={() => playPreview(beat)}>{playingBeatId === beat.id ? 'Pause preview' : 'Play preview'}</button>
          <details><summary>Read license terms</summary><p>{beat.licenseTerms}</p></details>
          <label><input type="checkbox" checked={acceptedBeatId === beat.id} onChange={(event) => setAcceptedBeatId(event.target.checked ? beat.id : '')} /> I agree to this beat’s license terms.</label>
          <button type="button" disabled={!checkoutReady || buyingBeatId === beat.id || (verified && acceptedBeatId !== beat.id)}
            onClick={() => buy(beat)}>{buyingBeatId === beat.id ? 'Opening checkout…' : verified ? `Buy license · ${money(beat.priceCents)}` : 'Sign in to buy'}</button>
        </article>)}
      </div> : <div className="beat-store__empty"><h3>New beats are on the way.</h3>
        <p>Explore the mixtapes while we prepare the first releases.</p>
        <button type="button" onClick={onWeekly}>Meet this week’s artist</button>
      </div>}
      <audio ref={audioRef} onEnded={() => setPlayingBeatId('')} preload="none" />
    </section>
  </div>
}
