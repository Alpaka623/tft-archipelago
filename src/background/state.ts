// Mutable state of the background controller, grouped by concern. State that only one module
// needs stays private to that module; everything here is shared between modules.
import { LOCATION_CHECKS, MAJOR_LOCATION_CHECKS, type LocationCheck } from '../data/locations'
import type { PinnedCheck, ViolationOverride } from '../types/state'
import type { VisionHudAlignment } from '../types/vision'
import {
  emptyBonusCounts,
  emptyTrapCounts,
  type TrapKind,
} from './bonus-items'
import type {
  AugmentSnapshot,
  BoardSnapshot,
  PlayerCombatOutcome,
  RoundInfoSnapshot,
  ShopSnapshot,
  XpSnapshot,
} from './types'

export interface BlockerRect {
  x: number
  y: number
  w: number
  h: number
}

export type BlockerProfiles = Record<string, Record<string, BlockerRect>>

export const DEFAULT_GOAL_CHECKS = 10
const DEFAULT_STARTING_MAJOR_CHECK_COUNT = 11

export const locationChecksById = new Map<number, LocationCheck>(LOCATION_CHECKS.map(location => [location.id, location]))
export const majorLocationIds = new Set(MAJOR_LOCATION_CHECKS.map(location => location.id))
export const defaultStartingMajorLocationIds = MAJOR_LOCATION_CHECKS
  .slice(0, DEFAULT_STARTING_MAJOR_CHECK_COUNT)
  .map(location => location.id)
export const defaultMajorUnlockOrderLocationIds = MAJOR_LOCATION_CHECKS
  .slice(DEFAULT_STARTING_MAJOR_CHECK_COUNT)
  .map(location => location.id)

export const connection = {
  isConnecting: false,
  error: null as string | null,
}

// Settings that come from the slot data, plus the player's pinned checks
export const slot = {
  goalChecks: DEFAULT_GOAL_CHECKS,
  hasReportedGoal: false,
  startingMajorLocationIds: [...defaultStartingMajorLocationIds],
  majorUnlockOrderLocationIds: [...defaultMajorUnlockOrderLocationIds],
  pinnedChecks: [] as PinnedCheck[],
  // Honor system (YAML option): restrictions are not validated and never invalidate the run
  trustMode: false,
}

// The running TFT process and the local player
export const session = {
  isTftRunning: false,
  startedAt: 0,
  gameWidth: 0,
  gameHeight: 0,
  localPlayerName: null as string | null,
  localPlayerTagLine: null as string | null,
}

// Validity and results of the current match
export const run = {
  isValid: true,
  violationReason: null as string | null,
  violationStage: null as string | null,
  // Evidence folder of the current violation, relative to Documents
  evidenceFolder: null as string | null,
  overrides: [] as ViolationOverride[],
  rank: null as number | null,
  hasProcessedMatchEnd: false,
  minorLocationIdsSent: new Set<number>(),
}

export const round = {
  isInPlanningPhase: false,
  hasSeenPlanningPhaseEvent: false,
  type: null as string | null,
  info: null as RoundInfoSnapshot | null,
  isPlayerCombat: false,
  playerCombatOutcome: null as PlayerCombatOutcome | null,
  isAwaitingPlayerCombatOutcome: false,
  playerCombatWins: 0,
  playerCombatWinStreak: 0,
  latestBoard: null as BoardSnapshot | null,
  // Board at the last battle start; checks are validated against it
  lastBoard: null as BoardSnapshot | null,
  pickedGodFavor: null as string | null,
}

export const shop = {
  latest: null as ShopSnapshot | null,
  baseline: null as ShopSnapshot | null,
  rerollsUsed: 0,
  isAwaitingAutomaticRefresh: false,
  automaticRefreshMarkedAt: null as number | null,
  isAwaitingUiReturnRefresh: false,
  isVisible: false,
  hiddenAt: null as number | null,
  isExplicitlyHidden: false,
}

export const augments = {
  latest: null as AugmentSnapshot | null,
  baseline: null as AugmentSnapshot | null,
  rerollsUsed: 0,
  pickedName: null as string | null,
  isPhaseActive: false,
  didChoicesClearBeforePick: false,
}

export const economy = {
  gold: null as number | null,
  xp: null as XpSnapshot | null,
  // Highest HUD level read this match (Electron vision)
  level: null as number | null,
  xpBuysThisRound: 0,
}

// One-time items and traps
export const bonus = {
  used: emptyBonusCounts(),
  appliedTraps: emptyTrapCounts(),
  // Usage made while disconnected, committed to the data storage on the next login
  pendingUsageIncrements: [] as string[],
  rerollsThisRound: 0,
  xpBuysThisRound: 0,
  augmentRerollsThisMatch: 0,
  // A Free Augment Pick opened the locked outer slots for the current augment selection
  freeAugmentPickThisSelection: false,
  activeTraps: { rerollLock: false, xpLock: false, augmentLock: false, shopLock: false } as Record<TrapKind, boolean>,
}

export const windows = {
  // Windows that announced themselves and receive state updates
  connected: new Set<string>(),
  overlayId: null as string | null,
}

export const blockers = {
  isCalibrationMode: false,
  profiles: null as BlockerProfiles | null,
  // Blocker rects from the vision HUD alignment (Electron); used when no calibrated rect exists
  visionAlignment: null as VisionHudAlignment | null,
}
