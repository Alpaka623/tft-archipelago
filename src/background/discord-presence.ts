// Discord Rich Presence text from the app state. Never shows the slot name or server.
import type { RichPresence } from '../platform'
import type { AppState } from '../types/state'
import { getCurrentStageLabel } from './live-round'
import { platform } from './runtime'
import { session } from './state'

let lastPresenceKey: string | null = null

export function buildRichPresence(state: AppState, isTftRunning: boolean, stageLabel: string | null, startedAt: number): RichPresence {
  if (!state.connected) {
    return { details: 'Not connected to a multiworld', state: null, startedAt: null, runStatus: null }
  }

  const progress = `${state.completedMajorCheckCount}/${state.goalChecks} major checks`
  const details = state.completedMajorCheckCount >= state.goalChecks ? `Goal reached · ${progress}` : progress
  if (!isTftRunning) {
    return { details, state: 'Waiting for a match', startedAt: null, runStatus: null }
  }

  return {
    details,
    state: `${stageLabel ? `Stage ${stageLabel}` : 'In a match'} · ${state.isValidRun ? 'Run valid' : 'Run invalidated'}`,
    startedAt,
    runStatus: state.isValidRun ? 'valid' : 'invalid',
  }
}

export function syncRichPresence(state: AppState): void {
  const presence = buildRichPresence(state, session.isTftRunning, getCurrentStageLabel(), session.startedAt)
  const key = JSON.stringify(presence)
  if (key === lastPresenceKey) return
  lastPresenceKey = key
  platform.setRichPresence(presence)
}
