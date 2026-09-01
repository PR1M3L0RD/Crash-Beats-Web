import { useEffect, useState } from 'react'
import {
  createWeeklyArtistSchedule,
  fallbackWeeklyArtists,
  getWeeklyArtist,
} from '../data/weeklyArtists'

export function useWeeklyArtist(refreshKey) {
  const [weekly, setWeekly] = useState(() => {
    const artist = getWeeklyArtist(fallbackWeeklyArtists)
    return {
      artist,
      schedule: createWeeklyArtistSchedule(
        fallbackWeeklyArtists,
        artist?.scheduleIndex,
      ),
      tracks: [],
    }
  })

  useEffect(() => {
    const controller = new AbortController()
    let retryTimer

    async function refreshArtist() {
      try {
        const query = refreshKey ? `?week=${encodeURIComponent(refreshKey)}` : ''
        const apiResponse = await fetch(`/api/weekly${query}`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
        if (apiResponse.ok) {
          const payload = await apiResponse.json()
          if (payload.artist && payload.mixtape) {
            const scheduleSource = Array.isArray(payload.schedule) && payload.schedule.length
              ? payload.schedule
              : [payload.artist]
            setWeekly({
              artist: payload.artist,
              schedule: createWeeklyArtistSchedule(
                scheduleSource,
                Number.isInteger(payload.currentScheduleIndex)
                  ? payload.currentScheduleIndex
                  : payload.artist.scheduleIndex,
              ),
              tracks: payload.mixtape.tracks || [],
            })
            return
          }
        }

        // Keep the bundled artist if the owner-authorized Worker endpoint is unavailable.
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Keep the bundled artist so a temporary Google outage never empties the tape.
        }
      } finally {
        if (!controller.signal.aborted) {
          retryTimer = window.setTimeout(refreshArtist, 5 * 60 * 1000)
        }
      }
    }

    void refreshArtist()
    return () => {
      controller.abort()
      window.clearTimeout(retryTimer)
    }
  }, [refreshKey])

  return weekly
}
