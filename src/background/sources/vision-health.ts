// Electron: detection status shown in the desktop sidebar and the overlay controls widget
import { broadcastState } from '../broadcast'
import { DetectionHealthTracker, isSameDetectionHealth } from '../detection/health'
import { getLiveRound } from '../live-round'
import { logGep } from '../log'
import { platform } from '../runtime'
import { detection, session } from '../state'
import type { VisionDetectionFacts } from '../../types/vision'

// Re-evaluates without new facts, so a vision window that stopped reporting still turns Limited
const REFRESH_INTERVAL_MS = 2000

const tracker = new DetectionHealthTracker()
let latestFacts: VisionDetectionFacts | null = null
let latestFactsAt = 0
let refreshTimer: number | null = null

function isMatchActive(): boolean {
  return platform.kind === 'electron' && session.isTftRunning && session.matchState === 'in_match'
}

export function resetDetectionHealth(): void {
  tracker.reset()
  latestFacts = null
}

// `broadcast`: false when the caller broadcasts the state itself right afterwards
export function refreshDetectionHealth(broadcast = true): void {
  const isActive = isMatchActive()
  if (!isActive) tracker.reset()
  if (isActive && refreshTimer === null) {
    refreshTimer = window.setInterval(() => refreshDetectionHealth(), REFRESH_INTERVAL_MS)
  } else if (!isActive && refreshTimer !== null) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
  const next = isActive ? tracker.evaluate(latestFacts, latestFactsAt, Date.now(), getLiveRound()) : null
  if (isSameDetectionHealth(next, detection.health)) return
  detection.health = next
  if (next) logGep('Detection status', next)
  if (broadcast) broadcastState()
}

export function handleVisionDetection(facts: VisionDetectionFacts): void {
  latestFacts = facts
  latestFactsAt = Date.now()
  refreshDetectionHealth()
}
