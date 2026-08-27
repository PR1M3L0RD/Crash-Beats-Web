import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccountModal } from './components/AccountModal'
import { Boombox } from './components/Boombox'
import { Cassette, CassetteSpine } from './components/Cassette'
import { MixtapeShelf } from './components/MixtapeShelf'
import { SecretStation } from './components/SecretStation'
import { WeeklySubmissionForm } from './components/WeeklySubmissionForm'
import { WeeklyRewardCelebration } from './components/WeeklyRewardCelebration'
import { createWeeklyMixtape, mixtapes, socials } from './data/mixtapes'
import { useAudioPlayer } from './hooks/useAudioPlayer'
import { useAccount } from './hooks/useAccount'
import { useCatalog } from './hooks/useCatalog'
import { useWeeklyArtist } from './hooks/useWeeklyArtist'
import { getMondayUtcWeekKey, millisecondsUntilNextMondayUtc } from './lib/week'
import secretSignal from './assets/secret-signal-animated.gif'

const TUNER_MAX = 108
const DEFAULT_TUNER_POSITION = 95.6

export default function App() {
  const visualizerRef = useRef(null)
  const deckTargetRef = useRef(null)
  const flightIdRef = useRef(0)
  const rewardAttemptRef = useRef('')
  const rewardUserRef = useRef('')
  const weeklyPromptPendingRef = useRef(false)
  const [flyingTape, setFlyingTape] = useState(null)
  const [deckMixtape, setDeckMixtape] = useState(null)
  const [tunerPosition, setTunerPosition] = useState(DEFAULT_TUNER_POSITION)
  const [isAccountOpen, setIsAccountOpen] = useState(false)
  const [weeklyReward, setWeeklyReward] = useState(null)
  const [downloadNotice, setDownloadNotice] = useState(null)
  const [currentWeekKey, setCurrentWeekKey] = useState(() => getMondayUtcWeekKey())
  const [isSubmissionOpen, setIsSubmissionOpen] = useState(
    () => window.location.pathname === '/weekly/apply',
  )
  const weekly = useWeeklyArtist()
  const account = useAccount()
  const catalogMixtapes = useCatalog(mixtapes)
  const weeklyMixtape = useMemo(
    () => createWeeklyMixtape(weekly.artist, weekly.tracks),
    [weekly],
  )
  const availableMixtapes = useMemo(
    () => [weeklyMixtape, ...catalogMixtapes],
    [catalogMixtapes, weeklyMixtape],
  )
  const player = useAudioPlayer(availableMixtapes, visualizerRef)
  const isSecretStation = tunerPosition >= TUNER_MAX
  const isWeekly = Boolean(player.activeMixtape?.isWeekly)
  const activeSocials = isWeekly ? player.activeMixtape.socials : socials

  const openAccount = useCallback(() => setIsAccountOpen(true), [])

  const closeAccount = useCallback(() => setIsAccountOpen(false), [])

  const closeWeeklyReward = useCallback(() => setWeeklyReward(null), [])

  useEffect(() => {
    const handlePopState = () => {
      setIsSubmissionOpen(window.location.pathname === '/weekly/apply')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    let rolloverTimer
    const updateWeek = () => {
      const now = new Date()
      setCurrentWeekKey(getMondayUtcWeekKey(now))
      window.clearTimeout(rolloverTimer)
      rolloverTimer = window.setTimeout(updateWeek, millisecondsUntilNextMondayUtc(now) + 250)
    }
    const updateVisibleWeek = () => {
      if (document.visibilityState === 'visible') updateWeek()
    }

    updateWeek()
    window.addEventListener('focus', updateWeek)
    document.addEventListener('visibilitychange', updateVisibleWeek)
    return () => {
      window.clearTimeout(rolloverTimer)
      window.removeEventListener('focus', updateWeek)
      document.removeEventListener('visibilitychange', updateVisibleWeek)
    }
  }, [])

  useEffect(() => {
    if (!weeklyPromptPendingRef.current || account.sessionLoading) return
    weeklyPromptPendingRef.current = false
    if (!account.user) openAccount()
  }, [account.sessionLoading, account.user, openAccount])

  useEffect(() => {
    const userId = account.user?.id || ''
    if (rewardUserRef.current === userId) return
    rewardUserRef.current = userId
    rewardAttemptRef.current = ''
  }, [account.user?.id])

  const claimWeeklyVisit = useCallback(() => {
    if (!account.user || account.sessionLoading) return
    const attemptKey = `${account.user.id}:${currentWeekKey}`
    if (rewardAttemptRef.current === attemptKey) return
    rewardAttemptRef.current = attemptKey

    void account.claimWeeklyReward()
      .then((result) => {
        if (result.awarded) {
          setWeeklyReward({
            amount: result.amount || 2,
            credits: result.credits,
          })
        }
      })
      .catch((error) => {
        rewardAttemptRef.current = ''
        setDownloadNotice({
          tone: 'error',
          message: error.message || 'The weekly credits could not be added. Try again shortly.',
        })
      })
  }, [
    account.claimWeeklyReward,
    account.sessionLoading,
    account.user?.id,
    currentWeekKey,
  ])

  const openSubmissionForm = () => {
    player.pause()
    window.history.pushState({}, '', '/weekly/apply')
    setIsSubmissionOpen(true)
  }

  const closeSubmissionForm = () => {
    window.history.replaceState({}, '', '/')
    setIsSubmissionOpen(false)
  }

  const handleDownload = async (track) => {
    if (!track || player.activeMixtape?.isWeekly) return
    setDownloadNotice(null)

    try {
      const result = await account.downloadTrack(track)
      setDownloadNotice({
        tone: 'success',
        message: `${track.title} saved. ${result.credits} download credit${result.credits === 1 ? '' : 's'} left.`,
      })
    } catch (error) {
      if (error.status === 401) openAccount()
      setDownloadNotice({
        tone: 'error',
        message: error.message || 'That download did not complete. Check your balance before trying again.',
      })
    }
  }

  const handleSelectMixtape = (mixtape, event) => {
    if (mixtape.isWeekly && !account.user) {
      if (account.sessionLoading) weeklyPromptPendingRef.current = true
      else openAccount()
      return
    }
    weeklyPromptPendingRef.current = false
    if (mixtape.isWeekly) claimWeeklyVisit()

    player.playClick()
    const sourceRect = event.currentTarget.getBoundingClientRect()
    const deckRect = deckTargetRef.current?.getBoundingClientRect()

    if (!deckRect) return

    const sourceX = sourceRect.left + sourceRect.width / 2
    const sourceY = sourceRect.top + sourceRect.height / 2
    const targetX = deckRect.left + deckRect.width / 2
    const targetY = deckRect.top + deckRect.height / 2
    const faceWidth = deckRect.width * 0.78
    const faceHeight = faceWidth / 1.58
    const seatedHeight = deckRect.height * 0.72
    const seatedRatio = Math.min(1, seatedHeight / faceHeight)
    const seatTilt = Math.acos(seatedRatio) * (180 / Math.PI)
    const liftDistance = Math.min(
      18,
      sourceRect.height * 0.1,
      Math.max(0, sourceRect.top - 4),
    )
    const approachY = targetY - faceHeight * 0.62
    const flipProgress = 0.52

    setDeckMixtape(null)
    setFlyingTape({
      id: flightIdRef.current += 1,
      mixtape,
      sourceX,
      sourceY,
      sourceWidth: event.currentTarget.offsetWidth,
      sourceHeight: event.currentTarget.offsetHeight,
      liftY: sourceY - liftDistance,
      flipX: sourceX + (targetX - sourceX) * 0.42,
      flipY: sourceY + (approachY - sourceY) * flipProgress,
      approachY,
      entryY: targetY - faceHeight * 0.18,
      targetX,
      targetY,
      faceWidth,
      faceHeight,
      seatTilt,
      startTilt:
        getComputedStyle(event.currentTarget).getPropertyValue('--tape-tilt').trim() || '0deg',
    })
    player.selectMixtape(mixtape)
  }

  return (
    <main className={`app-stage ${!isSubmissionOpen && isWeekly ? 'is-weekly' : ''}`}>
      {isSubmissionOpen ? (
        <WeeklySubmissionForm onClose={closeSubmissionForm} />
      ) : (
        <>
          <div className="wallpaper-grain" aria-hidden="true" />
          <MixtapeShelf
            mixtapes={availableMixtapes}
            activeId={player.activeMixtape?.id}
            loadingId={flyingTape?.mixtape.id}
            onSelect={handleSelectMixtape}
          />

          {flyingTape && (
            <div
              key={flyingTape.id}
              className="flying-tape"
              style={{
                '--flight-source-x': `${flyingTape.sourceX}px`,
                '--flight-source-y': `${flyingTape.sourceY}px`,
                '--flight-source-width': `${flyingTape.sourceWidth}px`,
                '--flight-source-height': `${flyingTape.sourceHeight}px`,
                '--flight-lift-y': `${flyingTape.liftY}px`,
                '--flight-flip-x': `${flyingTape.flipX}px`,
                '--flight-flip-y': `${flyingTape.flipY}px`,
                '--flight-approach-y': `${flyingTape.approachY}px`,
                '--flight-entry-y': `${flyingTape.entryY}px`,
                '--flight-target-x': `${flyingTape.targetX}px`,
                '--flight-target-y': `${flyingTape.targetY}px`,
                '--flight-face-width': `${flyingTape.faceWidth}px`,
                '--flight-face-height': `${flyingTape.faceHeight}px`,
                '--flight-seat-tilt-mid': `${flyingTape.seatTilt * 0.45}deg`,
                '--flight-seat-tilt': `${flyingTape.seatTilt}deg`,
                '--flight-start-tilt': flyingTape.startTilt,
              }}
              aria-hidden="true"
              onAnimationEnd={(event) => {
                if (event.target !== event.currentTarget) return
                setDeckMixtape(flyingTape.mixtape)
                setFlyingTape(null)
              }}
            >
              <span className="flying-tape__spine">
                <CassetteSpine mixtape={flyingTape.mixtape} />
              </span>
              <span className="flying-tape__face">
                <Cassette mixtape={flyingTape.mixtape} />
              </span>
            </div>
          )}

          <Boombox
            player={player}
            socials={activeSocials}
            isLoading={Boolean(flyingTape)}
            deckMixtape={deckMixtape}
            deckTargetRef={deckTargetRef}
            visualizerRef={visualizerRef}
            onApply={openSubmissionForm}
            tunerPosition={tunerPosition}
            onTune={setTunerPosition}
            account={account}
            isDownloading={Boolean(account.downloadingTrackId)}
            onDownload={handleDownload}
            onOpenAccount={openAccount}
          />

          {isSecretStation && (
            <SecretStation
              imageSrc={secretSignal}
              tunerPosition={tunerPosition}
              onTune={setTunerPosition}
            />
          )}
        </>
      )}

      <AccountModal
        open={isAccountOpen}
        onClose={closeAccount}
        account={account}
      />
      <WeeklyRewardCelebration
        open={Boolean(weeklyReward)}
        amount={weeklyReward?.amount}
        credits={weeklyReward?.credits}
        onClose={closeWeeklyReward}
      />
      {downloadNotice && (
        <div className={`account-notice account-notice--${downloadNotice.tone}`} role="status">
          <span>{downloadNotice.message}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setDownloadNotice(null)}>&times;</button>
        </div>
      )}

      <audio ref={player.audioRef} preload="metadata" {...player.audioEvents} />
      <p className="sr-only" aria-live="polite">
        {player.currentTrack
          ? `${player.isPlaying ? 'Playing' : 'Paused'} ${player.currentTrack.title} from ${player.activeMixtape.title}`
          : 'Select a mixtape to begin.'}
      </p>
    </main>
  )
}
