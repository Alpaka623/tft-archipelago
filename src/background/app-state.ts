import type { Item as ArchipelagoItem } from 'archipelago.js'
import { ITEM_DEFINITIONS, ITEM_IDS } from '../data/items'
import { MAJOR_LOCATION_CHECKS } from '../data/locations'
import type { AppState, InventoryItemStack } from '../types/state'
import { countNonEmptyBoardPieces } from './board'
import {
  BONUS_ITEM_IDS,
  TRAP_ITEM_IDS,
  countReceived,
  subtractCounts,
} from './bonus-items'
import { computeRuleLimits, getUnlockedMajorLocationIds } from './rules/limits'
import { client, clientMatchTracker } from './runtime'
import {
  augments,
  bonus,
  connection,
  economy,
  majorLocationIds,
  round,
  run,
  shop,
  slot,
} from './state'

const itemNamesById = new Map<number, string>(ITEM_DEFINITIONS.map(item => [item.id, item.name]))

function countMajorCheckUnlockStacks(): number {
  return client.items.received.filter(item => item.id === ITEM_IDS.PROGRESSIVE_MAJOR_CHECK_UNLOCK).length
}

function getCurrentlyUnlockedMajorLocationIds(): number[] {
  return getUnlockedMajorLocationIds(
    slot.startingMajorLocationIds,
    slot.majorUnlockOrderLocationIds,
    countMajorCheckUnlockStacks(),
    majorLocationIds,
  )
}

export function countCompletedMajorChecks(): number {
  return slot.completedMajorLocationIds.size
}

export function isMajorLocationUnlocked(id: number): boolean {
  if (!majorLocationIds.has(id)) return true
  return getCurrentlyUnlockedMajorLocationIds().includes(id)
}

function buildInventoryStacks(items: ArchipelagoItem[]): InventoryItemStack[] {
  const stacks = new Map<number, InventoryItemStack>()

  for (const item of items) {
    const existing = stacks.get(item.id)
    if (existing) {
      existing.count += 1
    } else {
      stacks.set(item.id, {
        itemId: item.id,
        itemName: item.name || itemNamesById.get(item.id) || `Unknown Item ${item.id}`,
        count: 1,
      })
    }
  }

  return [...stacks.values()].sort((left, right) => left.itemId - right.itemId)
}

function getConnectionStatus(): AppState['connectionStatus'] {
  if (client.authenticated) return 'connected'
  if (connection.isConnecting) return 'connecting'
  return connection.error ? 'error' : 'disconnected'
}

// Snapshot of everything the windows display, derived from the received items and the match state
export function deriveState(): AppState {
  const received = client.items.received
  const receivedIds = received.map(item => item.id)
  const checkedLocationIds = client.authenticated ? client.room.checkedLocations : []
  const unlockedMajorLocationIds = getCurrentlyUnlockedMajorLocationIds()
  const unlockedMajorIdSet = new Set(unlockedMajorLocationIds)

  const limits = computeRuleLimits(receivedIds, {
    activeTraps: bonus.activeTraps,
    bonusRerollsThisRound: bonus.rerollsThisRound,
    bonusXpBuysThisRound: bonus.xpBuysThisRound,
    bonusAugmentRerollsThisMatch: bonus.augmentRerollsThisMatch,
    freeAugmentPickThisSelection: bonus.freeAugmentPickThisSelection,
  })

  return {
    connected: client.authenticated,
    connectionStatus: getConnectionStatus(),
    connectionError: connection.error,
    ...limits,
    isValidRun: run.isValid,
    lastViolationReason: run.violationReason,
    lastViolationStage: run.violationStage,
    violationOverrides: run.overrides,
    currentShopRerollsUsed: shop.rerollsUsed,
    currentAugmentRerollsUsed: augments.rerollsUsed,
    currentXpBuysThisRound: economy.xpBuysThisRound,
    isShopVisible: shop.isVisible,
    isAugmentPhaseActive: augments.isPhaseActive,
    currentRank: run.rank,
    lastBoardSnapshotPieceCount: countNonEmptyBoardPieces(round.lastBoard),
    inventory: buildInventoryStacks(received),
    checkedLocationIds,
    missingLocationIds: client.authenticated ? client.room.missingLocations : [],
    goalChecks: slot.goalChecks,
    trustMode: slot.trustMode,
    completedMajorCheckCount: countCompletedMajorChecks(),
    completedMajorLocationIds: [...slot.completedMajorLocationIds],
    startingMajorLocationIds: slot.startingMajorLocationIds,
    majorUnlockOrderLocationIds: slot.majorUnlockOrderLocationIds,
    unlockedMajorLocationIds,
    lockedMajorLocationIds: MAJOR_LOCATION_CHECKS
      .map(location => location.id)
      .filter(id => !unlockedMajorIdSet.has(id)),
    pinnedChecks: slot.pinnedChecks,
    clientMatch: clientMatchTracker?.getStatus() ?? null,
    bonusItems: {
      stock: subtractCounts(countReceived(receivedIds, BONUS_ITEM_IDS), bonus.used),
      pendingTraps: subtractCounts(countReceived(receivedIds, TRAP_ITEM_IDS), bonus.appliedTraps),
      activeTraps: { ...bonus.activeTraps },
    },
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown connection error'
}
