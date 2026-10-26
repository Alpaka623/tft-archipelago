import type { LocationCategory } from '../data/locations'
import type { BonusItemsState } from '../background/bonus-items'
import type { ClientMatchStatus } from '../background/client-match'
import type { DebugGameEvent } from './debug'
import type { VisionGameState, VisionHudAlignment } from './vision'

export interface PinnedCheck {
  id: number
  name: string
  category: LocationCategory
}

export interface ReceivedItemNotification {
  itemId: number
  itemName: string
  playerName: string
}

export interface GlobalItemSentNotification {
  itemId: number
  itemName: string
  senderName: string
  receiverName: string
  locationId: number
  locationName: string
}

export interface HintNotification {
  itemId: number
  itemName: string
  senderName: string
  receiverName: string
  locationId: number
  locationName: string
  found: boolean
}

export interface CheckNotificationEntry {
  locationId: number
  locationName: string
  locationCategory: LocationCategory
  itemName: string | null
  playerName: string | null
}

export interface CheckNotification {
  status: 'sent' | 'queued'
  checks: CheckNotificationEntry[]
  rewardDetailsUnavailable: boolean
}

// A rule violation the player marked as a false positive
export interface ViolationOverride {
  reason: string
  stage: string | null
  overriddenAt: number
}

export interface InventoryItemStack {
  itemId: number
  itemName: string
  count: number
}

export interface AppState {
  connected: boolean
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  connectionError: string | null
  allowedRerolls: number        // 9999 = unlimited
  allowedAugmentRerolls: number // 9999 = unlimited
  allowedXpBuysPerRound: number // 9999 = unlimited
  leftAugmentUnlocked: boolean
  rightAugmentUnlocked: boolean
  lockedShopSlots: number[]    // subset of [4, 5]
  isValidRun: boolean
  lastViolationReason: string | null
  // Stage label (e.g. "2-4") when the violation was detected; null if unknown
  lastViolationStage: string | null
  // Overrides used this match; each one was announced in the multiworld chat
  violationOverrides: ViolationOverride[]
  currentShopRerollsUsed: number
  currentAugmentRerollsUsed: number
  currentXpBuysThisRound: number
  isShopVisible: boolean
  isAugmentPhaseActive: boolean
  currentRank: number | null
  lastBoardSnapshotPieceCount: number
  inventory: InventoryItemStack[]
  checkedLocationIds: number[]
  missingLocationIds: number[]
  goalChecks: number
  // Honor system from the slot data: restrictions are not validated
  trustMode: boolean
  completedMajorCheckCount: number
  startingMajorLocationIds: number[]
  majorUnlockOrderLocationIds: number[]
  unlockedMajorLocationIds: number[]
  lockedMajorLocationIds: number[]
  pinnedChecks: PinnedCheck[]
  // Electron only: Riot client connection and match results; null on Overwolf
  clientMatch: ClientMatchStatus | null
  // One-time items in stock and active traps
  bonusItems: BonusItemsState
}

// Messages sent from overlay/desktop → background
export type BackgroundMessage =
  | { id: 'WINDOW_MOUNTED'; content: { windowId: string } }
  | { id: 'CONNECT';        content: { hostname: string; port: number; slotName: string; password: string } }
  | { id: 'SEND_CHECKS';   content: { ids: number[] } }
  | { id: 'SET_PINNED_CHECKS'; content: { checks: PinnedCheck[] } }
  | { id: 'SET_BLOCKER_CALIBRATION_MODE'; content: { enabled: boolean } }
  | { id: 'BLOCKER_MOVED'; content: { blockerId: string; x: number; y: number; w: number; h: number } }
  | { id: 'SAVE_BLOCKER_CONFIG'; content: Record<string, never> }
  | { id: 'RESET_BLOCKER_CONFIG'; content: Record<string, never> }
  | { id: 'GOAL';           content: Record<string, never> }
  | { id: 'OVERRIDE_VIOLATION'; content: Record<string, never> }
  | { id: 'DEBUG_GAME_EVENT'; content: DebugGameEvent }
  | { id: 'VISION_GAME_STATE'; content: VisionGameState }
  | { id: 'VISION_HUD_ALIGNMENT'; content: VisionHudAlignment }
  | { id: 'VISION_LAYOUT_CHANGED'; content: Record<string, never> }
  | { id: 'USE_FREE_AUGMENT_PICK'; content: Record<string, never> }

// Messages sent from background → overlay/desktop
export type WindowMessage =
  | { id: 'STATE_UPDATE'; content: AppState }
  | { id: 'BLOCKER_CALIBRATION_MODE_UPDATE'; content: { enabled: boolean } }
  | { id: 'BLOCKER_OFFER_UPDATE'; content: { freeAugmentPicks: number } }
  | { id: 'BLOCKER_CONFIG_SAVE_RESULT'; content: { success: boolean; isReset: boolean } }
  | { id: 'AP_ITEM_RECEIVED'; content: ReceivedItemNotification }
  | { id: 'AP_GLOBAL_ITEM_SENT'; content: GlobalItemSentNotification }
  | { id: 'AP_HINT_RECEIVED'; content: HintNotification }
  | { id: 'AP_CHECK_NOTIFICATION'; content: CheckNotification }
  | { id: 'VIOLATION_OVERRIDE_RESULT'; content: { success: boolean; message: string } }
