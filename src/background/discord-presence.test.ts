import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '../types/state'

vi.mock('./runtime', () => ({ platform: { setRichPresence: vi.fn() } }))
vi.mock('./live-round', () => ({ getCurrentStageLabel: () => null }))

const { buildRichPresence } = await import('./discord-presence')

function state(overrides: Partial<AppState> = {}): AppState {
  return { connected: true, completedMajorCheckCount: 4, goalChecks: 10, isValidRun: true, ...overrides } as AppState
}

describe('buildRichPresence', () => {
  it('shows no progress while disconnected', () => {
    expect(buildRichPresence(state({ connected: false }), true, '3-2', 1000)).toEqual({
      details: 'Not connected to a multiworld',
      state: null,
      startedAt: null,
      runStatus: null,
    })
  })

  it('shows progress between matches', () => {
    expect(buildRichPresence(state(), false, null, 1000)).toEqual({
      details: '4/10 major checks',
      state: 'Waiting for a match',
      startedAt: null,
      runStatus: null,
    })
  })

  it('shows stage and run validity in a match', () => {
    expect(buildRichPresence(state({ isValidRun: false }), true, '3-2', 1000)).toEqual({
      details: '4/10 major checks',
      state: 'Stage 3-2 · Run invalidated',
      startedAt: 1000,
      runStatus: 'invalid',
    })
    expect(buildRichPresence(state(), true, null, 1000).state).toBe('In a match · Run valid')
  })

  it('marks the reached goal', () => {
    expect(buildRichPresence(state({ completedMajorCheckCount: 10 }), false, null, 0).details).toBe('Goal reached · 10/10 major checks')
  })
})
