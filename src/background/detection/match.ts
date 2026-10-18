// Match lifecycle: match and round boundaries, player combat outcomes and the match end
/// <reference types="@overwolf/types" />
import {
  findSatisfiedLocationIds,
  validateImmediateMinorChecks,
  validateMatchEndChecks,
} from '../archipelago/checks'
import { countNonEmptyBoardPieces, summarizeBoardTraits } from '../board'
import { TRAP_KINDS } from '../bonus-items'
import { broadcastState } from '../broadcast'
import { readInfoValueFromRecord } from '../gep-parsing'
import { logGep } from '../log'
import { readNumberFromRaw } from '../raw'
import { applyPendingTraps } from '../rules/bonus-usage'
import { platform } from '../runtime'
import { resetGepDebugLogBudget } from '../sources/gep'
import { resetVisionSourceState } from '../sources/vision'
import { augments, bonus, economy, round, run, session, shop } from '../state'
import type { LocalPlayerIdentity, PlayerCombatOutcome, RoundInfoSnapshot } from '../types'
import { clearAugmentPhase } from './augments'
import {
  areSnapshotsEqual,
  clearAutomaticShopRefreshMarker,
  clearPendingShopRerollCandidates,
  consumePendingShopRerollCandidates,
  inferShopVisibleFromShopData,
  markAwaitingAutomaticShopRefresh,
  setShopHiddenAt,
} from './shop'
import { clearPendingXpSignals, resetXpDetection } from './xp'

// Debug switches for testing without real player combat or placements
const DEBUG_VALIDATE_LOCATIONS_ON_BATTLE_START = false
const DEBUG_TREAT_PVE_AS_PLAYER_COMBAT = true
const DEBUG_TREAT_SESSION_END_AS_TOP4 = true

export interface MatchEndOptions {
  reason?: string
  resetAfterValidation?: boolean
  useDebugSessionEndRankFallback?: boolean
}

export function updateLocalPlayerIdentity(identity: Partial<LocalPlayerIdentity>): void {
  if (identity.name !== undefined && identity.name !== null) session.localPlayerName = identity.name
  if (identity.tagLine !== undefined && identity.tagLine !== null) session.localPlayerTagLine = identity.tagLine
}

function resetPerRoundCounters(): void {
  bonus.rerollsThisRound = 0
  bonus.xpBuysThisRound = 0
  shop.rerollsUsed = 0
  economy.xpBuysThisRound = 0
  resetXpDetection('round reset')
}

export function resetMatchDetectionState(): void {
  economy.level = null
  bonus.augmentRerollsThisMatch = 0
  bonus.freeAugmentPickThisSelection = false
  for (const kind of TRAP_KINDS) bonus.activeTraps[kind] = false

  round.isInPlanningPhase = false
  round.hasSeenPlanningPhaseEvent = false

  shop.latest = null
  shop.baseline = null
  shop.rerollsUsed = 0
  clearPendingShopRerollCandidates('match reset')
  clearAutomaticShopRefreshMarker()
  shop.isVisible = false
  setShopHiddenAt(null)
  shop.isExplicitlyHidden = false

  augments.latest = null
  augments.baseline = null
  augments.rerollsUsed = 0
  augments.pickedName = null
  augments.isPhaseActive = false
  augments.didChoicesClearBeforePick = false
  shop.isAwaitingUiReturnRefresh = false

  economy.gold = null
  economy.xp = null
  resetXpDetection('match reset')
  economy.xpBuysThisRound = 0

  run.isValid = true
  run.violationReason = null
  run.violationStage = null
  run.evidenceFolder = null
  run.overrides = []
  run.rank = null
  run.hasProcessedMatchEnd = false
  run.minorLocationIdsSent = new Set()

  round.type = null
  round.info = null
  round.isPlayerCombat = false
  round.playerCombatOutcome = null
  round.isAwaitingPlayerCombatOutcome = false
  round.playerCombatWins = 0
  round.playerCombatWinStreak = 0
  round.latestBoard = null
  round.lastBoard = null
  round.pickedGodFavor = null

  resetGepDebugLogBudget()
  resetVisionSourceState()
}

