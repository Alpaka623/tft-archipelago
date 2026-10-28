import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deriveState: vi.fn(),
  invalidateRun: vi.fn(),
  validateCurrentRules: vi.fn(),
  consumeBonusItem: vi.fn(),
}))

vi.mock('../broadcast', () => ({ broadcastState: vi.fn() }))
vi.mock('../log', () => ({ logGep: vi.fn() }))
vi.mock('../app-state', () => ({ deriveState: mocks.deriveState }))
vi.mock('../rules/engine', () => ({
  invalidateRun: mocks.invalidateRun,
  validateCurrentRules: mocks.validateCurrentRules,
}))
vi.mock('../rules/bonus-usage', () => ({ consumeBonusItem: mocks.consumeBonusItem }))
vi.mock('../archipelago/checks', () => ({ validateImmediateMinorChecks: vi.fn() }))
vi.mock('../runtime', () => ({ platform: { kind: 'electron' } }))

type ShopModule = typeof import('./shop')
type StateModule = typeof import('../state')

let detection: ShopModule
let state: StateModule

const FIRST_SHOP = ['TFT18_Ahri', 'TFT18_Lux', 'TFT18_Vex', 'TFT18_Jinx', 'TFT18_Garen']
const SECOND_SHOP = ['TFT18_Annie', 'TFT18_Zed', 'TFT18_Sona', 'TFT18_Leona', 'TFT18_Braum']

function withSold(slot: number): string[] {
  return FIRST_SHOP.map((name, index) => (index === slot - 1 ? 'Sold' : name))
}

