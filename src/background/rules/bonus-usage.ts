// One-time bonus items and traps. Usage is counted in the Archipelago data storage, so it survives
// restarts and reinstalls.
import type { AppState } from '../../types/state'
import { deriveState } from '../app-state'
import {
  BONUS_KINDS,
  TRAP_KINDS,
  usageStorageKey,
  type BonusCounts,
  type BonusKind,
  type TrapCounts,
  type TrapKind,
} from '../bonus-items'
import { broadcastState } from '../broadcast'
import { logGep } from '../log'
import { client } from '../runtime'
import { bonus, session } from '../state'
import { invalidateRun } from './engine'

export function consumeBonusItem(kind: BonusKind): void {
  bonus.used[kind] += 1
  logGep('Bonus item used', { kind, used: bonus.used[kind] })
  persistUsage(`used_${kind}`)
}

function applyTrap(kind: TrapKind): void {
  bonus.appliedTraps[kind] += 1
  bonus.activeTraps[kind] = true
  logGep('Trap applied', { kind, applied: bonus.appliedTraps[kind] })
  persistUsage(`trap_${kind}`)
}

// Atomic +1 in the Archipelago data storage, queued while disconnected
function persistUsage(name: string): void {
  if (!client.authenticated) {
    bonus.pendingUsageIncrements.push(name)
    return
  }
  try {
    const self = client.players.self
    void client.storage.prepare(usageStorageKey(self.team, self.slot, name), 0).add(1).commit()
  } catch (error) {
    console.warn('Failed to store bonus item usage:', error)
    bonus.pendingUsageIncrements.push(name)
  }
}

// After login: server counts plus anything used while disconnected
export async function loadBonusUsage(): Promise<void> {
  const self = client.players.self
  const names = [...BONUS_KINDS.map(kind => `used_${kind}`), ...TRAP_KINDS.map(kind => `trap_${kind}`)]
  const keys = names.map(name => usageStorageKey(self.team, self.slot, name))
  const stored = await client.storage.fetch<Record<string, number>>(keys)
  const pending = bonus.pendingUsageIncrements
  bonus.pendingUsageIncrements = []
  const countFor = (name: string) => (Number(stored[usageStorageKey(self.team, self.slot, name)]) || 0)
    + pending.filter(entry => entry === name).length
  bonus.used = Object.fromEntries(BONUS_KINDS.map(kind => [kind, countFor(`used_${kind}`)])) as BonusCounts
  bonus.appliedTraps = Object.fromEntries(TRAP_KINDS.map(kind => [kind, countFor(`trap_${kind}`)])) as TrapCounts
  for (const name of pending) persistUsage(name)
  logGep('Bonus item usage loaded', { usedBonusItems: bonus.used, appliedTraps: bonus.appliedTraps })
  broadcastState()
}

// Round start: traps received since the last round take effect now
export function applyPendingTraps(): void {
  bonus.activeTraps.rerollLock = false
  bonus.activeTraps.xpLock = false
  bonus.activeTraps.shopLock = false
  if (!session.isTftRunning) return
  const { pendingTraps } = deriveState().bonusItems
  for (const kind of ['rerollLock', 'xpLock', 'shopLock'] as const) {
    if (pendingTraps[kind] > 0) applyTrap(kind)
  }
  // Augment lock waits for the next augment selection, which ends it
  if (pendingTraps.augmentLock > 0 && !bonus.activeTraps.augmentLock) applyTrap('augmentLock')
}

export function spendFreeAugmentPickOrInvalidate(reason: string): void {
  if (!bonus.activeTraps.augmentLock && deriveState().bonusItems.stock.augmentPick > 0) {
    consumeBonusItem('augmentPick')
    return
  }
  invalidateRun(reason)
}

// Free Augment Picks the augment slot blockers offer right now (Electron cannot tell which card was picked)
export function getUsableFreeAugmentPicks(state: AppState): number {
  if (!state.isAugmentPhaseActive || bonus.activeTraps.augmentLock || bonus.freeAugmentPickThisSelection) return 0
  if (state.leftAugmentUnlocked && state.rightAugmentUnlocked) return 0
  return state.bonusItems.stock.augmentPick
}

export function spendFreeAugmentPickFromBlocker(): void {
  if (getUsableFreeAugmentPicks(deriveState()) === 0) return
  bonus.freeAugmentPickThisSelection = true
  consumeBonusItem('augmentPick')
  broadcastState()
}
