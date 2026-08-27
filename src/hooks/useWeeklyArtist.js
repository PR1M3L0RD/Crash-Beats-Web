import { useEffect, useState } from 'react'
import {
  fallbackWeeklyArtists,
  getWeeklyArtist,
} from '../data/weeklyArtists'

export function useWeeklyArtist() {
  const [weekly, setWeekly] = useState(() => ({
    artist: getWeeklyArtist(fallbackWeeklyArtists),
    tracks: [],
  }))

  useEffect(() => {
    const controller = new AbortController()

    async function refreshArtist() {
      try {
        const apiResponse = await fetch('/api/weekly', {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
        if (apiResponse.ok) {
          const payload = await apiResponse.json()
          if (payload.artist && payload.mixtape) {
            setWeekly({ artist: payload.artist, tracks: payload.mixtape.tracks || [] })
            return
          }
        }

        // Keep the bundled artist if the owner-authorized Worker endpoint is unavailable.
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Keep the bundled artist so a temporary Google outage never empties the tape.
        }
      }
    }

    void refreshArtist()
    return () => controller.abort()
  }, [])

  return weekly
}
