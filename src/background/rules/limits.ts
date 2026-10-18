import { ITEM_IDS } from '../../data/items'
import { UNLIMITED } from '../../shared/app-state'
import type { TrapKind } from '../bonus-items'

const SHOP_REROLL_CAP = 10
const AUGMENT_REROLL_CAP = 9
const XP_BUY_CAP = 10

export interface RuleLimits {
  allowedRerolls: number
  allowedAugmentRerolls: number
  allowedXpBuysPerRound: number
  leftAugmentUnlocked: boolean
  rightAugmentUnlocked: boolean
  lockedShopSlots: number[]
}

export interface LimitModifiers {
  activeTraps: Record<TrapKind, boolean>
  // One-time items already used raise this round's (augment rerolls: this match's) limit
  bonusRerollsThisRound: number
  bonusXpBuysThisRound: number
  bonusAugmentRerollsThisMatch: number
  freeAugmentPickThisSelection: boolean
}

function countStacks(receivedItemIds: number[], itemId: number): number {
  return receivedItemIds.filter(id => id === itemId).length
}

function capped(stacks: number, cap: number): number {
  return stacks >= cap ? UNLIMITED : stacks
}

// What the player may do right now, from the received Archipelago items. Traps set a limit to 0.
export function computeRuleLimits(receivedItemIds: number[], modifiers: LimitModifiers): RuleLimits {
  const { activeTraps } = modifiers
  const has = (itemId: number) => receivedItemIds.includes(itemId)

  const rerollStacks = countStacks(receivedItemIds, ITEM_IDS.PROGRESSIVE_REROLL)
  const augmentRerollStacks = countStacks(receivedItemIds, ITEM_IDS.PROGRESSIVE_AUGMENT_REROLL)
  const xpBuyStacks = countStacks(receivedItemIds, ITEM_IDS.PROGRESSIVE_XP_BUY)

  const lockedShopSlots = activeTraps.shopLock
    ? [4, 5]
    : [
      ...(has(ITEM_IDS.SHOP_SLOT_4_UNLOCK) ? [] : [4]),
      ...(has(ITEM_IDS.SHOP_SLOT_5_UNLOCK) ? [] : [5]),
    ]

  return {
    allowedRerolls: activeTraps.rerollLock
      ? 0
      : capped(rerollStacks, SHOP_REROLL_CAP) + modifiers.bonusRerollsThisRound,
    allowedAugmentRerolls: capped(augmentRerollStacks, AUGMENT_REROLL_CAP) + modifiers.bonusAugmentRerollsThisMatch,
    allowedXpBuysPerRound: activeTraps.xpLock
      ? 0
      : capped(xpBuyStacks, XP_BUY_CAP) + modifiers.bonusXpBuysThisRound,
    leftAugmentUnlocked: modifiers.freeAugmentPickThisSelection
      || (!activeTraps.augmentLock && has(ITEM_IDS.AUGMENT_SLOT_LEFT)),
    rightAugmentUnlocked: modifiers.freeAugmentPickThisSelection
      || (!activeTraps.augmentLock && has(ITEM_IDS.AUGMENT_SLOT_RIGHT)),
    lockedShopSlots,
  }
}

// Major checks the player may currently complete: the starting set plus one per unlock item
export function getUnlockedMajorLocationIds(
  startingIds: number[],
  unlockOrderIds: number[],
  unlockStacks: number,
  majorIds: Set<number>,
): number[] {
  const unlocked = [...startingIds, ...unlockOrderIds.slice(0, Math.max(0, unlockStacks))]
  return [...new Set(unlocked)].filter(id => majorIds.has(id))
}
