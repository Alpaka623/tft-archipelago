// The TFT session: the game process starting and stopping, its window resolution, and (Electron) the
// match boundaries from the TFT client log. The standalone client (2026-11-03) keeps one process for menu,
// lobby and every match, so a match ends when the log says so; a League-client launch still ends with the process.
import type { GameState } from '../platform'
import { deriveState } from './app-state'
import { evaluateLiveBoard, setLatestBoardStats, validateImmediateMinorChecks } from './archipelago/checks'
import { broadcastState } from './broadcast'
import { TFT_MENU_LOBBY_STATES } from './client-match'
import { handleMatchEnd, resetMatchDetectionState } from './detection/match'
import { syncRichPresence } from './discord-presence'
import { getLiveRound } from './live-round'
import { logGep } from './log'
import { clientMatchTracker, platform, tftLogTracker } from './runtime'
import { handleVisionLogRoundEnd } from './sources/vision'
import { getRoundEndTimes, parseTftLogTimestamp } from './tft-log-tracker'
import { run, session, windows } from './state'
import type { TftEndOfGameFile, TftLogBatch, TftLogEvent } from '../platform/tft-log'
import { prewarmBlockerWindows, resyncAllBlockerPositions } from './windows/blockers'
import {
  applyOverlayBounds,
  forgetOverlayForEndedSession,
  openOverlayOncePerSession,
  updateGameResolution,
} from './windows/overlay'

// Electron: placement and board arrive later from the TFT client files or the Riot client; freeze the rule state now
function queueMatchResult(requireKnownGame = false): void {
  clientMatchTracker?.queueSessionResult({
    sessionStartedAt: session.startedAt,
    isValidRun: run.isValid,
    violationReason: run.violationReason,
    logRound: getLiveRound(),
    requireKnownGame,
  })
}

// The game process restarted in the same match (crash or reconnect): continue that match's run
function restoreReconnectSession(): void {
  const reconnectSession = clientMatchTracker?.takeReconnectSession() ?? null
  if (!reconnectSession) return
  session.startedAt = reconnectSession.sessionStartedAt
  run.isValid = reconnectSession.isValidRun
  run.violationReason = reconnectSession.violationReason
}

function handleSessionEnd(reason: string): void {
  if (session.isTftRunning && clientMatchTracker) {
    session.isTftRunning = false
    clientMatchTracker.setGameProcessRunning(false)
    // 'in_match': the process closed mid-match (League-client launch, crash). 'unknown': no lobby state in the
    // log; a standalone client closed from its menu before any lobby change, or no log at all (then only a game
    // known from the League client counts).
    if (session.matchState !== 'menu') {
      queueMatchResult(session.matchState === 'unknown')
      logGep('TFT session ended: detection state reset, match result pending', { reason, matchState: session.matchState })
    } else {
      logGep('TFT session ended in the client menu', { reason })
    }
    session.matchState = 'unknown'
    resetMatchDetectionState()
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

// The log may have been read before the process was detected (app started while TFT was running)
function getInitialMatchState(): typeof session.matchState {
  const tftClientState = clientMatchTracker?.getTftClientState() ?? null
  if (tftClientState === null) return 'unknown'
  return tftClientState === 'InGame' ? 'in_match' : 'menu'
}

function handleSessionStart(reason: string): void {
  session.isTftRunning = true
  session.startedAt = Date.now()
  session.matchState = getInitialMatchState()
  clientMatchTracker?.setGameProcessRunning(true)
  resetMatchDetectionState()
  logGep('TFT session started: detection state reset', { reason, matchState: session.matchState })
  restoreReconnectSession()
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

// A new match inside a running process (standalone client): start a fresh run
function openMatch(at: string, reason: string): void {
  session.matchState = 'in_match'
  session.startedAt = parseTftLogTimestamp(at) ?? Date.now()
  resetMatchDetectionState()
  restoreReconnectSession()
  logGep('TFT log: match started, detection state reset', { reason, isValidRun: run.isValid })
  broadcastState()
}

// Replayed lines (already in the log when the app started) update the state but never queue a result:
// the app did not watch that match.
function handleMatchLifecycleEvent(event: TftLogEvent, isReplay: boolean): void {
  const tracker = clientMatchTracker
  if (!tracker) return

  switch (event.type) {
    case 'game_start':
      tracker.handleLogGameStart(event)
      if (session.isTftRunning && session.matchState !== 'in_match') openMatch(event.at, 'game assigned')
      break
    case 'match_start':
      tracker.handleLogLobbyState('InGame')
      if (!session.isTftRunning) break
      // 'unknown': a League-client launch starts the process for this match, keep the process-start state
      if (session.matchState === 'menu') openMatch(event.at, 'entered the match')
      else session.matchState = 'in_match'
      break
    case 'match_end':
      if (session.isTftRunning && session.matchState !== 'menu' && !isReplay) {
        queueMatchResult()
        logGep('TFT log: match ended, detection state reset, match result pending')
      }
      tracker.handleLogMatchEnd()
      if (session.isTftRunning) {
        session.matchState = 'menu'
        resetMatchDetectionState()
        broadcastState()
      }
      break
    case 'lobby_state':
      tracker.handleLogLobbyState(event.state)
      // the process started in the client menu: nothing that happened so far belongs to a match
      if (session.isTftRunning && session.matchState === 'unknown' && TFT_MENU_LOBBY_STATES.has(event.state)) {
        session.matchState = 'menu'
        resetMatchDetectionState()
        broadcastState()
      }
      break
    default:
      break
  }
}

// TFT client log (Electron): match boundaries and the round count for the live stage
export function handleTftLogBatch(batch: TftLogBatch): void {
  if (batch.isNewFile) clientMatchTracker?.handleLogFileStarted()
  let roundChanged = false
  for (const event of batch.events) {
    // the match end needs the round count of the match that just ended
    handleMatchLifecycleEvent(event, batch.isReplay)
    if (tftLogTracker.handleEvents([event]).roundChanged) roundChanged = true
  }
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
