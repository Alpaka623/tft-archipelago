import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rerollStock: 1,
  consumeBonusItem: vi.fn(),
  saveViolationEvidence: vi.fn(),
}))

// One Bonus Reroll in stock until it is spent; a spent one raises the allowed rerolls
vi.mock('../app-state', () => ({
  deriveState: () => ({
    allowedRerolls: 1 - mocks.rerollStock,
    allowedAugmentRerolls: 0,
    allowedXpBuysPerRound: 0,
    bonusItems: { stock: { reroll: mocks.rerollStock, augmentReroll: 0, xp: 0 } },
  }),
}))
vi.mock('../live-round', () => ({ getCurrentStageLabel: () => '2-1' }))
vi.mock('./bonus-usage', () => ({ consumeBonusItem: mocks.consumeBonusItem }))
vi.mock('./violations', () => ({ saveViolationEvidence: mocks.saveViolationEvidence }))

type EngineModule = typeof import('./engine')
type StateModule = typeof import('../state')

let engine: EngineModule
let state: StateModule

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.rerollStock = 1
  mocks.consumeBonusItem.mockImplementation(() => { mocks.rerollStock -= 1 })
  engine = await import('./engine')
  state = await import('../state')
})

describe('validateCurrentRules', () => {
  it('invalidates the run for an XP buy over the limit', () => {
    state.economy.xpBuysThisRound = 1
    engine.validateCurrentRules()

    expect(state.run.isValid).toBe(false)
    expect(mocks.saveViolationEvidence).toHaveBeenCalledTimes(1)
  })

  it('invalidates nothing in trust mode but still spends one-time items', () => {
    state.slot.trustMode = true
    state.economy.xpBuysThisRound = 1
    state.shop.rerollsUsed = 2
    engine.validateCurrentRules()
    engine.invalidateRun('Purchased from locked shop slot 4')

    expect(state.run.isValid).toBe(true)
    expect(mocks.consumeBonusItem).toHaveBeenCalledTimes(1)
    expect(mocks.consumeBonusItem).toHaveBeenCalledWith('reroll')
    expect(mocks.saveViolationEvidence).not.toHaveBeenCalled()
  })
})