export function handleRoundStart(): void {
  if (run.hasProcessedMatchEnd) {
    resetMatchDetectionState()
    logGep('GEP round_start: match state reset after previous match_end')
  }

  consumePendingShopRerollCandidates('round_start')
  round.isInPlanningPhase = true
  shop.isExplicitlyHidden = false
  round.hasSeenPlanningPhaseEvent = true
  shop.isAwaitingUiReturnRefresh = false
  round.pickedGodFavor = null
  resetPerRoundCounters()
  applyPendingTraps()

  if (!shop.latest) {
    shop.baseline = null
    markAwaitingAutomaticShopRefresh()
    console.log('GEP round_start: planning phase started; waiting for shop_pieces baseline')
    broadcastState()
    return
  }

  inferShopVisibleFromShopData('round_start with current shop snapshot', shop.latest)

  const autoRefreshed = shop.baseline !== null && !areSnapshotsEqual(shop.latest, shop.baseline)
  shop.baseline = [...shop.latest]
  if (autoRefreshed) {
    clearAutomaticShopRefreshMarker()
  } else {
    markAwaitingAutomaticShopRefresh()
  }

  logGep(
    autoRefreshed
      ? 'GEP round_start: shop auto-refresh detected; baseline updated'
      : 'GEP round_start: shop unchanged or locked; baseline updated',
  )
  broadcastState()
}

export function handleRoundEnd(): void {
  consumePendingShopRerollCandidates('round_end')
  markAwaitingAutomaticShopRefresh()
  logGep('GEP round_end: next full shop change will be treated as automatic refresh')
}

function normalizeRoundInfoValue(value: string | null): string {
  return value?.trim().toUpperCase() ?? ''
}

function isPlayerCombatRound(roundInfo: RoundInfoSnapshot | null): boolean {
  if (!roundInfo) return true

  const values = [
    normalizeRoundInfoValue(roundInfo.type),
    normalizeRoundInfoValue(roundInfo.name),
    normalizeRoundInfoValue(roundInfo.nativeName),
  ].filter(Boolean)

  if (values.some(value => value === 'PVP' || value.includes('PLAYER'))) return true
  if (values.some(value => value === 'PVE' || value.includes('PVE'))) {
    return DEBUG_TREAT_PVE_AS_PLAYER_COMBAT
  }

  return true
}

function abandonPendingPlayerCombatOutcome(reason: string): void {
  if (!round.isAwaitingPlayerCombatOutcome) return

  round.playerCombatWinStreak = 0
  round.isAwaitingPlayerCombatOutcome = false
  round.playerCombatOutcome = null
  round.isPlayerCombat = false
  logGep('GEP player combat outcome missing; win not counted', { reason })
}

// battle_end and round_outcome arrive in either order; whichever comes second counts the result
function finalizePlayerCombatOutcome(reason: string): void {
  if (!round.isAwaitingPlayerCombatOutcome) return

  if (!round.playerCombatOutcome) {
    logGep('GEP battle_end: waiting for player combat outcome', {
      reason,
      localPlayerName: session.localPlayerName,
      localPlayerTagLine: session.localPlayerTagLine,
    })
    return
  }

  const outcome = round.playerCombatOutcome
  round.isAwaitingPlayerCombatOutcome = false
  round.playerCombatOutcome = null
  round.isPlayerCombat = false

  if (run.isValid && outcome === 'victory') {
    round.playerCombatWins += 1
    round.playerCombatWinStreak += 1
    logGep('GEP battle_end: player combat victory confirmed', {
      playerCombatWinsThisMatch: round.playerCombatWins,
      playerCombatWinStreak: round.playerCombatWinStreak,
      reason,
    })
    validateImmediateMinorChecks({ isPlayerCombat: false })
    return
  }

  round.playerCombatWinStreak = 0
  logGep('GEP battle_end: player combat streak reset', {
    isValidRun: run.isValid,
    outcome,
    reason,
  })
}