function leavePlanning(): void {
  state.round.hasSeenPlanningPhaseEvent = true
  state.round.isInPlanningPhase = false
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  vi.resetModules()
  vi.clearAllMocks()
  mocks.deriveState.mockReturnValue({ lockedShopSlots: [4, 5], bonusItems: { stock: { shopSlotPass: 0 } } })
  detection = await import('./shop')
  state = await import('../state')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('handleShopUpdate', () => {
  it('takes the first shop as baseline without counting a reroll', () => {
    detection.handleShopUpdate(FIRST_SHOP)

    expect(state.shop.baseline).toEqual(FIRST_SHOP)
    expect(state.shop.isVisible).toBe(true)
    expect(state.shop.rerollsUsed).toBe(0)
  })

  it('infers the planning phase from a shop update before the first phase event', () => {
    detection.handleShopUpdate(FIRST_SHOP)

    expect(state.round.isInPlanningPhase).toBe(true)
  })

  it('counts a full shop change during planning as a reroll', () => {
    detection.handleShopUpdate(FIRST_SHOP)
    detection.handleShopUpdate(SECOND_SHOP)

    expect(state.shop.rerollsUsed).toBe(1)
    expect(state.shop.baseline).toEqual(SECOND_SHOP)
    expect(mocks.validateCurrentRules).toHaveBeenCalledTimes(1)
  })

  it('ignores a change of a single slot', () => {
    detection.handleShopUpdate(FIRST_SHOP)
    detection.handleShopUpdate([...FIRST_SHOP.slice(0, 4), 'TFT18_Braum'])

    expect(state.shop.rerollsUsed).toBe(0)
  })

  it('treats one newly sold slot as a purchase, not a reroll', () => {
    detection.handleShopUpdate(FIRST_SHOP)
    detection.handleShopUpdate(withSold(2))

    expect(state.shop.rerollsUsed).toBe(0)
    expect(state.shop.baseline).toEqual(withSold(2))
    expect(mocks.invalidateRun).not.toHaveBeenCalled()
  })

  it('invalidates the run for a purchase from a locked slot', () => {
    detection.handleShopUpdate(FIRST_SHOP)
    detection.handleShopUpdate(withSold(4))

    expect(mocks.invalidateRun).toHaveBeenCalledWith('Purchased from locked shop slot 4')
  })

  it('spends a Shop Slot Pass in trust mode too', () => {
    mocks.deriveState.mockReturnValue({ lockedShopSlots: [4, 5], bonusItems: { stock: { shopSlotPass: 1 } } })
    state.slot.trustMode = true
    detection.handleShopUpdate(FIRST_SHOP)
    detection.handleShopUpdate(withSold(5))

    expect(mocks.consumeBonusItem).toHaveBeenCalledWith('shopSlotPass')
    expect(mocks.invalidateRun).not.toHaveBeenCalled()
  })

  it('spends a Shop Slot Pass instead of invalidating', () => {
    mocks.deriveState.mockReturnValue({ lockedShopSlots: [4, 5], bonusItems: { stock: { shopSlotPass: 1 } } })
    detection.handleShopUpdate(FIRST_SHOP)
    detection.handleShopUpdate(withSold(5))

    expect(mocks.consumeBonusItem).toHaveBeenCalledWith('shopSlotPass')
    expect(mocks.invalidateRun).not.toHaveBeenCalled()
  })

  it('does not let a Shop Slot Pass cover a purchase during a Shop Lock Trap', () => {
    mocks.deriveState.mockReturnValue({ lockedShopSlots: [4, 5], bonusItems: { stock: { shopSlotPass: 1 } } })
    detection.handleShopUpdate(FIRST_SHOP)
    state.bonus.activeTraps.shopLock = true
    detection.handleShopUpdate(withSold(5))

    expect(mocks.consumeBonusItem).not.toHaveBeenCalled()
    expect(mocks.invalidateRun).toHaveBeenCalledWith('Purchased from locked shop slot 5')
  })

  it('moves the baseline without a reroll while the shop is hidden', () => {
    detection.handleShopUpdate(FIRST_SHOP)
    detection.handleShopVisibleUpdate(false)
    detection.handleShopUpdate(SECOND_SHOP)

    expect(state.shop.rerollsUsed).toBe(0)
    expect(state.shop.baseline).toEqual(SECOND_SHOP)
  })

  it('consumes the automatic refresh at round start', () => {
    detection.handleShopUpdate(FIRST_SHOP)
    detection.markAwaitingAutomaticShopRefresh()
    vi.advanceTimersByTime(500)
    detection.handleShopUpdate(SECOND_SHOP)

    expect(state.shop.rerollsUsed).toBe(0)
    expect(state.shop.isAwaitingAutomaticRefresh).toBe(false)
  })

  it('counts a reroll when the automatic refresh marker is stale', () => {
    detection.handleShopUpdate(FIRST_SHOP)
    detection.markAwaitingAutomaticShopRefresh()
    vi.advanceTimersByTime(2000)
    detection.handleShopUpdate(SECOND_SHOP)

    expect(state.shop.rerollsUsed).toBe(1)
  })

  it('consumes the refresh after returning from a UI screen', () => {
    detection.handleShopUpdate(FIRST_SHOP)
    detection.markNextShopChangeAsUiReturn('augment picked')
    detection.handleShopUpdate(SECOND_SHOP)

    expect(state.shop.rerollsUsed).toBe(0)
    expect(state.shop.isAwaitingUiReturnRefresh).toBe(false)
  })

  it('does not count the refill of sold slots outside planning', () => {
    detection.handleShopUpdate(FIRST_SHOP)
    detection.handleShopUpdate(withSold(1))
    leavePlanning()
    detection.handleShopUpdate(SECOND_SHOP)
    vi.advanceTimersByTime(2000)

    expect(state.shop.rerollsUsed).toBe(0)
    expect(state.shop.baseline).toEqual(SECOND_SHOP)
  })
})

describe('shop rerolls outside planning', () => {
  beforeEach(() => {
    detection.handleShopUpdate(FIRST_SHOP)
    leavePlanning()
  })

  it('confirms the reroll after the delay', () => {
    detection.handleShopUpdate(SECOND_SHOP)

    expect(state.shop.rerollsUsed).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(state.shop.rerollsUsed).toBe(1)
  })

  it('drops the candidate when an automatic refresh signal follows', () => {
    detection.handleShopUpdate(SECOND_SHOP)
    detection.consumePendingShopRerollCandidates('gold increased')
    vi.advanceTimersByTime(1000)

    expect(state.shop.rerollsUsed).toBe(0)
  })

  it('drops the candidate when the candidates are cleared', () => {
    detection.handleShopUpdate(SECOND_SHOP)
    detection.clearPendingShopRerollCandidates('match end')
    vi.advanceTimersByTime(1000)

    expect(state.shop.rerollsUsed).toBe(0)
  })
})

describe('handleShopVisibleUpdate', () => {
  it('ignores payloads that are no boolean', () => {
    detection.handleShopVisibleUpdate('maybe')

    expect(state.shop.isVisible).toBe(false)
    expect(state.shop.isExplicitlyHidden).toBe(false)
  })

  it('records when the shop was hidden', () => {
    detection.handleShopVisibleUpdate(true)
    detection.handleShopVisibleUpdate('false')

    expect(state.shop.isVisible).toBe(false)
    expect(state.shop.hiddenAt).toBe(Date.now())
  })

  it('does not infer a visible shop after an explicit hide', () => {
    detection.handleShopVisibleUpdate(true)
    detection.handleShopVisibleUpdate(false)

    expect(detection.inferShopVisibleFromShopData('test', FIRST_SHOP)).toBe(false)
  })
})
