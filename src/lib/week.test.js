import { describe, expect, it } from 'vitest'
import { getMondayUtcWeekKey, millisecondsUntilNextMondayUtc } from './week'

describe('UTC week helpers', () => {
  it('changes the week key exactly at Monday 00:00 UTC', () => {
    expect(getMondayUtcWeekKey('2026-08-30T23:59:59.999Z')).toBe('2026-08-24')
    expect(getMondayUtcWeekKey('2026-08-31T00:00:00.000Z')).toBe('2026-08-31')
  })

  it('schedules the next rollover from the current instant', () => {
    expect(millisecondsUntilNextMondayUtc('2026-08-30T23:59:59.750Z')).toBe(250)
    expect(millisecondsUntilNextMondayUtc('2026-08-31T00:00:00.000Z')).toBe(7 * 24 * 60 * 60 * 1000)
    expect(() => millisecondsUntilNextMondayUtc('not-a-date')).toThrow(TypeError)
  })
})
