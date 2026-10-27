// Location checks: which ones the board satisfies, and sending them to the Archipelago server
import {
  LOCATION_CHECKS,
  MINOR_LOCATION_CHECKS,
  type LocationCategory,
} from '../../data/locations'
import { countCompletedMajorChecks, isMajorLocationUnlocked } from '../app-state'
import { usageStorageKey } from '../bonus-items'
import {
  isLocationCheckSatisfied,
  isLocationCheckSatisfiedByClientResult,
  summarizeBoardTraits,
} from '../board'
import {
  getTockersTrialsVictory,
  isTockersTrialsMatch,
  readEndOfGameBoard,
  type ClientMatchResult,
  type PendingClientMatch,
} from '../client-match'
import { getLiveRound, getLiveStage } from '../live-round'
import { logGep } from '../log'
import { client, clientMatchTracker } from '../runtime'
import { economy, majorLocationIds, round, run, session, slot } from '../state'
import type { BoardSnapshot, LocationValidationContext } from '../types'
import { notifyChecksQueued, notifyChecksSent } from './notifications'

// Checks found while disconnected; sent after the next login
let pendingChecks: number[] = []
// Latest TFTEoGStats.json content: the player's board after the last round
let latestBoardStats: unknown = null
let lastLoggedBoardFileHealth: string | null = null

export function buildLocationValidationContext(
  snapshot: BoardSnapshot | null,
  overrides: Partial<LocationValidationContext> = {},
): LocationValidationContext {
  return {
    snapshot,
    gold: economy.gold,
    totalPlayerCombatWins: round.playerCombatWins,
    playerCombatWinStreak: round.playerCombatWinStreak,
    isPlayerCombat: round.isPlayerCombat,
    level: economy.level,
    stage: getLiveStage(),
    ...overrides,
  }
}

export function findSatisfiedLocationIds(
  snapshot: BoardSnapshot | null,
  category?: LocationCategory,
  contextOverrides: Partial<LocationValidationContext> = {},
): number[] {
  const context = buildLocationValidationContext(snapshot, contextOverrides)
  return LOCATION_CHECKS
    .filter(location => category === undefined || location.category === category)
    .filter(location => isLocationCheckSatisfied(location, context))
    .map(location => location.id)
}

// Minor checks count as soon as they are met; majors wait for the match end
export function validateImmediateMinorChecks(contextOverrides: Partial<LocationValidationContext> = {}): void {
  if (!run.isValid || MINOR_LOCATION_CHECKS.length === 0) return

  const fulfilledLocationIds = findSatisfiedLocationIds(round.lastBoard, 'minor', contextOverrides)
    .filter(id => !run.minorLocationIdsSent.has(id))
  logGep('GEP minor check validation', {
    fulfilledLocationIds,
    board: summarizeBoardTraits(round.lastBoard),
    context: buildLocationValidationContext(round.lastBoard, contextOverrides),
  })
  if (fulfilledLocationIds.length === 0) return

  for (const id of fulfilledLocationIds) {
    run.minorLocationIdsSent.add(id)
  }

  logGep('GEP battle_start: fulfilled immediate minor location checks', {
    fulfilledLocationIds,
  })
  sendChecks(fulfilledLocationIds)
}

// Major checks need a valid run and a Top 4 finish with the board of the last battle start
export function validateMatchEndChecks(): void {
  if (run.hasProcessedMatchEnd) return
  run.hasProcessedMatchEnd = true

  if (!run.isValid) {
    logGep('GEP match_end: run invalidated; no location checks sent', { lastViolationReason: run.violationReason })
    return
  }

  if (run.rank === null || run.rank > 4) {
    logGep('GEP match_end: Top 4 requirement not met; no location checks sent', { rank: run.rank })
    return
  }

  const fulfilledLocationIds = findSatisfiedLocationIds(round.lastBoard, 'major')
  logGep('GEP match_end: fulfilled major location checks', {
    rank: run.rank,
    fulfilledLocationIds,
  })

  if (fulfilledLocationIds.length > 0) {
    sendChecks(fulfilledLocationIds)
  }
}

