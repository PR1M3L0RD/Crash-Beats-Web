import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mixtapes } from '../data/mixtapes'
import { AmbientEffects, getAmbientTheme } from './AmbientEffects'

const expectedThemes = {
  'velvet-static': 'soft',
  'midnight-circuit': 'night',
  'heatwave-fm': 'heat',
  'concrete-voltage': 'heavy',
  'crash-and-friends': 'collabs',
  'boom-bap-broadcast': 'soul',
  'crash-classics': 'classics',
  'rap-signal': 'rap',
  'aftershock-trap': 'trap',
}

describe('AmbientEffects', () => {
  it('assigns a distinct ambient preset to every bundled mixtape', () => {
    expect(Object.fromEntries(
      mixtapes.map((mixtape) => [mixtape.id, getAmbientTheme(mixtape)]),
    )).toEqual(expectedThemes)
  })

  it('uses the neon weekly preset and a safe signal fallback', () => {
    expect(getAmbientTheme({ id: 'crash-weekly', isWeekly: true })).toBe('weekly')
    expect(getAmbientTheme({ id: 'future-catalog-tape' })).toBe('signal')
    expect(getAmbientTheme(null)).toBeNull()
  })

  it('renders deterministic, decorative particles from the selected tape palette', () => {
    const markup = renderToStaticMarkup(
      createElement(AmbientEffects, { mixtape: mixtapes[0], isPlaying: true }),
    )

    expect(markup).toContain('ambient-effects--soft is-playing')
    expect(markup).toContain('data-mixtape-id="velvet-static"')
    expect(markup).toContain('data-mixtape-theme="soft"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup.match(/ambient-effects__particle ambient-effects__particle--/g)).toHaveLength(24)
    expect(markup).toContain('--ambient-accent:#e85d3f')
    expect(markup).toContain('--ambient-accent-2:#f3bd55')
  })

  it('renders no visual layer before a mixtape is selected', () => {
    expect(renderToStaticMarkup(createElement(AmbientEffects, { mixtape: null }))).toBe('')
  })
})
