import { ITEM_IDS } from '../data/items'

// One-time items and traps. The APWorld fills free locations with them.
//
// One-time items: each allows one action beyond the current limit and is then used up. The app
// consumes one automatically instead of invalidating the run, and keeps the matching blocker open
// while one is in stock. Traps add a short extra restriction from the next round (or augment).
// Used and applied counts live in the Archipelago data storage, so they survive app restarts.

export const BONUS_KINDS = ['reroll', 'xp', 'augmentReroll', 'augmentPick', 'shopSlotPass'] as const
export type BonusKind = typeof BONUS_KINDS[number]

export const TRAP_KINDS = ['rerollLock', 'xpLock', 'augmentLock', 'shopLock'] as const
export type TrapKind = typeof TRAP_KINDS[number]

export const BONUS_ITEM_IDS: Record<BonusKind, number> = {
  reroll: ITEM_IDS.BONUS_REROLL,
  xp: ITEM_IDS.BONUS_XP_BUY,
  augmentReroll: ITEM_IDS.BONUS_AUGMENT_REROLL,
  augmentPick: ITEM_IDS.FREE_AUGMENT_PICK,
  shopSlotPass: ITEM_IDS.SHOP_SLOT_PASS,
}

export const TRAP_ITEM_IDS: Record<TrapKind, number> = {
  rerollLock: ITEM_IDS.REROLL_LOCK_TRAP,
  xpLock: ITEM_IDS.XP_LOCK_TRAP,
  augmentLock: ITEM_IDS.AUGMENT_LOCK_TRAP,
  shopLock: ITEM_IDS.SHOP_LOCK_TRAP,
}

export type BonusCounts = Record<BonusKind, number>
export type TrapCounts = Record<TrapKind, number>

export interface BonusItemsState {
  // Received minus used
  stock: BonusCounts
  // Received minus applied; applied at the next round start (augment lock: next augment selection)
  pendingTraps: TrapCounts
  // Restrictions in effect right now
  activeTraps: Record<TrapKind, boolean>
}

export function emptyBonusCounts(): BonusCounts {
  return { reroll: 0, xp: 0, augmentReroll: 0, augmentPick: 0, shopSlotPass: 0 }
}

export function emptyTrapCounts(): TrapCounts {
  return { rerollLock: 0, xpLock: 0, augmentLock: 0, shopLock: 0 }
}

export const EMPTY_BONUS_ITEMS_STATE: BonusItemsState = {
  stock: emptyBonusCounts(),
  pendingTraps: emptyTrapCounts(),
  activeTraps: { rerollLock: false, xpLock: false, augmentLock: false, shopLock: false },
}

export function countReceived<K extends string>(receivedItemIds: number[], ids: Record<K, number>): Record<K, number> {
  const counts = Object.fromEntries(Object.keys(ids).map(kind => [kind, 0])) as Record<K, number>
  for (const id of receivedItemIds) {
    const kind = (Object.keys(ids) as K[]).find(candidate => ids[candidate] === id)
    if (kind) counts[kind] += 1
  }
  return counts
}

// Stock never goes negative, even if the data storage holds more uses than items (e.g. a reset seed)
export function subtractCounts<K extends string>(received: Record<K, number>, used: Record<K, number>): Record<K, number> {
  return Object.fromEntries(
    Object.entries(received).map(([kind, count]) => [kind, Math.max(0, (count as number) - (used[kind as K] ?? 0))]),
  ) as Record<K, number>
}

// Data storage key per slot, e.g. "tft_archipelago_0_1_used_reroll"
export function usageStorageKey(team: number, slot: number, name: string): string {
  return `tft_archipelago_${team}_${slot}_${name}`
}
