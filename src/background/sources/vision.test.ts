import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../broadcast', () => ({ broadcastState: vi.fn() }))
vi.mock('../log', () => ({ logGep: vi.fn() }))
vi.mock('../app-state', () => ({
  deriveState: () => ({ lockedShopSlots: [4, 5], bonusItems: { stock: { shopSlotPass: 0 } } }),
}))
vi.mock('../rules/engine', () => ({ invalidateRun: vi.fn(), validateCurrentRules: vi.fn() }))
vi.mock('../rules/bonus-usage', () => ({ consumeBonusItem: vi.fn(), applyPendingTraps: vi.fn() }))
vi.mock('../archipelago/checks', () => ({ validateImmediateMinorChecks: vi.fn() }))
vi.mock('../runtime', () => ({ platform: { kind: 'electron' } }))

type VisionModule = typeof import('./vision')
type StateModule = typeof import('../state')
type VisionGameState = import('../../types/vision').VisionGameState

let vision: VisionModule
let state: StateModule

const FIRST_SHOP = ['a1', 'b1', 'c1', 'd1', 'e1']
const SLIDING_SHOP = ['a2', 'b2', 'c2', 'd2', 'e2']
const SECOND_SHOP = ['a3', 'b3', 'c3', 'd3', 'e3']
const THIRD_SHOP = ['a4', 'b4', 'c4', 'd4', 'e4']

function frame(shopVisible: boolean, shopSnapshot: string[], stageFingerprint = 'stage-2-3'): VisionGameState {
  return {
    shopVisible,
    shopSnapshot,
    gold: null,
    xp: null,
    level: null,
    stageFingerprint,
    augmentScreenVisible: false,
    augmentHeaderGone: true,
    augmentCards: [],
  }
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  vi.resetModules()
  vision = await import('./vision')
  state = await import('../state')
  vision.handleVisionGameState(frame(true, FIRST_SHOP))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('vision shop rerolls', () => {
  it('counts a full shop change while the shop stays visible', () => {
    vision.handleVisionGameState(frame(true, SECOND_SHOP))
    vi.advanceTimersByTime(1000)

    expect(state.shop.rerollsUsed).toBe(1)
  })

  it('does not count the shop sliding out when it hides (carousel)', () => {
    vision.handleVisionGameState(frame(true, SLIDING_SHOP))
    vi.advanceTimersByTime(200)
    vision.handleVisionGameState(frame(false, SLIDING_SHOP))
    vi.advanceTimersByTime(1000)

    expect(state.shop.rerollsUsed).toBe(0)
    expect(state.shop.baseline).toEqual(SLIDING_SHOP)

    vision.handleVisionGameState(frame(true, SECOND_SHOP))
    vi.advanceTimersByTime(1000)

    expect(state.shop.rerollsUsed).toBe(0)
    expect(state.shop.baseline).toEqual(SECOND_SHOP)
  })
})

describe('round end from the TFT log', () => {
  it('treats the first full change after combat as the auto refresh when the stage label misses it', () => {
    vision.handleVisionGameState(frame(true, FIRST_SHOP))
    vision.handleVisionLogRoundEnd(Date.now() - 500)
    vi.advanceTimersByTime(4000)
    vision.handleVisionGameState(frame(true, SECOND_SHOP))
    vi.advanceTimersByTime(1000)

    expect(state.shop.rerollsUsed).toBe(0)
    expect(state.shop.baseline).toEqual(SECOND_SHOP)

    vi.advanceTimersByTime(5000)
    vision.handleVisionGameState(frame(true, THIRD_SHOP))
    vi.advanceTimersByTime(1000)

    expect(state.shop.rerollsUsed).toBe(1)
  })

  it('resets the per-round counters', () => {
    vision.handleVisionGameState(frame(true, SECOND_SHOP))
    vi.advanceTimersByTime(1000)
    expect(state.shop.rerollsUsed).toBe(1)

    vision.handleVisionLogRoundEnd(Date.now())

    expect(state.shop.rerollsUsed).toBe(0)
  })

  it('is ignored when the stage label already started the round', () => {
    const endedAt = Date.now()
    vi.advanceTimersByTime(500)
    vision.handleVisionGameState(frame(true, FIRST_SHOP, 'stage-2-4'))
    vision.handleVisionGameState(frame(true, SECOND_SHOP, 'stage-2-4'))
    vi.advanceTimersByTime(1000)
    vision.handleVisionLogRoundEnd(endedAt)

    vi.advanceTimersByTime(4000)
    vision.handleVisionGameState(frame(true, THIRD_SHOP, 'stage-2-4'))
    vi.advanceTimersByTime(1000)

    expect(state.shop.rerollsUsed).toBe(1)
  })
})
