const AMBIENT_THEME_BY_MIXTAPE = {
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

const PARTICLES = Array.from({ length: 24 }, (_, index) => {
  const seed = index + 1

  return {
    id: index,
    x: (seed * 37 + 7) % 100,
    y: (seed * 61 + 13) % 100,
    size: 4 + ((seed * 7) % 12),
    duration: 9 + ((seed * 13) % 11),
    delay: -((seed * 17) % 19),
    drift: -52 + ((seed * 23) % 105),
    turn: (seed * 47) % 360,
  }
})

export function getAmbientTheme(mixtape) {
  if (!mixtape) return null
  if (mixtape.isWeekly || mixtape.id === 'crash-weekly') return 'weekly'
  return AMBIENT_THEME_BY_MIXTAPE[mixtape.id] || 'signal'
}

export function AmbientEffects({ mixtape, isPlaying = false }) {
  const theme = getAmbientTheme(mixtape)
  if (!theme) return null

  return (
    <div
      className={`ambient-effects ambient-effects--${theme} ${isPlaying ? 'is-playing' : ''}`}
      data-mixtape-id={mixtape.id}
      data-mixtape-theme={theme}
      style={{
        '--ambient-accent': mixtape.accent || '#e85d3f',
        '--ambient-accent-2': mixtape.accent2 || '#f3bd55',
        '--ambient-ink': mixtape.ink || '#251b18',
      }}
      aria-hidden="true"
    >
      <div className="ambient-effects__atmosphere" />
      <div className="ambient-effects__halos">
        <i />
        <i />
        <i />
      </div>
      <div className="ambient-effects__waves">
        <i />
        <i />
        <i />
      </div>
      <div className="ambient-effects__particles">
        {PARTICLES.map((particle) => (
          <i
            key={particle.id}
            className={`ambient-effects__particle ambient-effects__particle--${particle.id % 3}`}
            style={{
              '--particle-x': `${particle.x}%`,
              '--particle-y': `${particle.y}%`,
              '--particle-size': `${particle.size}px`,
              '--particle-duration': `${particle.duration}s`,
              '--particle-delay': `${particle.delay}s`,
              '--particle-drift': `${particle.drift}px`,
              '--particle-turn': `${particle.turn}deg`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
