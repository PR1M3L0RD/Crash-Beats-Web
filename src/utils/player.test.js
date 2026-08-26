import { describe, expect, it, vi } from 'vitest'
import {
  formatTime,
  getNextIndex,
  getPreviousIndex,
  getRemainingTime,
} from './player'

describe('player helpers', () => {
  it('formats time for the tape display', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(65.9)).toBe('1:05')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })

  it('advances and wraps a playlist', () => {
    expect(getNextIndex(2, 4)).toBe(3)
    expect(getNextIndex(3, 4)).toBe(0)
    expect(getPreviousIndex(0, 4)).toBe(3)
  })

  it('shuffles without repeating the current song', () => {
    expect(getNextIndex(2, 5, true, vi.fn(() => 0))).toBe(3)
    expect(getNextIndex(2, 5, true, vi.fn(() => 0.999))).toBe(1)
  })

  it('returns safe values for a one-song playlist', () => {
    expect(getNextIndex(0, 1, true)).toBe(0)
    expect(getPreviousIndex(0, 1)).toBe(0)
  })

  it('calculates non-negative remaining time', () => {
    expect(getRemainingTime(180, 45)).toBe(135)
    expect(getRemainingTime(180, 190)).toBe(0)
    expect(getRemainingTime(Number.NaN, 10)).toBe(0)
  })
})
