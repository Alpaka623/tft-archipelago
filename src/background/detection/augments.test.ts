import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deriveState: vi.fn(),
  validateCurrentRules: vi.fn(),
  spendFreeAugmentPickOrInvalidate: vi.fn(),
}))

vi.mock('../broadcast', () => ({ broadcastState: vi.fn() }))
vi.mock('../log', () => ({ logGep: vi.fn() }))
vi.mock('../app-state', () => ({ deriveState: mocks.deriveState }))
vi.mock('../rules/engine', () => ({ invalidateRun: vi.fn(), validateCurrentRules: mocks.validateCurrentRules }))
vi.mock('../rules/bonus-usage', () => ({
  consumeBonusItem: vi.fn(),
  spendFreeAugmentPickOrInvalidate: mocks.spendFreeAugmentPickOrInvalidate,
}))
vi.mock('../archipelago/checks', () => ({ validateImmediateMinorChecks: vi.fn() }))
vi.mock('../runtime', () => ({ platform: { kind: 'electron' } }))

type AugmentsModule = typeof import('./augments')
type StateModule = typeof import('../state')

let detection: AugmentsModule
let state: StateModule

const FIRST_CHOICES = ['TFT18_Augment_Alpha', 'TFT18_Augment_Beta', 'TFT18_Augment_Gamma']
const SECOND_CHOICES = ['TFT18_Augment_Delta', 'TFT18_Augment_Epsilon', 'TFT18_Augment_Zeta']
const NO_CHOICES = ['', '', '']

function roundInfo(type: string) {
  return { type, name: null, nativeName: null, stage: null }
}

function pick(name: string, position: number | null = null) {
  detection.handlePickedAugmentUpdate({ name, position, hasFourthSlot: false })
}

function startAugmentRound(): void {
  detection.handleRoundInfoUpdate(roundInfo('Augment_1'))
  detection.handleAugmentUpdate(FIRST_CHOICES)
}

