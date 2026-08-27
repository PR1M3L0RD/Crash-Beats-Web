import { useRef } from 'react'

const MIN_FREQUENCY = 88
const MAX_FREQUENCY = 108
const FREQUENCY_STEP = 0.1

function clampFrequency(value) {
  return Math.min(MAX_FREQUENCY, Math.max(MIN_FREQUENCY, value))
}

export function RadioTuner({ value, onChange }) {
  const lineRef = useRef(null)
  const position = ((value - MIN_FREQUENCY) / (MAX_FREQUENCY - MIN_FREQUENCY)) * 100

  const tuneFromPointer = (clientX) => {
    const bounds = lineRef.current?.getBoundingClientRect()
    if (!bounds?.width) return

    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width))
    const frequency = MIN_FREQUENCY + ratio * (MAX_FREQUENCY - MIN_FREQUENCY)
    onChange(Number((Math.round(frequency / FREQUENCY_STEP) * FREQUENCY_STEP).toFixed(1)))
  }

  const handleKeyDown = (event) => {
    const increments = {
      ArrowLeft: -FREQUENCY_STEP,
      ArrowDown: -FREQUENCY_STEP,
      ArrowRight: FREQUENCY_STEP,
      ArrowUp: FREQUENCY_STEP,
      PageDown: -1,
      PageUp: 1,
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      onChange(event.key === 'Home' ? MIN_FREQUENCY : MAX_FREQUENCY)
      return
    }

    if (increments[event.key] === undefined) return
    event.preventDefault()
    onChange(Number(clampFrequency(value + increments[event.key]).toFixed(1)))
  }

  return (
    <div className="radio-scale">
      <div className="radio-scale__labels" aria-hidden="true">
        <span>88</span><span>92</span><span>98</span><span>104</span><span>108</span>
      </div>
      <div className="radio-scale__line" ref={lineRef}>
        <i /><i /><i /><i /><i /><i /><i /><i /><i />
        <button
          className="radio-needle"
          type="button"
          role="slider"
          style={{ '--tuner-position': `${position}%` }}
          aria-label="Radio station tuning dial"
          aria-valuemin={MIN_FREQUENCY}
          aria-valuemax={MAX_FREQUENCY}
          aria-valuenow={value}
          aria-valuetext={`${value.toFixed(1)} FM`}
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              tuneFromPointer(event.clientX)
            }
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
        />
      </div>
    </div>
  )
}