export function setLatestBoardStats(stats: unknown): void {
  latestBoardStats = stats
  logBoardFileHealth()
  evaluateLiveBoard('board file')
}

// Tocker's Trials majors depend on the health in this file; logged per round for live checks
function logBoardFileHealth(): void {
  if (!clientMatchTracker) return
  const board = readEndOfGameBoard(latestBoardStats, clientMatchTracker.getPuuid())
  if (!board) return
  const key = `${board.gameId}:${board.health}`
  if (key === lastLoggedBoardFileHealth) return
  lastLoggedBoardFileHealth = key
  logGep('Board file: health', {
    gameId: board.gameId,
    queueId: board.queueId,
    health: board.health,
    logRound: session.isTftRunning ? getLiveRound() : null,
  })
}

// Live champion and trait minors from the board of the last round: board only, no bench.
// Majors wait for the match end (Top 4).
export function evaluateLiveBoard(source: string): void {
  if (latestBoardStats === null || !session.isTftRunning || !clientMatchTracker) return
  const board = readEndOfGameBoard(latestBoardStats, clientMatchTracker.getPuuid())
  const game = clientMatchTracker.getCurrentGame()
  // An older game's file (e.g. at app start) never counts for the running game
  if (!board || !game || board.gameId !== game.gameId) return
  if (!run.isValid || !game.isCounted) return

  const result: ClientMatchResult = {
    ...board,
    placement: board.placement ?? 8,
    level: null,
    lastRound: null,
  }
  const fulfilledLocationIds = MINOR_LOCATION_CHECKS
    .filter(location => isLocationCheckSatisfiedByClientResult(location, result))
    .map(location => location.id)
    .filter(id => !run.minorLocationIdsSent.has(id))
  if (fulfilledLocationIds.length === 0) return

  logGep('Live board: fulfilled minor checks', {
    source,
    units: board.units.map(unit => `${unit.championId}*${unit.starLevel}`),
    activeTraits: board.traits.filter(trait => trait.tierCurrent > 0).map(trait => `${trait.name}:${trait.numUnits}`),
    fulfilledLocationIds,
  })
  for (const id of fulfilledLocationIds) run.minorLocationIdsSent.add(id)
  sendChecks(fulfilledLocationIds)
}

// Riot client match results (Electron). Majors need Top 4, or in Tocker's Trials a victory (Riot
// always reports placement 1 there); minors (final board, level, stage) count for
// every placement. Only valid runs get here (the tracker drops invalidated sessions).
export function deliverClientMatchResult(pending: PendingClientMatch, result: ClientMatchResult): number[] {
  const tockersVictory = isTockersTrialsMatch(pending, result) ? getTockersTrialsVictory(pending, result) : null
  const isTop4 = tockersVictory ? tockersVictory.isVictory : result.placement <= 4
  const fulfilledLocationIds = LOCATION_CHECKS
    .filter(location => location.category === 'minor' || isTop4)
    .filter(location => isLocationCheckSatisfiedByClientResult(location, result))
    .map(location => location.id)
  const sendableLocationIds = fulfilledLocationIds.filter(id => isMajorLocationUnlocked(id))
  logGep('Client match: fulfilled location checks', {
    gameId: result.gameId,
    queue: pending.queueName,
    placement: result.placement,
    isTop4,
    tockersVictory,
    fulfilledLocationIds,
    sendableLocationIds,
  })
  if (fulfilledLocationIds.length > 0) sendChecks(fulfilledLocationIds)
  return sendableLocationIds
}

const COMPLETED_MAJORS_STORAGE_NAME = 'completed_majors'

function completedMajorsStorageKey(): string {
  const self = client.players.self
  return usageStorageKey(self.team, self.slot, COMPLETED_MAJORS_STORAGE_NAME)
}