export function handleRoundOutcomeUpdate(outcome: PlayerCombatOutcome): void {
  if (!round.isPlayerCombat && !round.isAwaitingPlayerCombatOutcome) {
    logGep('GEP round_outcome ignored outside tracked player combat', { outcome })
    return
  }

  round.playerCombatOutcome = outcome
  logGep('GEP round_outcome: local player combat outcome captured', {
    outcome,
    localPlayerName: session.localPlayerName,
    localPlayerTagLine: session.localPlayerTagLine,
    isAwaitingPlayerCombatOutcome: round.isAwaitingPlayerCombatOutcome,
  })
  finalizePlayerCombatOutcome('round_outcome')
  broadcastState()
}

export function handleBattleStart(): void {
  abandonPendingPlayerCombatOutcome('next battle_start')
  round.isInPlanningPhase = false
  round.hasSeenPlanningPhaseEvent = true
  shop.isAwaitingUiReturnRefresh = false
  clearPendingXpSignals()
  round.isPlayerCombat = isPlayerCombatRound(round.info)
  round.playerCombatOutcome = null
  round.isAwaitingPlayerCombatOutcome = false
  if (round.isPlayerCombat) {
    clearAugmentPhase('player combat started')
  }
  round.lastBoard = round.latestBoard ? structuredClone(round.latestBoard) : null

  logGep(
    `GEP battle_start: planning phase ended; board snapshot pieces=${countNonEmptyBoardPieces(round.lastBoard)}`,
    round.lastBoard,
  )
  logGep('GEP battle_start: combat context', {
    currentRoundType: round.type,
    currentRoundInfo: round.info,
    currentCombatIsPlayerCombat: round.isPlayerCombat,
  })
  if (DEBUG_VALIDATE_LOCATIONS_ON_BATTLE_START) {
    logGep('GEP debug: battle_start location validation', {
      fulfilledLocationIds: findSatisfiedLocationIds(round.lastBoard),
      board: summarizeBoardTraits(round.lastBoard),
      note: 'debug only; minor checks may send immediately and major checks are sent at match_end',
    })
  }
  validateImmediateMinorChecks()
  broadcastState()
}

export function handleBattleEnd(): void {
  consumePendingShopRerollCandidates('battle_end')
  markAwaitingAutomaticShopRefresh()
  if (round.isPlayerCombat) {
    round.isAwaitingPlayerCombatOutcome = true
    finalizePlayerCombatOutcome('battle_end')
  }
  round.isPlayerCombat = false
  logGep('GEP battle_end: next full shop change will be treated as automatic refresh')
}

export function handleMatchEnd(options: MatchEndOptions = {}): void {
  const reason = options.reason ?? 'match_end event'
  logGep(
    `GEP match_end: last battle_start board snapshot pieces=${countNonEmptyBoardPieces(round.lastBoard)}`,
    {
      reason,
      board: round.lastBoard,
    },
  )

  const finishMatchEnd = () => {
    if (options.useDebugSessionEndRankFallback && DEBUG_TREAT_SESSION_END_AS_TOP4 && run.rank === null) {
      run.rank = 1
      logGep('GEP match_end: using debug Tocker\'s Trials rank fallback', {
        reason,
        rank: run.rank,
        debugTreatSessionEndAsTop4: DEBUG_TREAT_SESSION_END_AS_TOP4,
      })
    }

    validateMatchEndChecks()
    if (options.resetAfterValidation) {
      resetMatchDetectionState()
      logGep('TFT session ended: detection state reset after match-end fallback', { reason })
    }
    broadcastState()
  }

  // Only the Overwolf runtime has GEP; other data sources set the rank before the match end
  if (platform.kind !== 'overwolf') {
    finishMatchEnd()
    return
  }

  overwolf.games.events.getInfo((result) => {
    if (result.success) {
      const rank = readNumberFromRaw(readInfoValueFromRecord(result.res, 'me', 'rank'))
      if (rank !== null) run.rank = rank
    } else {
      console.warn('GEP match_end getInfo failed:', result.error)
    }

    finishMatchEnd()
  })
}
