import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authClient } from '../lib/auth-client'

const DEFAULT_PROVIDER_AVAILABILITY = {
  email: true,
  google: false,
  emailVerification: false,
}

export class AccountRequestError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message)
    this.name = 'AccountRequestError'
    this.status = status
    this.code = code
  }
}

function localCallbackURL(value) {
  if (typeof window === 'undefined') return '/'

  const fallback = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (!value) return fallback

  try {
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

function normalizeCredits(payload, fallback = 0) {
  const value = payload?.credits ?? payload?.remainingCredits ?? payload?.remaining_credits
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function errorMessage(error, fallback) {
  return error?.message || error?.error?.message || error?.error || fallback
}

function authResult(result, fallbackMessage) {
  if (result?.error) {
    throw new AccountRequestError(errorMessage(result.error, fallbackMessage), {
      status: result.error.status || result.error.statusCode || 0,
      code: result.error.code || '',
    })
  }
  return result?.data ?? result
}

async function responsePayload(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}))
  }

  const text = await response.text().catch(() => '')
  return text ? { error: text } : {}
}

function responseError(response, payload, fallbackMessage) {
  return new AccountRequestError(
    payload?.error?.message || payload?.error || payload?.message || fallbackMessage,
    {
      status: response.status,
      code: payload?.code || payload?.error?.code || '',
    },
  )
}

function filenameFromDisposition(value) {
  if (!value) return ''
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value)
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim())
    } catch {
      return utf8Match[1].trim()
    }
  }
  return /filename="([^"]+)"/i.exec(value)?.[1] || /filename=([^;]+)/i.exec(value)?.[1]?.trim() || ''
}

function safeFilename(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

function saveBlob(blob, filename) {
  const objectURL = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectURL
  link.download = filename
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000)
}

