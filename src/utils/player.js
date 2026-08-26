export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'

  const wholeSeconds = Math.floor(seconds)
  const minutes = Math.floor(wholeSeconds / 60)
  const remainder = wholeSeconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function getNextIndex(currentIndex, trackCount, shuffle = false, random = Math.random) {
  if (trackCount <= 1) return 0

  if (!shuffle) return (currentIndex + 1) % trackCount

  const offset = 1 + Math.floor(random() * (trackCount - 1))
  return (currentIndex + offset) % trackCount
}

export function getPreviousIndex(currentIndex, trackCount) {
  if (trackCount <= 1) return 0
  return (currentIndex - 1 + trackCount) % trackCount
}

export function getRemainingTime(duration, currentTime) {
  if (!Number.isFinite(duration)) return 0
  return Math.max(0, duration - currentTime)
}

