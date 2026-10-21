// The TFT session: the game process starting and stopping, and its window resolution
import type { GameState } from '../platform'
import { deriveState } from './app-state'
import { evaluateLiveBoard, setLatestBoardStats, validateImmediateMinorChecks } from './archipelago/checks'
import { broadcastState } from './broadcast'
import { handleMatchEnd, resetMatchDetectionState } from './detection/match'
import { syncRichPresence } from './discord-presence'
import { getLiveRound } from './live-round'
import { logGep } from './log'
import { clientMatchTracker, platform, tftLogTracker } from './runtime'
import { handleVisionLogRoundEnd } from './sources/vision'
import { getRoundEndTimes } from './tft-log-tracker'
import { run, session, windows } from './state'
import type { TftEndOfGameFile, TftLogBatch } from '../platform/tft-log'
import { prewarmBlockerWindows, resyncAllBlockerPositions } from './windows/blockers'
import {
  applyOverlayBounds,
  forgetOverlayForEndedSession,
  openOverlayOncePerSession,
  updateGameResolution,
} from './windows/overlay'

function handleSessionEnd(reason: string): void {
  if (session.isTftRunning && clientMatchTracker) {
    // Electron: placement and board arrive later from the Riot client; freeze the rule state now
    session.isTftRunning = false
    clientMatchTracker.queueSessionResult({
      sessionStartedAt: session.startedAt,
      isValidRun: run.isValid,
      violationReason: run.violationReason,
      logRound: getLiveRound(),
    })
    resetMatchDetectionState()
    logGep('TFT session ended: detection state reset, match result pending', { reason })
    broadcastState()
  } else if (session.isTftRunning) {
    session.isTftRunning = false
    logGep('TFT session ended: running match-end fallback before state reset', { reason })
    handleMatchEnd({
      reason: `TFT session ended: ${reason}`,
      resetAfterValidation: true,
      useDebugSessionEndRankFallback: true,
    })
  }
  forgetOverlayForEndedSession()
}

function handleSessionStart(reason: string): void {
  session.isTftRunning = true
  session.startedAt = Date.now()
  resetMatchDetectionState()
  logGep('TFT session started: detection state reset', { reason })
  // The game process restarted in the same match (crash or reconnect): continue that match's run
  const reconnectSession = clientMatchTracker?.takeReconnectSession() ?? null
  if (reconnectSession) {
    session.startedAt = reconnectSession.sessionStartedAt
    run.isValid = reconnectSession.isValidRun
    run.violationReason = reconnectSession.violationReason
  }
  prewarmBlockerWindows(`${reason}; TFT session started`)
  broadcastState()
  evaluateLiveBoard('TFT session start')
}

function handleTftRunningState(gameState: GameState, reason: string): void {
  if (!gameState.isRunning) {
    handleSessionEnd(reason)
    return
  }

  if (!session.isTftRunning) handleSessionStart(reason)
  openOverlayOncePerSession(reason)
}

export function trackTftSession(): void {
  void platform.getRunningGame().then((gameState) => {
    handleTftRunningState(gameState, 'TFT detected during background startup')
  })

  platform.onGameStateChanged(({ state: gameState, resolutionChanged }) => {
    handleTftRunningState(gameState, 'TFT game info update')
    if (resolutionChanged && windows.overlayId && gameState.isRunning) {
      updateGameResolution(gameState)
      applyOverlayBounds(windows.overlayId, gameState, 'TFT resolution changed')
      resyncAllBlockerPositions('TFT resolution changed')
      broadcastState()
    }
  })
}

// TFT client log (Electron): the round count feeds the live stage
export function handleTftLogBatch(batch: TftLogBatch): void {
  const { roundChanged } = tftLogTracker.handleEvents(batch.events)
  // the next round's shop refresh follows; vision may miss the stage label change
  const roundEndedAt = getRoundEndTimes(batch.events).pop()
  if (!batch.isReplay && roundEndedAt !== undefined && session.isTftRunning) handleVisionLogRoundEnd(roundEndedAt)
  if (roundChanged && session.isTftRunning) {
    validateImmediateMinorChecks()
    // The stage is shown in Discord but not part of the broadcast state
    syncRichPresence(deriveState())
  }
}

// TFTEoGStats.json changed: after every round (live board) and at the game end (match result)
export function handleEndOfGameFile(file: TftEndOfGameFile): void {
  clientMatchTracker?.handleEndOfGameStats(file.stats)
  setLatestBoardStats(file.stats)
}
