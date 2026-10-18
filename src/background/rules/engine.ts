// The rule engine: compares the counted actions with the current limits and invalidates the run
import { deriveState } from '../app-state'
import { getCurrentStageLabel } from '../live-round'
import { augments, bonus, economy, run, shop } from '../state'
import { consumeBonusItem } from './bonus-usage'
import { saveViolationEvidence } from './violations'

export function invalidateRun(reason: string): void {
  if (!run.isValid) return

  run.isValid = false
  run.violationReason = reason
  run.violationStage = getCurrentStageLabel()
  console.warn(`RULE VIOLATION: ${reason}`)
  saveViolationEvidence()
}

export function validateCurrentRules(): void {
  // Over the limit: use a matching one-time item first, if any
  let state = deriveState()
  while (shop.rerollsUsed > state.allowedRerolls && !bonus.activeTraps.rerollLock && state.bonusItems.stock.reroll > 0) {
    bonus.rerollsThisRound += 1
    consumeBonusItem('reroll')
    state = deriveState()
  }
  while (augments.rerollsUsed > state.allowedAugmentRerolls && state.bonusItems.stock.augmentReroll > 0) {
    bonus.augmentRerollsThisMatch += 1
    consumeBonusItem('augmentReroll')
    state = deriveState()
  }
  while (economy.xpBuysThisRound > state.allowedXpBuysPerRound && !bonus.activeTraps.xpLock && state.bonusItems.stock.xp > 0) {
    bonus.xpBuysThisRound += 1
    consumeBonusItem('xp')
    state = deriveState()
  }

  if (shop.rerollsUsed > state.allowedRerolls) {
    invalidateRun(`Used ${shop.rerollsUsed} shop rerolls with ${state.allowedRerolls} allowed`)
  }

  if (augments.rerollsUsed > state.allowedAugmentRerolls) {
    invalidateRun(`Used ${augments.rerollsUsed} augment rerolls with ${state.allowedAugmentRerolls} allowed`)
  }

  if (economy.xpBuysThisRound > state.allowedXpBuysPerRound) {
    invalidateRun(`Used ${economy.xpBuysThisRound} XP buys this round with ${state.allowedXpBuysPerRound} allowed`)
  }
}
