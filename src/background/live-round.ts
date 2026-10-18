import { formatStageRound, getStageFromRound } from './board'
import { clientMatchTracker, tftLogTracker } from './runtime'
import { round, session } from './state'

// The log's match must have started with this session, so an older game's log never counts
const TFT_LOG_MATCH_START_LEAD_MS = 10 * 60 * 1000

// Electron: round count from the TFT client log
export function getLiveRound(): number | null {
  if (!session.isTftRunning) return null
  return tftLogTracker.getCurrentRound(session.startedAt - TFT_LOG_MATCH_START_LEAD_MS)
}

// Tocker's Trials has its own round layout
function getLiveQueueId(): number | null {
  return clientMatchTracker?.getCurrentGame()?.queueId ?? null
}

export function getLiveStage(): number | null {
  const liveRound = getLiveRound()
  return liveRound === null ? null : getStageFromRound(liveRound, getLiveQueueId())
}

// Electron: round count from the TFT log; Overwolf: GEP round_type. The vision stage is only a fingerprint.
export function getCurrentStageLabel(): string | null {
  const liveRound = getLiveRound()
  return liveRound !== null ? formatStageRound(liveRound, getLiveQueueId()) : round.info?.stage ?? null
}