// Also counts majors the server already marked through a collect: the player still completed them
function recordCompletedMajors(ids: number[]): void {
  const newIds = ids.filter(id => majorLocationIds.has(id) && !slot.completedMajorLocationIds.has(id))
  if (newIds.length === 0) return
  for (const id of newIds) slot.completedMajorLocationIds.add(id)
  logGep('Completed majors recorded', { newIds, completedMajorCheckCount: countCompletedMajorChecks() })
  try {
    void client.storage.prepare(completedMajorsStorageKey(), [] as number[]).add(newIds).commit()
  } catch (error) {
    console.warn('Failed to store completed majors:', error)
  }
}

// After login. Slots from before this list existed start from the server's checked majors once.
export async function loadCompletedMajors(): Promise<void> {
  const key = completedMajorsStorageKey()
  const stored = (await client.storage.fetch<Record<string, number[] | null>>([key]))[key]
  if (Array.isArray(stored)) {
    slot.completedMajorLocationIds = new Set(stored.filter(id => majorLocationIds.has(id)))
    logGep('Completed majors loaded', { completedMajorCheckCount: countCompletedMajorChecks() })
    return
  }
  // Always written, even empty: a missing key on a later login would take collected majors as completed
  const seedIds = [...new Set(client.room.checkedLocations.filter(id => majorLocationIds.has(id)))]
  slot.completedMajorLocationIds = new Set(seedIds)
  logGep('Completed majors started from checked locations', { seedIds })
  await client.storage.prepare(key, [] as number[]).add(seedIds).commit(true)
}

export function maybeReportGoal(): void {
  if (!client.authenticated || slot.hasReportedGoal) return

  const completedMajorCheckCount = countCompletedMajorChecks()
  if (completedMajorCheckCount < slot.goalChecks) return

  slot.hasReportedGoal = true
  client.goal()
  logGep('Archipelago goal reported', {
    completedMajorCheckCount,
    goalChecks: slot.goalChecks,
  })
}

export function sendChecks(ids: number[]): void {
  const requestedIds = [...new Set(ids)]
  const skippedLockedMajorIds = requestedIds
    .filter(id => majorLocationIds.has(id) && !isMajorLocationUnlocked(id))
  const sendableIds = requestedIds
    .filter(id => !skippedLockedMajorIds.includes(id))

  logGep('AP check send requested', {
    requestedIds,
    skippedLockedMajorIds,
    sendableIds,
    connected: client.authenticated,
  })

  if (sendableIds.length === 0) return

  if (client.authenticated) {
    recordCompletedMajors(sendableIds)
    const missingIds = sendableIds.filter(id => client.room.missingLocations.includes(id))
    if (missingIds.length === 0) {
      logGep('AP check send skipped: no missing locations', { ids: sendableIds })
      maybeReportGoal()
      return
    }

    client.check(...missingIds)
    logGep('AP check sent', { ids: missingIds })
    notifyChecksSent(missingIds)
    maybeReportGoal()
  } else {
    const alreadyPending = new Set(pendingChecks)
    const queuedIds = sendableIds.filter(id => !alreadyPending.has(id))
    pendingChecks.push(...queuedIds)
    logGep('AP check queued while disconnected', { ids: queuedIds })
    notifyChecksQueued(queuedIds)
  }
}

export function flushPendingChecks(): void {
  if (pendingChecks.length === 0 || !client.authenticated) return

  const queuedIds = [...new Set(pendingChecks)]
  recordCompletedMajors(queuedIds)
  const missingIds = queuedIds.filter(id => client.room.missingLocations.includes(id))
  pendingChecks = []

  if (missingIds.length === 0) {
    logGep('AP pending checks skipped after reconnect: no missing locations', { ids: queuedIds })
    return
  }

  client.check(...missingIds)
  logGep('AP pending checks sent after reconnect', { ids: missingIds })
  notifyChecksSent(missingIds)
}
