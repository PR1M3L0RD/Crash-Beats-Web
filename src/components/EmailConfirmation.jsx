import { useEffect, useRef, useState } from 'react'

export function EmailConfirmation({ account }) {
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  useEffect(() => {
    if (!cooldown) return undefined
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  useEffect(() => { if (sent) inputRef.current?.focus() }, [sent])

  async function sendCode() {
    setBusy(true)
    setError('')
    try {
      await account.sendEmailCode()
      setSent(true)
      setCode('')
      setCooldown(60)
    } catch (failure) { setError(failure.message || 'Could not send the code. Try again later.') }
    finally { setBusy(false) }
  }
  async function confirm(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await account.confirmEmail(code) }
    catch (failure) { setError(failure.message || 'Could not confirm your email.') }
    finally { setBusy(false) }
  }

  return (
    <div className="account-modal__settings-panel">
      <p className="account-modal__message">Confirm your email to recover saved credits if you recreate your account. Your weekly reward schedule stays the same.</p>
      {sent && <p role="status" className="account-modal__message">Code sent to {account.user.email}. It expires in 10 minutes. Check your spam folder too.</p>}
      <form className="account-modal__form" onSubmit={confirm}>
        <label>
          <span>Six-digit email code</span>
          <input ref={inputRef} name="email-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
        </label>
        <button className="account-modal__submit" type="submit" disabled={busy || code.length !== 6}>Confirm email</button>
      </form>
      <button className="account-modal__mode-switch" type="button" onClick={sendCode} disabled={busy || cooldown > 0}>
        {cooldown > 0 ? `Resend in ${cooldown}s` : sent ? 'Send a new code' : 'Send confirmation code'}
      </button>
      {error && <p role="alert" className="account-modal__error">{error}</p>}
    </div>
  )
}
