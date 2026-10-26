import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateCurrentRules: vi.fn(),
  validateImmediateMinorChecks: vi.fn(),
}))

vi.mock('../broadcast', () => ({ broadcastState: vi.fn() }))
vi.mock('../log', () => ({ logGep: vi.fn() }))
vi.mock('../app-state', () => ({ deriveState: vi.fn() }))
vi.mock('../rules/engine', () => ({ invalidateRun: vi.fn(), validateCurrentRules: mocks.validateCurrentRules }))
vi.mock('../rules/bonus-usage', () => ({ consumeBonusItem: vi.fn() }))
vi.mock('../archipelago/checks', () => ({ validateImmediateMinorChecks: mocks.validateImmediateMinorChecks }))
vi.mock('../runtime', () => ({ platform: { kind: 'electron' } }))

type XpModule = typeof import('./xp')
type StateModule = typeof import('../state')

let detection: XpModule
let state: StateModule

const LEVEL_4 = { level: 4, current_xp: 2, xp_max: 10 }
const LEVEL_4_AFTER_BUY = { level: 4, current_xp: 6, xp_max: 10 }

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  vi.resetModules()
  vi.clearAllMocks()
  detection = await import('./xp')
  state = await import('../state')
  detection.handleEconomyUpdate(20, LEVEL_4)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('handleEconomyUpdate', () => {
  it('counts a 4 gold drop with an XP gain in the same update', () => {
    detection.handleEconomyUpdate(16, LEVEL_4_AFTER_BUY)

    expect(state.economy.xpBuysThisRound).toBe(1)
    expect(mocks.validateCurrentRules).toHaveBeenCalledTimes(1)
  })

  it('counts a level up as an XP gain', () => {
    detection.handleEconomyUpdate(16, { level: 5, current_xp: 0, xp_max: 20 })

    expect(state.economy.xpBuysThisRound).toBe(1)
  })

  it('pairs a gold drop with an XP gain that arrives later', () => {
    detection.handleEconomyUpdate(16, null)
    detection.handleEconomyUpdate(null, LEVEL_4_AFTER_BUY)

    expect(state.economy.xpBuysThisRound).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(state.economy.xpBuysThisRound).toBe(1)
  })

  it('pairs an XP gain with a gold drop that arrives later', () => {
    detection.handleEconomyUpdate(null, LEVEL_4_AFTER_BUY)
    detection.handleEconomyUpdate(16, null)

    expect(state.economy.xpBuysThisRound).toBe(1)
  })

  it('falls back to the gold drop alone when no XP update follows', () => {
    detection.handleEconomyUpdate(16, null)

    expect(state.economy.xpBuysThisRound).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(state.economy.xpBuysThisRound).toBe(1)
  })

  it('ignores gold drops of other amounts', () => {
    detection.handleEconomyUpdate(17, null)
    detection.handleEconomyUpdate(12, null)
    vi.advanceTimersByTime(2000)

    expect(state.economy.xpBuysThisRound).toBe(0)
  })

  it('ignores XP gains without a gold drop', () => {
    detection.handleEconomyUpdate(20, LEVEL_4_AFTER_BUY)
    vi.advanceTimersByTime(2000)

    expect(state.economy.xpBuysThisRound).toBe(0)
  })

  it('keeps the latest gold and XP and checks gold-based locations', () => {
    detection.handleEconomyUpdate(25, LEVEL_4_AFTER_BUY)

    expect(state.economy.gold).toBe(25)
    expect(state.economy.xp).toEqual(LEVEL_4_AFTER_BUY)
    expect(mocks.validateImmediateMinorChecks).toHaveBeenLastCalledWith({ gold: 25, isPlayerCombat: false })
  })
})

describe('4-cost champion purchases', () => {
  it('skip the gold-only fallback when the purchase came first', () => {
    detection.noteShopPurchaseForXpFallback()
    detection.handleEconomyUpdate(16, null)
    vi.advanceTimersByTime(2000)

    expect(state.economy.xpBuysThisRound).toBe(0)
  })

  it('cancel a pending gold-only fallback when the purchase follows', () => {
    detection.handleEconomyUpdate(16, null)
    vi.advanceTimersByTime(500)
    detection.noteShopPurchaseForXpFallback()
    vi.advanceTimersByTime(2000)

    expect(state.economy.xpBuysThisRound).toBe(0)
  })

  it('no longer suppress a gold drop once the purchase is old', () => {
    detection.noteShopPurchaseForXpFallback()
    vi.advanceTimersByTime(1500)
    detection.handleEconomyUpdate(16, null)
    vi.advanceTimersByTime(1000)

    expect(state.economy.xpBuysThisRound).toBe(1)
  })
})

describe('vision XP readings', () => {
  it('skip the gold-only fallback when the XP counter stays readable and unchanged', () => {
    detection.noteXpReading(LEVEL_4)
    detection.handleEconomyUpdate(16, null)
    vi.advanceTimersByTime(2000)

    expect(state.economy.xpBuysThisRound).toBe(0)
  })

  it('keep the gold-only fallback when the XP counter turns unreadable', () => {
    detection.noteXpReading(LEVEL_4)
    detection.handleEconomyUpdate(16, null)
    detection.noteXpReading(null)
    vi.advanceTimersByTime(1000)

    expect(state.economy.xpBuysThisRound).toBe(1)
  })

  it('still count a readable XP gain that arrives after the gold drop', () => {
    detection.noteXpReading(LEVEL_4)
    detection.handleEconomyUpdate(16, null)
    detection.noteXpReading(LEVEL_4_AFTER_BUY)
    detection.handleEconomyUpdate(null, LEVEL_4_AFTER_BUY)
    vi.advanceTimersByTime(2000)

    expect(state.economy.xpBuysThisRound).toBe(1)
  })

  it('are forgotten on reset', () => {
    detection.noteXpReading(LEVEL_4)
    detection.resetXpDetection('match reset')
    detection.handleEconomyUpdate(20, LEVEL_4)
    detection.handleEconomyUpdate(16, null)
    vi.advanceTimersByTime(1000)

    expect(state.economy.xpBuysThisRound).toBe(1)
  })
})

describe('resetXpDetection', () => {
  it('drops pending gold-only fallbacks', () => {
    detection.handleEconomyUpdate(16, null)
    detection.resetXpDetection('battle start')
    vi.advanceTimersByTime(2000)

    expect(state.economy.xpBuysThisRound).toBe(0)
  })

  it('drops a half-seen purchase', () => {
    detection.handleEconomyUpdate(null, LEVEL_4_AFTER_BUY)
    detection.resetXpDetection('battle start')
    detection.handleEconomyUpdate(16, null)

    expect(state.economy.xpBuysThisRound).toBe(0)
  })
})
