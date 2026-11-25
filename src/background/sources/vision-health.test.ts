import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPTURE_GRACE_MS, DETECTION_REASONS } from '../detection/health'

vi.mock('../broadcast', () => ({ broadcastState: vi.fn() }))
vi.mock('../log', () => ({ logGep: vi.fn() }))
vi.mock('../live-round', () => ({ getLiveRound: () => 3 }))
vi.mock('../runtime', () => ({ platform: { kind: 'electron' } }))

type HealthModule = typeof import('./vision-health')
type StateModule = typeof import('../state')

let health: HealthModule
let state: StateModule

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  vi.resetModules()
  health = await import('./vision-health')
  state = await import('../state')
  state.session.isTftRunning = true
  state.session.matchState = 'in_match'
})

afterEach(() => {
  state.session.matchState = 'menu'
  health.refreshDetectionHealth()
  vi.useRealTimers()
})

describe('vision detection status', () => {
  it('turns Limited when the vision window never reports during a match', () => {
    health.resetDetectionHealth()
    health.refreshDetectionHealth()
    expect(state.detection.health?.status).toBe('searching')

    vi.advanceTimersByTime(CAPTURE_GRACE_MS + 2000)

    expect(state.detection.health).toEqual({ status: 'degraded', reason: DETECTION_REASONS.notCapturing })
  })

  it('turns Limited when the vision window stops reporting mid-match', () => {
    health.handleVisionDetection({ capturing: true, hudVerified: true, shopVisible: true, goldRead: true })
    expect(state.detection.health?.status).toBe('ok')

    vi.advanceTimersByTime(60_000)

    expect(state.detection.health?.status).toBe('degraded')
  })

  it('drops facts from before a restart and keeps checking mid-match without a match change', async () => {
    const { broadcastState } = await import('../broadcast')
    health.handleVisionDetection({ capturing: true, hudVerified: true, shopVisible: true, goldRead: true })
    vi.mocked(broadcastState).mockClear()

    // TFT restarted into the running match: the session start resets, the caller broadcasts itself
    health.resetDetectionHealth()
    health.refreshDetectionHealth(false)
    expect(state.detection.health).toEqual({ status: 'searching', reason: DETECTION_REASONS.startingCapture })
    expect(broadcastState).not.toHaveBeenCalled()

    vi.advanceTimersByTime(CAPTURE_GRACE_MS + 2000)

    expect(state.detection.health).toEqual({ status: 'degraded', reason: DETECTION_REASONS.notCapturing })
    expect(broadcastState).toHaveBeenCalled()
  })

  it('hides the status outside a match', () => {
    health.handleVisionDetection({ capturing: true, hudVerified: true, shopVisible: true, goldRead: true })
    state.session.matchState = 'menu'

    health.refreshDetectionHealth()

    expect(state.detection.health).toBeNull()
  })
})
