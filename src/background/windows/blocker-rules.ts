// When each blocker window covers its HUD element. Pure functions of the derived app state.
import type { AppState } from '../../types/state'

// Shop blockers stay up this long after the shop hides, so briefly dragging a unit (the shop
// turns into the sell area) does not flash them away
export const SHOP_BLOCKER_HIDE_DELAY_MS = 2000

export interface BlockerContext {
  // The shop counts as shown for a moment after it hides, see SHOP_BLOCKER_HIDE_DELAY_MS
  shopBlockersShown: boolean
  // Unconfirmed vision augment rerolls already close the reroll buttons
  pendingAugmentRerolls: number
}

function isShopUiBlocker(windowName: string): boolean {
  return windowName === 'shop_slot_4_blocker'
    || windowName === 'shop_slot_5_blocker'
    || windowName === 'reroll_button_blocker'
    || windowName === 'xp_button_blocker'
}

export function isBlockerActive(windowName: string, state: AppState, context: BlockerContext): boolean {
  if (isShopUiBlocker(windowName) && !context.shopBlockersShown) return false

  // A one-time item in stock keeps the blocker open; using the action consumes it
  const { stock, activeTraps: traps } = state.bonusItems
  if (windowName.startsWith('augment_reroll_')) {
    // The confirmation delay of vision rerolls must not leave a window for an extra reroll after
    // the last allowed one (or the last bonus item)
    const used = state.currentAugmentRerollsUsed + context.pendingAugmentRerolls
    return used >= state.allowedAugmentRerolls + stock.augmentReroll && state.isAugmentPhaseActive
  }

  const noSlotPass = stock.shopSlotPass === 0 || traps.shopLock
  switch (windowName) {
    case 'shop_slot_4_blocker':        return state.lockedShopSlots.includes(4) && noSlotPass
    case 'shop_slot_5_blocker':        return state.lockedShopSlots.includes(5) && noSlotPass
    case 'reroll_button_blocker':      return state.currentShopRerollsUsed >= state.allowedRerolls && (stock.reroll === 0 || traps.rerollLock)
    case 'xp_button_blocker':          return state.currentXpBuysThisRound >= state.allowedXpBuysPerRound && (stock.xp === 0 || traps.xpLock)
    // A Free Augment Pick is used by clicking the blocker, which unlocks both outer slots for this selection
    case 'augment_slot_left_blocker':  return !state.leftAugmentUnlocked && state.isAugmentPhaseActive
    case 'augment_slot_right_blocker': return !state.rightAugmentUnlocked && state.isAugmentPhaseActive
    default:                           return false
  }
}

// Changes whenever any blocker could change its visibility
export function computeBlockerStateKey(state: AppState, context: BlockerContext): string {
  return [
    state.lockedShopSlots.join(','),
    state.allowedRerolls,
    state.currentShopRerollsUsed,
    state.allowedXpBuysPerRound,
    state.currentXpBuysThisRound,
    context.shopBlockersShown ? '1' : '0',
    state.leftAugmentUnlocked ? '1' : '0',
    state.rightAugmentUnlocked ? '1' : '0',
    state.allowedAugmentRerolls,
    state.currentAugmentRerollsUsed,
    context.pendingAugmentRerolls,
    state.isAugmentPhaseActive ? '1' : '0',
    JSON.stringify(state.bonusItems),
  ].join('|')
}
