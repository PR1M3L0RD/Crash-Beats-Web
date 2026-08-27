import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getNextIndex,
  getPreviousIndex,
  getRemainingTime,
} from '../utils/player'

const DEFAULT_VOLUME = 0.82
const BUTTON_SOUND_VOLUME_RATIO = 0.5

function getStoredVolume() {
  try {
    const stored = Number.parseFloat(window.localStorage.getItem('crash-beats-volume'))
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

export function useAudioPlayer(mixtapes, visualizerRef) {
  const audioRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const animationFrameRef = useRef(null)
  const playbackRef = useRef({ mixtapeId: null, trackIndex: 0 })
  const [mixtapeId, setMixtapeId] = useState(null)
  const [trackIndex, setTrackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isShuffle, setIsShuffle] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(getStoredVolume)
  const [error, setError] = useState('')
  const [analyserReady, setAnalyserReady] = useState(false)

  const activeMixtape = mixtapes.find((mixtape) => mixtape.id === mixtapeId) ?? null
  const currentTrack = activeMixtape?.tracks[trackIndex] ?? null

  const startVisualizer = useCallback(() => {
    if (!analyserRef.current || animationFrameRef.current) return

    const analyser = analyserRef.current
    const bins = new Uint8Array(analyser.frequencyBinCount)
    const isCompactViewport = Math.min(window.innerWidth, window.innerHeight) <= 680
    const speakerTravel = isCompactViewport ? 0.16 : 0.095
    let smoothedBass = 0
    let pulse = 0

    const draw = () => {
      analyser.getByteFrequencyData(bins)

      const context = audioContextRef.current
      const hzPerBin = context ? context.sampleRate / analyser.fftSize : 43
      const firstBin = Math.max(1, Math.floor(35 / hzPerBin))
      const lastBin = Math.max(firstBin + 1, Math.ceil(170 / hzPerBin))
      let total = 0

      for (let index = firstBin; index <= lastBin; index += 1) {
        total += bins[index]
      }

      const rawBass = total / (lastBin - firstBin + 1) / 255
      const transient = Math.max(0, rawBass - smoothedBass) * 2.8
      smoothedBass = smoothedBass * 0.78 + rawBass * 0.22
      pulse = Math.max(pulse * 0.78, Math.min(1, smoothedBass * 0.72 + transient))

      const target = visualizerRef.current
      const audio = audioRef.current
      const activePulse = audio && !audio.paused ? pulse : 0

      if (target) {
        target.style.setProperty('--speaker-scale', String(1 + activePulse * speakerTravel))
        target.style.setProperty('--speaker-glow', String(Math.min(1, activePulse * 1.25)))
      }

      animationFrameRef.current = window.requestAnimationFrame(draw)
    }

    animationFrameRef.current = window.requestAnimationFrame(draw)
  }, [visualizerRef])

  const ensureAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return null

    const AudioContextClass = window.AudioContext || window.webkitAudioContext

    if (AudioContextClass && !audioContextRef.current) {
      try {
        const context = new AudioContextClass()
        const source = context.createMediaElementSource(audio)
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.68
        source.connect(analyser)
        analyser.connect(context.destination)
        audioContextRef.current = context
        analyserRef.current = analyser
        context.onstatechange = () => {
          setAnalyserReady(context.state === 'running')
        }
        setAnalyserReady(context.state === 'running')
        startVisualizer()
      } catch {
        setAnalyserReady(false)
      }
    }

    const context = audioContextRef.current
    if (context && context.state !== 'running' && context.state !== 'closed') {
      setAnalyserReady(false)
      void context
        .resume()
        .then(() => setAnalyserReady(context.state === 'running'))
        .catch(() => setAnalyserReady(false))
    } else if (context?.state === 'running') {
      setAnalyserReady(true)
    }

    return audio
  }, [startVisualizer])

  const playClick = useCallback(() => {
    const audio = ensureAudio()
    if (!audio) return

    const context = audioContextRef.current
    if (!context) return

    const now = context.currentTime
    const output = context.createGain()
    const body = context.createOscillator()
    const bodyGain = context.createGain()
    const snap = context.createOscillator()
    const snapGain = context.createGain()

    output.gain.setValueAtTime(volume * BUTTON_SOUND_VOLUME_RATIO, now)

    // A low square-wave knock gives the button its mechanical weight.
    body.type = 'square'
    body.frequency.setValueAtTime(155, now)
    body.frequency.exponentialRampToValueAtTime(58, now + 0.055)
    bodyGain.gain.setValueAtTime(0.0001, now)
    bodyGain.gain.exponentialRampToValueAtTime(0.72, now + 0.003)
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065)

    // A brief detuned sawtooth adds the crunchy plastic snap.
    snap.type = 'sawtooth'
    snap.frequency.setValueAtTime(920, now)
    snap.frequency.exponentialRampToValueAtTime(190, now + 0.022)
    snapGain.gain.setValueAtTime(0.0001, now)
    snapGain.gain.exponentialRampToValueAtTime(0.32, now + 0.0015)
    snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028)

    body.connect(bodyGain)
    bodyGain.connect(output)
    snap.connect(snapGain)
    snapGain.connect(output)
    output.connect(context.destination)

    body.start(now)
    snap.start(now)
    body.stop(now + 0.07)
    snap.stop(now + 0.03)
  }, [ensureAudio, volume])

  const loadTrack = useCallback(
    (nextMixtape, nextIndex, shouldPlay = true) => {
      const audio = ensureAudio()
      const nextTrack = nextMixtape?.tracks[nextIndex]
      if (!audio || !nextTrack) return

      playbackRef.current = {
        mixtapeId: nextMixtape.id,
        trackIndex: nextIndex,
      }
      setMixtapeId(nextMixtape.id)
      setTrackIndex(nextIndex)
      setCurrentTime(0)
      setDuration(0)
      setError('')

      audio.src = nextTrack.src
      audio.volume = volume
      audio.load()

      if (shouldPlay) {
        const playPromise = audio.play()
        if (playPromise) {
          void playPromise.catch(() => {
            setIsPlaying(false)
            setError('PRESS PLAY')
          })
        }
      }
    },
    [ensureAudio, volume],
  )

  const selectMixtape = useCallback(
    (nextMixtape) => loadTrack(nextMixtape, 0, true),
    [loadTrack],
  )

  const play = useCallback(() => {
    playClick()
    const audio = ensureAudio()
    if (!audio) return

    if (!playbackRef.current.mixtapeId) {
      loadTrack(mixtapes[0], 0, true)
      return
    }

    setError('')
    void audio.play().catch(() => setError('PRESS PLAY'))
  }, [ensureAudio, loadTrack, mixtapes, playClick])

  const pause = useCallback(() => {
    playClick()
    const audio = audioRef.current
    audio?.pause()
    setIsPlaying(false)
  }, [playClick])

  const next = useCallback(() => {
    playClick()
    const current = playbackRef.current
    const selectedMixtape =
      mixtapes.find((mixtape) => mixtape.id === current.mixtapeId) ?? mixtapes[0]
    const nextIndex = getNextIndex(
      current.mixtapeId ? current.trackIndex : -1,
      selectedMixtape.tracks.length,
      isShuffle,
    )
    loadTrack(selectedMixtape, nextIndex, true)
  }, [isShuffle, loadTrack, mixtapes, playClick])

  const previous = useCallback(() => {
    playClick()
    const audio = audioRef.current
    const current = playbackRef.current
    const selectedMixtape = mixtapes.find((mixtape) => mixtape.id === current.mixtapeId)

    if (!selectedMixtape) {
      loadTrack(mixtapes[0], 0, true)
      return
    }

    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      setCurrentTime(0)
      return
    }

    loadTrack(
      selectedMixtape,
      getPreviousIndex(current.trackIndex, selectedMixtape.tracks.length),
      true,
    )
  }, [loadTrack, mixtapes, playClick])

  const toggleShuffle = useCallback(() => {
    playClick()
    setIsShuffle((value) => !value)
  }, [playClick])

  const seek = useCallback((nextTime) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [])

  const setVolume = useCallback((nextVolume) => {
    const safeVolume = Math.min(1, Math.max(0, nextVolume))
    setVolumeState(safeVolume)
    if (audioRef.current) audioRef.current.volume = safeVolume

    try {
      window.localStorage.setItem('crash-beats-volume', String(safeVolume))
    } catch {
      // Storage can be disabled; volume still works for the current session.
    }
  }, [])

  const handleEnded = useCallback(() => {
    const current = playbackRef.current
    const selectedMixtape = mixtapes.find((mixtape) => mixtape.id === current.mixtapeId)
    if (!selectedMixtape) return

    loadTrack(
      selectedMixtape,
      getNextIndex(current.trackIndex, selectedMixtape.tracks.length, isShuffle),
      true,
    )
  }, [isShuffle, loadTrack, mixtapes])

  useEffect(
    () => () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
      if (audioContextRef.current) {
        audioContextRef.current.onstatechange = null
      }
      audioRef.current?.pause()
    },
    [],
  )

  return {
    audioRef,
    activeMixtape,
    currentTrack,
    trackIndex,
    isPlaying,
    isShuffle,
    currentTime,
    duration,
    remainingTime: getRemainingTime(duration, currentTime),
    volume,
    error,
    analyserReady,
    selectMixtape,
    play,
    pause,
    next,
    previous,
    toggleShuffle,
    seek,
    setVolume,
    playClick,
    audioEvents: {
      onPlay: () => {
        setIsPlaying(true)
        setError('')
      },
      onPause: () => setIsPlaying(false),
      onTimeUpdate: (event) => setCurrentTime(event.currentTarget.currentTime),
      onDurationChange: (event) => {
        const nextDuration = event.currentTarget.duration
        setDuration(Number.isFinite(nextDuration) ? nextDuration : 0)
      },
      onEnded: handleEnded,
      onError: () => {
        setIsPlaying(false)
        setError('TAPE ERROR')
      },
    },
  }
}