export function useAccount() {
  const sessionQuery = authClient.useSession()
  const refetchSession = sessionQuery.refetch
  const session = sessionQuery.data?.session ?? null
  const sessionUser = sessionQuery.data?.user ?? null
  const sessionUserRef = useRef(sessionUser)
  const [profile, setProfile] = useState(null)
  const [creditState, setCreditState] = useState({ userId: '', value: 0 })
  const [providerAvailability, setProviderAvailability] = useState(DEFAULT_PROVIDER_AVAILABILITY)
  const [configLoading, setConfigLoading] = useState(true)
  const [accountLoading, setAccountLoading] = useState(false)
  const [claimingWeeklyReward, setClaimingWeeklyReward] = useState(false)
  const [downloadingTrackId, setDownloadingTrackId] = useState(null)
  const [error, setError] = useState('')
  const accountRequestRef = useRef(0)
  const balanceRevisionRef = useRef(0)
  const sessionGenerationRef = useRef(0)
  const observedUserIdRef = useRef(sessionUser?.id || '')
  const activeUserIdRef = useRef(sessionUser?.id || '')
  const creditQueueRef = useRef(Promise.resolve())
  const weeklyClaimPromiseRef = useRef(null)
  const downloadRetryKeysRef = useRef(new Map())
  const downloadStateTokenRef = useRef(0)
  const creditsRef = useRef(0)
  const emailCodeDeliveryRef = useRef(null)
  const sessionUserId = sessionUser?.id || ''

  if (observedUserIdRef.current !== sessionUserId) {
    observedUserIdRef.current = sessionUserId
    sessionGenerationRef.current += 1
    accountRequestRef.current += 1
    balanceRevisionRef.current += 1
    weeklyClaimPromiseRef.current = null
    creditQueueRef.current = Promise.resolve()
    downloadRetryKeysRef.current.clear()
  }
  activeUserIdRef.current = sessionUserId
  sessionUserRef.current = sessionUser

  const credits = sessionUser && creditState.userId === sessionUser.id
    ? creditState.value
    : 0
  creditsRef.current = credits

  const identityIsCurrent = useCallback((identity) => (
    Boolean(identity?.userId) &&
    activeUserIdRef.current === identity.userId &&
    sessionGenerationRef.current === identity.generation
  ), [])

  const commitCredits = useCallback((identity, revision, value) => {
    if (!identityIsCurrent(identity) || balanceRevisionRef.current !== revision) return false
    setCreditState({ userId: identity.userId, value })
    return true
  }, [identityIsCurrent])

  const enqueueCreditOperation = useCallback((identity, operation) => {
    const queued = creditQueueRef.current
      .catch(() => {})
      .then(() => {
        if (!identityIsCurrent(identity)) {
          throw new AccountRequestError('The signed-in account changed during that request.', {
            status: 401,
            code: 'SESSION_CHANGED',
          })
        }
        return operation()
      })
    creditQueueRef.current = queued.catch(() => {})
    return queued
  }, [identityIsCurrent])

  const refreshAccount = useCallback(async () => {
    const currentSessionUser = sessionUserRef.current
    if (!currentSessionUser) {
      setProfile(null)
      setCreditState({ userId: '', value: 0 })
      setAccountLoading(false)
      return null
    }

    const identity = {
      userId: currentSessionUser.id,
      generation: sessionGenerationRef.current,
    }
    const balanceRevision = balanceRevisionRef.current + 1
    balanceRevisionRef.current = balanceRevision
    const requestId = accountRequestRef.current + 1
    accountRequestRef.current = requestId
    setAccountLoading(true)

    try {
      const response = await fetch('/api/account', {
        headers: { accept: 'application/json' },
        credentials: 'include',
      })
      const payload = await responsePayload(response)
      if (!response.ok) {
        const requestFailure = responseError(response, payload, 'Could not load your account.')
        if (response.status === 401) await refetchSession().catch(() => {})
        throw requestFailure
      }
      if (
        accountRequestRef.current !== requestId ||
        !identityIsCurrent(identity) ||
        balanceRevisionRef.current !== balanceRevision
      ) return payload

      setProfile(payload.user || currentSessionUser)
      setCreditState({
        userId: identity.userId,
        value: normalizeCredits(payload, 0),
      })
      setError('')
      return payload
    } catch (requestError) {
      if (
        accountRequestRef.current === requestId &&
        identityIsCurrent(identity) &&
        balanceRevisionRef.current === balanceRevision
      ) {
        setError(errorMessage(requestError, 'Could not load your account.'))
      }
      throw requestError
    } finally {
      if (accountRequestRef.current === requestId && identityIsCurrent(identity)) {
        setAccountLoading(false)
      }
    }
  }, [identityIsCurrent, refetchSession])

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true
    const timeout = window.setTimeout(() => controller.abort(), 5000)

    async function loadProviderAvailability() {
      try {
        const response = await fetch('/api/auth/config', {
          headers: { accept: 'application/json' },
          credentials: 'include',
          signal: controller.signal,
        })
        if (!response.ok) return
        const payload = await response.json()
        setProviderAvailability({
          email: payload.email !== false,
          google: Boolean(payload.providers?.google ?? payload.google),
          emailVerification: Boolean(payload.emailVerification),
        })
      } catch (requestError) {
        if (mounted && requestError.name !== 'AbortError') {
          setProviderAvailability(DEFAULT_PROVIDER_AVAILABILITY)
        }
      } finally {
        window.clearTimeout(timeout)
        if (mounted) setConfigLoading(false)
      }
    }

    void loadProviderAvailability()
    return () => {
      mounted = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (sessionQuery.isPending) return
    if (!sessionUser) {
      accountRequestRef.current += 1
      setProfile(null)
      setCreditState({ userId: '', value: 0 })
      setAccountLoading(false)
      return
    }
    void refreshAccount().catch(() => {})
  }, [refreshAccount, sessionQuery.isPending, sessionUser?.id])

  useEffect(() => {
    setClaimingWeeklyReward(false)
    setDownloadingTrackId(null)
    setProfile((current) => current?.id === sessionUserId ? current : null)
  }, [sessionUserId])

  const signUpEmail = useCallback(async ({
    name,
    email,
    password,
    callbackURL,
    rememberMe = true,
  }) => {
    setError('')
    try {
      const data = authResult(await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        rememberMe,
        callbackURL: localCallbackURL(callbackURL),
      }), 'Could not create your account.')
      await refetchSession()
      return data
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not create your account.'))
      throw requestError
    }
  }, [refetchSession])

  const signInEmail = useCallback(async ({
    email,
    password,
    callbackURL,
    rememberMe = true,
  }) => {
    setError('')
    try {
      const data = authResult(await authClient.signIn.email({
        email: email.trim(),
        password,
        rememberMe,
        callbackURL: localCallbackURL(callbackURL),
      }), 'Could not sign in.')
      await refetchSession()
      return data
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not sign in.'))
      throw requestError
    }
  }, [refetchSession])

  const sendEmailCode = useCallback(async ({ automatic = false } = {}) => {
    const userId = activeUserIdRef.current
    const previous = emailCodeDeliveryRef.current
    if (previous?.userId === userId) {
      if (previous.promise) return previous.promise
      if (automatic && previous.result?.sentAt > Date.now() - 10 * 60 * 1000) return previous.result
    }
    const delivery = { userId }
    emailCodeDeliveryRef.current = delivery
    delivery.promise = (async () => {
      const response = await fetch('/api/account/email-code', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: '{}',
      })
      const payload = await responsePayload(response)
      if (!response.ok) throw responseError(response, payload, 'Could not send your confirmation code.')
      delivery.result = { ...payload, sentAt: Date.now() }
      return delivery.result
    })()
    try { return await delivery.promise }
    finally { delivery.promise = null }
  }, [])

  const confirmEmail = useCallback(async (otp) => {
    const response = await fetch('/api/account/confirm-email', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ otp }),
    })
    const payload = await responsePayload(response)
    if (!response.ok) throw responseError(response, payload, 'Could not confirm your email.')
    await refetchSession()
    await refreshAccount()
    return payload
  }, [refetchSession, refreshAccount])

  const signInSocial = useCallback(async (provider, { callbackURL } = {}) => {
    if (provider !== 'google' || !providerAvailability.google) {
      throw new AccountRequestError(`${provider} sign-in is not available.`)
    }
    setError('')
    try {
      return authResult(await authClient.signIn.social({
        provider,
        callbackURL: localCallbackURL(callbackURL),
      }), `Could not continue with ${provider}.`)
    } catch (requestError) {
      setError(errorMessage(requestError, `Could not continue with ${provider}.`))
      throw requestError
    }
  }, [providerAvailability])

  const signOut = useCallback(async () => {
    setError('')
    sessionGenerationRef.current += 1
    accountRequestRef.current += 1
    balanceRevisionRef.current += 1
    weeklyClaimPromiseRef.current = null
    creditQueueRef.current = Promise.resolve()
    downloadRetryKeysRef.current.clear()
    setProfile(null)
    setCreditState({ userId: '', value: 0 })
    setClaimingWeeklyReward(false)
    setDownloadingTrackId(null)
    try {
      const data = authResult(await authClient.signOut(), 'Could not sign out.')
      await refetchSession()
      return data
    } catch (requestError) {
      await refetchSession().catch(() => {})
      await refreshAccount().catch(() => {})
      setError(errorMessage(requestError, 'Could not sign out.'))
      throw requestError
    }
  }, [refetchSession, refreshAccount])

  const updateProfile = useCallback(async ({ name }) => {
    setError('')
    try {
      const data = authResult(await authClient.updateUser({ name: name.trim() }), 'Could not update your account.')
      await refetchSession()
      await refreshAccount()
      return data
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not update your account.'))
      throw requestError
    }
  }, [refetchSession, refreshAccount])

  const deleteAccount = useCallback(async ({ password } = {}) => {
    setError('')
    try {
      const data = authResult(await authClient.deleteUser(password ? { password } : {}), 'Could not delete your account.')
      await refetchSession()
      return data
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not delete your account.'))
      throw requestError
    }
  }, [refetchSession])

  const claimWeeklyReward = useCallback(async () => {
    if (!sessionUser) throw new AccountRequestError('Sign in to claim this week\'s credits.', { status: 401 })
    const identity = {
      userId: sessionUser.id,
      generation: sessionGenerationRef.current,
    }
    const activeClaim = weeklyClaimPromiseRef.current
    if (
      activeClaim?.userId === identity.userId &&
      activeClaim.generation === identity.generation
    ) return activeClaim.promise

    const balanceRevision = balanceRevisionRef.current + 1
    balanceRevisionRef.current = balanceRevision
    let claimPromise
    claimPromise = enqueueCreditOperation(identity, async () => {
      setClaimingWeeklyReward(true)
      setError('')
      try {
        const response = await fetch('/api/credits/weekly-claim', {
          method: 'POST',
          headers: { accept: 'application/json' },
          credentials: 'include',
        })
        const payload = await responsePayload(response)
        if (!response.ok) {
          const requestFailure = responseError(response, payload, 'Could not claim the weekly credits.')
          if (response.status === 401) await refetchSession().catch(() => {})
          throw requestFailure
        }
        const nextCredits = normalizeCredits(payload, creditsRef.current)
        commitCredits(identity, balanceRevision, nextCredits)
        return {
          ...payload,
          awarded: Boolean(payload.awarded),
          amount: Number(payload.amount) || 0,
          credits: nextCredits,
        }
      } catch (requestError) {
        if (
          identityIsCurrent(identity) &&
          balanceRevisionRef.current === balanceRevision
        ) {
          setError(errorMessage(requestError, 'Could not claim the weekly credits.'))
        }
        throw requestError
      } finally {
        if (weeklyClaimPromiseRef.current?.promise === claimPromise) {
          weeklyClaimPromiseRef.current = null
          if (identityIsCurrent(identity)) setClaimingWeeklyReward(false)
        }
      }
    })

    weeklyClaimPromiseRef.current = {
      userId: identity.userId,
      generation: identity.generation,
      promise: claimPromise,
    }
    return claimPromise
  }, [commitCredits, enqueueCreditOperation, identityIsCurrent, refetchSession, sessionUser])

  const downloadTrack = useCallback(async (track, { save = true, filename } = {}) => {
    const trackId = typeof track === 'string' ? track : track?.id
    if (!sessionUser) throw new AccountRequestError('Sign in to download tracks.', { status: 401 })
    if (!trackId) throw new AccountRequestError('Choose a track to download.')
    const identity = {
      userId: sessionUser.id,
      generation: sessionGenerationRef.current,
    }
    const balanceRevision = balanceRevisionRef.current + 1
    balanceRevisionRef.current = balanceRevision
    const downloadStateToken = downloadStateTokenRef.current + 1
    downloadStateTokenRef.current = downloadStateToken
    const requestKey = downloadRetryKeysRef.current.get(trackId) || crypto.randomUUID()
    downloadRetryKeysRef.current.set(trackId, requestKey)
    setDownloadingTrackId(trackId)
    setError('')

    const operation = enqueueCreditOperation(identity, async () => {
      let lastError
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(`/api/download/${encodeURIComponent(trackId)}`, {
            method: 'POST',
            headers: {
              accept: 'audio/mpeg, application/json',
              'idempotency-key': requestKey,
            },
            credentials: 'include',
          })
          const contentType = response.headers.get('content-type') || ''

          if (!response.ok) {
            const payload = await responsePayload(response)
            const requestFailure = responseError(response, payload, 'The track could not be downloaded.')
            if (response.status === 401) await refetchSession().catch(() => {})
            if (payload && typeof payload === 'object') {
              commitCredits(identity, balanceRevision, normalizeCredits(payload, creditsRef.current))
            }
            if (response.status >= 400 && response.status < 500 && response.status !== 429) {
              downloadRetryKeysRef.current.delete(trackId)
            }
            throw requestFailure
          }

          const headerCredits = Number(response.headers.get('x-credits-remaining'))
          const nextCredits = Number.isFinite(headerCredits) && headerCredits >= 0
            ? headerCredits
            : creditsRef.current
          commitCredits(identity, balanceRevision, nextCredits)

          if (contentType.includes('application/json')) {
            const payload = await response.json()
            const remainingCredits = normalizeCredits(payload, nextCredits)
            commitCredits(identity, balanceRevision, remainingCredits)
            if (save && payload.downloadUrl) {
              const link = document.createElement('a')
              link.href = payload.downloadUrl
              link.download = safeFilename(payload.filename || filename, `${trackId}.mp3`)
              link.click()
            }
            downloadRetryKeysRef.current.delete(trackId)
            return { ...payload, credits: remainingCredits }
          }

          const blob = await response.blob()
          const preferredName = filenameFromDisposition(response.headers.get('content-disposition'))
            || filename
            || (typeof track === 'object' && track?.title ? `${track.title}.mp3` : `${trackId}.mp3`)
          const downloadFilename = safeFilename(preferredName, `${trackId}.mp3`)
          if (save) saveBlob(blob, downloadFilename)
          downloadRetryKeysRef.current.delete(trackId)

          return {
            blob,
            filename: downloadFilename,
            credits: nextCredits,
          }
        } catch (requestError) {
          lastError = requestError
          const retryable = !(requestError instanceof AccountRequestError) || requestError.status >= 500
          if (!retryable || attempt === 1) throw requestError
        }
      }
      throw lastError
    })

    try {
      return await operation
    } catch (requestError) {
      const mayNeedReconciliation = !(requestError instanceof AccountRequestError) || requestError.status >= 500
      if (mayNeedReconciliation && identityIsCurrent(identity)) {
        let observedQueue
        do {
          observedQueue = creditQueueRef.current
          await observedQueue.catch(() => {})
        } while (observedQueue !== creditQueueRef.current)
        if (identityIsCurrent(identity)) await refreshAccount().catch(() => {})
      }
      if (
        identityIsCurrent(identity) &&
        balanceRevisionRef.current === balanceRevision
      ) {
        setError(errorMessage(requestError, 'The track could not be downloaded.'))
      }
      throw requestError
    } finally {
      if (
        identityIsCurrent(identity) &&
        downloadStateTokenRef.current === downloadStateToken
      ) setDownloadingTrackId(null)
    }
  }, [commitCredits, enqueueCreditOperation, identityIsCurrent, refetchSession, refreshAccount, sessionUser])

  const user = profile?.id === sessionUser?.id ? profile : sessionUser
  const loading = sessionQuery.isPending || accountLoading

  return useMemo(() => ({
    session,
    user,
    profile,
    credits,
    loading,
    sessionLoading: sessionQuery.isPending,
    accountLoading,
    configLoading,
    providerAvailability,
    isAuthenticated: Boolean(sessionUser),
    error: error || sessionQuery.error?.message || '',
    claimingWeeklyReward,
    downloadingTrackId,
    refreshAccount,
    signUpEmail,
    sendEmailCode,
    confirmEmail,
    signInEmail,
    signInSocial,
    signOut,
    updateProfile,
    deleteAccount,
    claimWeeklyReward,
    downloadTrack,
  }), [
    accountLoading,
    claimWeeklyReward,
    claimingWeeklyReward,
    configLoading,
    credits,
    downloadTrack,
    downloadingTrackId,
    error,
    loading,
    profile,
    providerAvailability,
    refreshAccount,
    session,
    sessionQuery.error,
    sessionQuery.isPending,
    sessionUser,
    signInEmail,
    signInSocial,
    signOut,
    signUpEmail,
    sendEmailCode,
    confirmEmail,
    deleteAccount,
    updateProfile,
    user,
  ])
}
