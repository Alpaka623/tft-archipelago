import type { TftLogEvent } from '../platform/tft-log'

// Current round from the TFT client log. Every round ends with a CombatDeparture or
// DraftDeparture (carousel) phase, so the current round is their count + 1. Checked against
// Match-V5 last_round for 11 saved games (2026-10-18).
//
// Champion checks do not use the log: spell and victory voice lines were too rare to prove a unit
// fought, and the per-round board in TFTEoGStats.json is exact (see main.ts evaluateLiveBoard).

export interface TftLogUpdate {
  roundChanged: boolean
}

const ROUND_END_PHASES = new Set(['CombatDeparture', 'DraftDeparture'])

// Timestamps (epoch ms) of the round ends in a live batch, oldest first
export function getRoundEndTimes(events: TftLogEvent[]): number[] {
  return events
    .filter(event => event.type === 'phase' && ROUND_END_PHASES.has(event.phase))
    .map(event => parseTftLogTimestamp(event.at))
    .filter((at): at is number => at !== null)
}

// Log timestamps are UTC: "2026.10.18-08.48.26:573"
export function parseTftLogTimestamp(at: string): number | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})$/.exec(at)
  if (!match) return null
  const [year, month, day, hour, minute, second, millisecond] = match.slice(1).map(Number)
  return Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
}

export class TftLogTracker {
  private completedRounds = 0
  private matchStartedAt: number | null = null

  // Current round of the match whose start the log showed after `notBefore`; null otherwise, so an
  // old game's log never leaks into a new session
  getCurrentRound(notBefore: number): number | null {
    if (this.matchStartedAt === null || this.matchStartedAt < notBefore) return null
    return this.completedRounds + 1
  }

  handleEvents(events: TftLogEvent[]): TftLogUpdate {
    let roundChanged = false
    for (const event of events) {
      if (event.type === 'match_start') {
        this.completedRounds = 0
        this.matchStartedAt = parseTftLogTimestamp(event.at)
        roundChanged = true
      } else if (event.type === 'phase' && ROUND_END_PHASES.has(event.phase)) {
        this.completedRounds += 1
        roundChanged = true
      }
    }
    return { roundChanged }
  }
}