beforeEach(async () => {
  vi.stubGlobal('window', globalThis)
  vi.resetModules()
  vi.clearAllMocks()
  mocks.deriveState.mockReturnValue({ leftAugmentUnlocked: false, rightAugmentUnlocked: false })
  detection = await import('./augments')
  state = await import('../state')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('augment phase', () => {
  it('starts with an augment round', () => {
    startAugmentRound()

    expect(state.augments.isPhaseActive).toBe(true)
    expect(state.augments.baseline).toEqual(FIRST_CHOICES)
  })

  it('ends with a round that is no augment round', () => {
    startAugmentRound()
    pick(FIRST_CHOICES[1])
    detection.handleRoundInfoUpdate(roundInfo('PVP'))

    expect(state.augments.isPhaseActive).toBe(false)
    expect(state.augments.baseline).toBeNull()
  })

  it('stays active on a non-augment round label while augment choices are visible', () => {
    startAugmentRound()
    detection.handleRoundInfoUpdate(roundInfo('PVP'))

    expect(state.augments.isPhaseActive).toBe(true)
  })

  it('is inferred from augment choices outside an augment round', () => {
    detection.handleRoundInfoUpdate(roundInfo('PVE'))
    detection.handleAugmentUpdate(FIRST_CHOICES)

    expect(state.augments.isPhaseActive).toBe(true)
  })

  it('is not started by a champion selection', async () => {
    const { championTraits } = await import('../board')
    const champions = Object.keys(championTraits).slice(0, 3)
    detection.handleRoundInfoUpdate(roundInfo('PVE'))
    detection.handleAugmentUpdate(champions)

    expect(state.augments.isPhaseActive).toBe(false)
  })
})

describe('augment rerolls', () => {
  beforeEach(startAugmentRound)

  it('counts changed choices as a reroll', () => {
    detection.handleAugmentUpdate(SECOND_CHOICES)

    expect(state.augments.rerollsUsed).toBe(1)
    expect(state.augments.baseline).toEqual(SECOND_CHOICES)
    expect(mocks.validateCurrentRules).toHaveBeenCalledTimes(1)
  })

  it('counts every reroll in the same selection', () => {
    detection.handleAugmentUpdate(SECOND_CHOICES)
    detection.handleAugmentUpdate(FIRST_CHOICES)

    expect(state.augments.rerollsUsed).toBe(2)
  })

  it('ignores the same choices arriving again', () => {
    detection.handleAugmentUpdate([...FIRST_CHOICES])

    expect(state.augments.rerollsUsed).toBe(0)
  })

  it('ignores a choice change that arrives together with the pick', () => {
    detection.handleAugmentUpdate(SECOND_CHOICES, { pickedAugmentInSameUpdate: true })

    expect(state.augments.rerollsUsed).toBe(0)
  })

  it('counts choices that reappear changed after clearing', () => {
    detection.handleAugmentUpdate(NO_CHOICES)
    expect(state.augments.didChoicesClearBeforePick).toBe(true)

    detection.handleAugmentUpdate(SECOND_CHOICES)
    expect(state.augments.rerollsUsed).toBe(1)
  })

  it('ignores choices that reappear unchanged after clearing', () => {
    detection.handleAugmentUpdate(NO_CHOICES)
    detection.handleAugmentUpdate(FIRST_CHOICES)

    expect(state.augments.rerollsUsed).toBe(0)
  })
})

describe('handlePickedAugmentUpdate', () => {
  beforeEach(startAugmentRound)

  it('allows the middle slot from the start', () => {
    pick(FIRST_CHOICES[1])

    expect(state.augments.pickedName).toBe(FIRST_CHOICES[1])
    expect(state.augments.isPhaseActive).toBe(false)
    expect(mocks.spendFreeAugmentPickOrInvalidate).not.toHaveBeenCalled()
  })

  it('flags a pick from the locked left slot', () => {
    pick(FIRST_CHOICES[0])

    expect(mocks.spendFreeAugmentPickOrInvalidate).toHaveBeenCalledWith('Picked the locked left augment slot')
  })

  it('flags a pick from the locked right slot', () => {
    pick(FIRST_CHOICES[2])

    expect(mocks.spendFreeAugmentPickOrInvalidate).toHaveBeenCalledWith('Picked the locked right augment slot')
  })

  it('allows unlocked outer slots', () => {
    mocks.deriveState.mockReturnValue({ leftAugmentUnlocked: true, rightAugmentUnlocked: true })
    pick(FIRST_CHOICES[0])

    expect(mocks.spendFreeAugmentPickOrInvalidate).not.toHaveBeenCalled()
  })

  it('falls back to the reported position for an unknown name', () => {
    pick('TFT18_Augment_Unknown', 3)

    expect(mocks.spendFreeAugmentPickOrInvalidate).toHaveBeenCalledWith('Picked the locked right augment slot')
  })

  it('handles a repeated pick update only once', () => {
    pick(FIRST_CHOICES[0])
    pick(FIRST_CHOICES[0])

    expect(mocks.spendFreeAugmentPickOrInvalidate).toHaveBeenCalledTimes(1)
  })

  it('marks the next shop change as a UI return refresh', () => {
    pick(FIRST_CHOICES[1])

    expect(state.shop.isAwaitingUiReturnRefresh).toBe(true)
  })

  it('ends an Augment Lock Trap and a Free Augment Pick', () => {
    state.bonus.activeTraps.augmentLock = true
    state.bonus.freeAugmentPickThisSelection = true
    pick(FIRST_CHOICES[1])

    expect(state.bonus.activeTraps.augmentLock).toBe(false)
    expect(state.bonus.freeAugmentPickThisSelection).toBe(false)
  })

  it('does not check slots for a pick outside an augment round', () => {
    detection.handleRoundInfoUpdate(roundInfo('PVE'))
    detection.handleAugmentUpdate(FIRST_CHOICES)
    pick(FIRST_CHOICES[0])

    expect(mocks.spendFreeAugmentPickOrInvalidate).not.toHaveBeenCalled()
    expect(state.augments.baseline).toBeNull()
  })
})

describe('handleGodPickedFavorUpdate', () => {
  it('marks the next shop change as a UI return refresh once per favor', () => {
    detection.handleGodPickedFavorUpdate('Favor_Ahri')
    expect(state.shop.isAwaitingUiReturnRefresh).toBe(true)

    state.shop.isAwaitingUiReturnRefresh = false
    detection.handleGodPickedFavorUpdate('Favor_Ahri')
    expect(state.shop.isAwaitingUiReturnRefresh).toBe(false)
  })
})
