import { describe, expect, it } from 'vitest'
import { ITEM_IDS } from '../../data/items'
import { UNLIMITED } from '../../shared/app-state'
import { computeRuleLimits, getUnlockedMajorLocationIds, type LimitModifiers } from './limits'

const noModifiers: LimitModifiers = {
  activeTraps: { rerollLock: false, xpLock: false, augmentLock: false, shopLock: false },
  bonusRerollsThisRound: 0,
  bonusXpBuysThisRound: 0,
  bonusAugmentRerollsThisMatch: 0,
  freeAugmentPickThisSelection: false,
}

function repeat(itemId: number, count: number): number[] {
  return Array.from({ length: count }, () => itemId)
}

describe('computeRuleLimits', () => {
  it('starts from the zero state', () => {
    expect(computeRuleLimits([], noModifiers)).toEqual({
      allowedRerolls: 0,
      allowedAugmentRerolls: 0,
      allowedXpBuysPerRound: 0,
      leftAugmentUnlocked: false,
      rightAugmentUnlocked: false,
      lockedShopSlots: [4, 5],
    })
  })

  it('counts one action per progressive stack', () => {
    const limits = computeRuleLimits([
      ...repeat(ITEM_IDS.PROGRESSIVE_REROLL, 3),
      ...repeat(ITEM_IDS.PROGRESSIVE_AUGMENT_REROLL, 2),
      ITEM_IDS.PROGRESSIVE_XP_BUY,
    ], noModifiers)

    expect(limits.allowedRerolls).toBe(3)
    expect(limits.allowedAugmentRerolls).toBe(2)
    expect(limits.allowedXpBuysPerRound).toBe(1)
  })

  it('becomes unlimited at the cap', () => {
    const limits = computeRuleLimits([
      ...repeat(ITEM_IDS.PROGRESSIVE_REROLL, 10),
      ...repeat(ITEM_IDS.PROGRESSIVE_AUGMENT_REROLL, 9),
      ...repeat(ITEM_IDS.PROGRESSIVE_XP_BUY, 9),
    ], noModifiers)

    expect(limits.allowedRerolls).toBe(UNLIMITED)
    expect(limits.allowedAugmentRerolls).toBe(UNLIMITED)
    expect(limits.allowedXpBuysPerRound).toBe(9)
  })

  it('unlocks augment and shop slots individually', () => {
    const limits = computeRuleLimits([ITEM_IDS.AUGMENT_SLOT_RIGHT, ITEM_IDS.SHOP_SLOT_4_UNLOCK], noModifiers)

    expect(limits.leftAugmentUnlocked).toBe(false)
    expect(limits.rightAugmentUnlocked).toBe(true)
    expect(limits.lockedShopSlots).toEqual([5])
  })

  it('adds used one-time items to the limits', () => {
    const limits = computeRuleLimits([ITEM_IDS.PROGRESSIVE_REROLL], {
      ...noModifiers,
      bonusRerollsThisRound: 2,
      bonusXpBuysThisRound: 1,
      bonusAugmentRerollsThisMatch: 1,
    })

    expect(limits.allowedRerolls).toBe(3)
    expect(limits.allowedXpBuysPerRound).toBe(1)
    expect(limits.allowedAugmentRerolls).toBe(1)
  })

  it('lets traps override unlocks', () => {
    const received = [
      ...repeat(ITEM_IDS.PROGRESSIVE_REROLL, 10),
      ...repeat(ITEM_IDS.PROGRESSIVE_XP_BUY, 10),
      ITEM_IDS.AUGMENT_SLOT_LEFT,
      ITEM_IDS.AUGMENT_SLOT_RIGHT,
      ITEM_IDS.SHOP_SLOT_4_UNLOCK,
      ITEM_IDS.SHOP_SLOT_5_UNLOCK,
    ]
    const limits = computeRuleLimits(received, {
      ...noModifiers,
      bonusRerollsThisRound: 1,
      activeTraps: { rerollLock: true, xpLock: true, augmentLock: true, shopLock: true },
    })

    expect(limits).toEqual({
      allowedRerolls: 0,
      allowedAugmentRerolls: 0,
      allowedXpBuysPerRound: 0,
      leftAugmentUnlocked: false,
      rightAugmentUnlocked: false,
      lockedShopSlots: [4, 5],
    })
  })

  it('opens both outer augment slots for a free augment pick', () => {
    const limits = computeRuleLimits([], {
      ...noModifiers,
      freeAugmentPickThisSelection: true,
      activeTraps: { ...noModifiers.activeTraps, augmentLock: true },
    })

    expect(limits.leftAugmentUnlocked).toBe(true)
    expect(limits.rightAugmentUnlocked).toBe(true)
  })
})

describe('getUnlockedMajorLocationIds', () => {
  const majorIds = new Set([1, 2, 3, 4, 5])

  it('adds one unlock-order check per stack', () => {
    expect(getUnlockedMajorLocationIds([1, 2], [3, 4, 5], 2, majorIds)).toEqual([1, 2, 3, 4])
  })

  it('ignores duplicates, negative stacks and ids that are no majors', () => {
    expect(getUnlockedMajorLocationIds([1, 99, 1], [2], -1, majorIds)).toEqual([1])
  })
})
