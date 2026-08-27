import { useEffect, useId, useRef, useState } from 'react'
import { Settings } from 'lucide-react'

function readableError(error, fallback) {
  return error?.message || fallback
}

function focusableElements(container) {
  return [...container.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
  )]
}

export function AccountModal({
  open,
  onClose,
  account,
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [mode, setMode] = useState('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!open) return undefined
    previousFocusRef.current = document.activeElement
    const dialog = dialogRef.current
    window.requestAnimationFrame(() => {
      focusableElements(dialog)[0]?.focus()
    })

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = focusableElements(dialog)
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus?.()
    }
  }, [onClose, open])

  useEffect(() => {
    if (account.user) setEditName(account.user.name || '')
  }, [account.user])

  useEffect(() => {
    if (!open) {
      setMode('sign-in')
      setSettingsOpen(false)
      setFormError('')
      setPassword('')
      setSubmitting(false)
    }
  }, [open])

  if (!open) return null

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setFormError('')
    try {
      if (mode === 'sign-up') {
        await account.signUpEmail({ name, email, password })
      } else {
        await account.signInEmail({ email, password })
      }
      onClose()
    } catch (error) {
      setFormError(readableError(error, mode === 'sign-up' ? 'Could not create your account.' : 'Could not sign in.'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSocialSignIn = async (provider) => {
    setSubmitting(true)
    setFormError('')
    try {
      await account.signInSocial(provider)
    } catch (error) {
      setSubmitting(false)
      setFormError(readableError(error, `Could not continue with ${provider}.`))
    }
  }

  const handleSignOut = async () => {
    setSubmitting(true)
    setFormError('')
    try {
      await account.signOut()
      onClose()
    } catch (error) {
      setFormError(readableError(error, 'Could not sign out.'))
      setSubmitting(false)
    }
  }

  const handleProfileUpdate = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setFormError('')
    try {
      await account.updateProfile({ name: editName })
      setSettingsOpen(false)
    } catch (error) {
      setFormError(readableError(error, 'Could not update your account.'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!window.confirm('Delete your Crash Beats account and its download credits?')) return
    setSubmitting(true)
    setFormError('')
    try {
      await account.deleteAccount()
      onClose()
    } catch (error) {
      setFormError(readableError(error, 'Could not delete your account.'))
      setSubmitting(false)
    }
  }

  return (
    <div className="account-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        className="account-modal__dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={submitting}
      >
        <header className="account-modal__header">
          <div>
            <p className="account-modal__eyebrow">CRASH BEATS // ACCOUNT</p>
            <h2 id={titleId}>{account.user ? 'Your listener pass' : mode === 'sign-up' ? 'Create an account' : 'Sign in'}</h2>
          </div>
          <button className="account-modal__close" type="button" aria-label="Close account dialog" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {account.user ? (
          <div className="account-modal__profile">
            {account.user.image && (
              <img className="account-modal__avatar" src={account.user.image} alt="" referrerPolicy="no-referrer" />
            )}
            <div className="account-modal__identity">
              <div className="account-modal__identity-name">
                <strong>{account.user.name || 'Crash Beats listener'}</strong>
                <button
                  className="account-modal__settings"
                  type="button"
                  aria-label="Edit or delete account"
                  title="Edit or delete account"
                  disabled={submitting}
                  onClick={() => setSettingsOpen((current) => !current)}
                >
                  <Settings aria-hidden="true" />
                </button>
              </div>
              <span>{account.user.email}</span>
            </div>
            <div className="account-modal__credits" aria-label={`${account.credits} download credits`}>
              <span>DOWNLOAD CREDITS</span>
              <strong>{account.credits}</strong>
            </div>
            <p id={descriptionId} className="account-modal__message">
              Visit Crash Weekly each week to unlock two more downloads.
            </p>
            {(formError || account.error) && <p className="account-modal__error" role="alert">{formError || account.error}</p>}
            {settingsOpen && (
              <div className="account-modal__settings-panel">
                <form className="account-modal__form" onSubmit={handleProfileUpdate}>
                  <label>
                    <span>Display name</span>
                    <input
                      name="display-name"
                      type="text"
                      minLength="2"
                      maxLength="80"
                      required
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                  </label>
                  <button className="account-modal__submit" type="submit" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save changes'}
                  </button>
                </form>
                <button className="account-modal__delete" type="button" disabled={submitting} onClick={handleDeleteAccount}>
                  Delete account
                </button>
              </div>
            )}
            <button className="account-modal__sign-out" type="button" disabled={submitting} onClick={handleSignOut}>
              {submitting ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : (
          <>
            <p id={descriptionId} className="account-modal__message">
              Sign in, then visit Crash Weekly to collect this week&rsquo;s two download credits.
            </p>

            <div className="account-modal__socials" aria-label="Social sign in options">
              {account.providerAvailability.google && (
                <button className="account-modal__social--google" type="button" disabled={submitting} onClick={() => handleSocialSignIn('google')}>
                  Continue with Google
                </button>
              )}
            </div>

            {account.providerAvailability.email && (
              <form className="account-modal__form" onSubmit={handleSubmit}>
                {mode === 'sign-up' && (
                  <label>
                    <span>Display name</span>
                    <input
                      name="name"
                      type="text"
                      autoComplete="name"
                      minLength="2"
                      maxLength="80"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                )}
                <label>
                  <span>Email</span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength="254"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                    minLength="8"
                    maxLength="128"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                {(formError || account.error) && <p className="account-modal__error" role="alert">{formError || account.error}</p>}
                <button className="account-modal__submit" type="submit" disabled={submitting}>
                  {submitting ? 'Connecting…' : mode === 'sign-up' ? 'Create account' : 'Sign in with email'}
                </button>
              </form>
            )}

            <button
              className="account-modal__mode-switch"
              type="button"
              disabled={submitting}
              onClick={() => {
                setMode((current) => current === 'sign-in' ? 'sign-up' : 'sign-in')
                setFormError('')
                setPassword('')
              }}
            >
              {mode === 'sign-up' ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </button>
          </>
        )}
      </section>
    </div>
  )
}
