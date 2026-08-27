import { useEffect, useState } from 'react'

export function useCatalog(fallbackMixtapes) {
  const [catalog, setCatalog] = useState(fallbackMixtapes)

  useEffect(() => {
    const controller = new AbortController()

    async function refreshCatalog() {
      try {
        const response = await fetch('/api/catalog', {
          headers: { accept: 'application/json' },
          signal: controller.signal,
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
    }

    void refreshCatalog()
    return () => controller.abort()
  }, [])

  return catalog
}
