import { describe, expect, it } from 'vitest'
import type { AppState } from '../../types/state'
import { EMPTY_BONUS_ITEMS_STATE, emptyBonusCounts } from '../bonus-items'
import { computeBlockerStateKey, isBlockerActive, type BlockerContext } from './blocker-rules'

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    connected: true,
    connectionStatus: 'connected',
    connectionError: null,
    allowedRerolls: 0,
    allowedAugmentRerolls: 0,
    allowedXpBuysPerRound: 0,
    leftAugmentUnlocked: false,
    rightAugmentUnlocked: false,
    lockedShopSlots: [4, 5],
    isValidRun: true,
    lastViolationReason: null,
    lastViolationStage: null,
    violationOverrides: [],
    currentShopRerollsUsed: 0,
    currentAugmentRerollsUsed: 0,
    currentXpBuysThisRound: 0,
    isShopVisible: true,
    isAugmentPhaseActive: false,
    currentRank: null,
    lastBoardSnapshotPieceCount: 0,
    inventory: [],
    checkedLocationIds: [],
    missingLocationIds: [],
    goalChecks: 10,
    completedMajorCheckCount: 0,
    startingMajorLocationIds: [],
    majorUnlockOrderLocationIds: [],
    unlockedMajorLocationIds: [],
    lockedMajorLocationIds: [],
    pinnedChecks: [],
    clientMatch: null,
    bonusItems: EMPTY_BONUS_ITEMS_STATE,
    ...overrides,
  }
}

const shopShown: BlockerContext = { shopBlockersShown: true, pendingAugmentRerolls: 0 }

function withStock(stock: Partial<AppState['bonusItems']['stock']>): Pick<AppState, 'bonusItems'> {
  return { bonusItems: { ...EMPTY_BONUS_ITEMS_STATE, stock: { ...emptyBonusCounts(), ...stock } } }
}

describe('isBlockerActive', () => {
  it('covers locked shop slots and used-up buttons in the zero state', () => {
    const state = makeState()

    expect(isBlockerActive('shop_slot_4_blocker', state, shopShown)).toBe(true)
    expect(isBlockerActive('shop_slot_5_blocker', state, shopShown)).toBe(true)
    expect(isBlockerActive('reroll_button_blocker', state, shopShown)).toBe(true)
    expect(isBlockerActive('xp_button_blocker', state, shopShown)).toBe(true)
  })

  it('hides shop blockers while the shop is not shown', () => {
    const context = { ...shopShown, shopBlockersShown: false }

    expect(isBlockerActive('shop_slot_4_blocker', makeState(), context)).toBe(false)
    expect(isBlockerActive('reroll_button_blocker', makeState(), context)).toBe(false)
  })

  it('opens the reroll button while rerolls are left', () => {
    const state = makeState({ allowedRerolls: 2, currentShopRerollsUsed: 1 })
    expect(isBlockerActive('reroll_button_blocker', state, shopShown)).toBe(false)

    const usedUp = makeState({ allowedRerolls: 2, currentShopRerollsUsed: 2 })
    expect(isBlockerActive('reroll_button_blocker', usedUp, shopShown)).toBe(true)
  })

  it('keeps blockers open while a matching one-time item is in stock', () => {
    const state = makeState(withStock({ reroll: 1, xp: 1, shopSlotPass: 1 }))

    expect(isBlockerActive('reroll_button_blocker', state, shopShown)).toBe(false)
    expect(isBlockerActive('xp_button_blocker', state, shopShown)).toBe(false)
    expect(isBlockerActive('shop_slot_4_blocker', state, shopShown)).toBe(false)
  })

  it('ignores one-time items while the matching trap is active', () => {
    const state = makeState({
      bonusItems: {
        ...EMPTY_BONUS_ITEMS_STATE,
        stock: { ...emptyBonusCounts(), reroll: 1, shopSlotPass: 1 },
        activeTraps: { rerollLock: true, xpLock: false, augmentLock: false, shopLock: true },
      },
    })

    expect(isBlockerActive('reroll_button_blocker', state, shopShown)).toBe(true)
    expect(isBlockerActive('shop_slot_4_blocker', state, shopShown)).toBe(true)
  })

  it('only covers augment slots during an augment phase', () => {
    expect(isBlockerActive('augment_slot_left_blocker', makeState(), shopShown)).toBe(false)

    const phase = makeState({ isAugmentPhaseActive: true, rightAugmentUnlocked: true })
    expect(isBlockerActive('augment_slot_left_blocker', phase, shopShown)).toBe(true)
    expect(isBlockerActive('augment_slot_right_blocker', phase, shopShown)).toBe(false)
  })

  it('counts unconfirmed vision rerolls against the augment reroll limit', () => {
    const state = makeState({ isAugmentPhaseActive: true, allowedAugmentRerolls: 1 })

    expect(isBlockerActive('augment_reroll_2_blocker', state, shopShown)).toBe(false)
    expect(isBlockerActive('augment_reroll_2_blocker', state, { ...shopShown, pendingAugmentRerolls: 1 })).toBe(true)
  })
})

describe('computeBlockerStateKey', () => {
  it('changes with the values that decide blocker visibility', () => {
    const state = makeState()
    const key = computeBlockerStateKey(state, shopShown)

    expect(computeBlockerStateKey(makeState(), shopShown)).toBe(key)
    expect(computeBlockerStateKey(makeState({ currentShopRerollsUsed: 1 }), shopShown)).not.toBe(key)
    expect(computeBlockerStateKey(state, { ...shopShown, pendingAugmentRerolls: 1 })).not.toBe(key)
  })
})
