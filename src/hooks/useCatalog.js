import { useCallback, useEffect, useState } from 'react'

export function useCatalog(fallbackMixtapes) {
  const [catalog, setCatalog] = useState(fallbackMixtapes)

  const refreshCatalog = useCallback(async (signal) => {
    try {
      const response = await fetch('/api/catalog', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal,
      })
      if (!response.ok) return
      const payload = await response.json()
      if (Array.isArray(payload.mixtapes) && payload.mixtapes.length) {
        setCatalog(payload.mixtapes)
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        // The bundled catalog keeps the player navigable during local UI work.
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refreshCatalog(controller.signal)
    return () => controller.abort()
  }, [refreshCatalog])

  return [catalog, refreshCatalog]
}
