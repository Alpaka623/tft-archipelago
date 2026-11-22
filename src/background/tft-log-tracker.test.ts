import { describe, expect, it } from 'vitest'
import { TftLogTracker, parseTftLogTimestamp } from './tft-log-tracker'

describe('TftLogTracker', () => {
  it('clears the tracked match and round count on reset (new TFT.log file)', () => {
    const tracker = new TftLogTracker()
    const matchAt = '2026.11.22-16.00.00:000'
    tracker.handleEvents([
      { type: 'match_start', at: matchAt },
      { type: 'phase', at: '2026.11.22-16.01.00:000', phase: 'CombatDeparture' },
      { type: 'phase', at: '2026.11.22-16.02.00:000', phase: 'CombatDeparture' },
    ])

    const startedMs = parseTftLogTimestamp(matchAt)!
    expect(tracker.getCurrentRound(startedMs - 1000)).toBe(3)

    tracker.reset()
    expect(tracker.getCurrentRound(startedMs - 1000)).toBeNull()
  })
})
