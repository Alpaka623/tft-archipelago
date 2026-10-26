// App state helpers shared by the background controller and the windows
import { EMPTY_BONUS_ITEMS_STATE } from '../background/bonus-items'
import type { AppState } from '../types/state'

// Limits at or above this value are unlimited (a progressive item reached its cap)
export const UNLIMITED = 9999

export function formatLimit(limit: number): string {
  return limit >= UNLIMITED ? 'Unlimited' : String(limit)
}

// Shown until the background controller sends the first state update
export const DEFAULT_APP_STATE: AppState = {
  connected: false,
  connectionStatus: 'disconnected',
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
  isShopVisible: false,
  isAugmentPhaseActive: false,
  currentRank: null,
  lastBoardSnapshotPieceCount: 0,
  inventory: [],
  checkedLocationIds: [],
  missingLocationIds: [],
  goalChecks: 10,
  trustMode: false,
  completedMajorCheckCount: 0,
  startingMajorLocationIds: [],
  majorUnlockOrderLocationIds: [],
  unlockedMajorLocationIds: [],
  lockedMajorLocationIds: [],
  pinnedChecks: [],
  clientMatch: null,
  bonusItems: EMPTY_BONUS_ITEMS_STATE,
}
