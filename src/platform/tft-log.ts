// Events from the UE5 TFT client's own log file (%LOCALAPPDATA%/TFT/Saved/Logs/TFT.log).
// Shared by the Electron main process (which tails the file) and the background (which uses the events).
// The client writes one log per game process; the lines below were measured on Set 18 (2026-10-18).

export type TftLogEvent =
  // "Entering LobbyState[ETFTLobbyState::InGame]": a new match in this client process
  | { type: 'match_start'; at: string }
  // "Audio.Event.VO.Unit.StarUp.2Star" on one of the player's own units, from any source
  // (three copies, duplicator, loot). Parsed but not used for checks; they use the board file.
  | { type: 'star_up'; at: string; actorId: string; championId: string; starLevel: number }
  // Spell or round-victory voice line. Too rare to prove a unit fought (a casting 2-star Rakan and
  // Veigar produced none), so it is not used for checks.
  | { type: 'unit_in_combat'; at: string; actorId: string; championId: string; reason: 'spell' | 'victory' }
  // "Phase[ETFTPhaseType::CombatDeparture]" and similar
  | { type: 'phase'; at: string; phase: string }

export interface TftLogBatch {
  events: TftLogEvent[]
  // True for the lines that were already in the file when the app started watching it
  isReplay: boolean
}

export interface TftEndOfGameFile {
  stats: unknown
  modifiedAt: number
}

export const TFT_LOG_EVENTS_MESSAGE_ID = 'TFT_LOG_EVENTS'
export const TFT_END_OF_GAME_MESSAGE_ID = 'TFT_END_OF_GAME_STATS'

const TIMESTAMP_PATTERN = /^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]/
const ACTOR_PATTERN = /Actor\[TFTCharacter_(\d+) \{([^}]+)\}\]/
// Both "Trigger[...] Actor[...] Plays" and "Actor[...] and Event[...] was blocked" mean the event happened
const AUDIO_EVENT_PATTERN = /Audio\.Event\.VO\.(Unit\.StarUp\.(\d)Star|Unit\.Spell|Army\.Round\.UnitCombatVictory)\b/
const PHASE_PATTERN = /Phase\[ETFTPhaseType::(\w+)\]/
const MATCH_START_MARKER = 'Entering LobbyState[ETFTLobbyState::InGame]'

export function parseTftLogLine(line: string): TftLogEvent | null {
  const at = TIMESTAMP_PATTERN.exec(line)?.[1]
  if (!at) return null

  if (line.includes(MATCH_START_MARKER)) return { type: 'match_start', at }

  const audio = AUDIO_EVENT_PATTERN.exec(line)
  if (audio) {
    const actor = ACTOR_PATTERN.exec(line)
    if (!actor) return null
    const [, actorId, championId] = actor
    if (audio[2]) return { type: 'star_up', at, actorId, championId, starLevel: Number(audio[2]) }
    return { type: 'unit_in_combat', at, actorId, championId, reason: audio[1] === 'Unit.Spell' ? 'spell' : 'victory' }
  }

  const phase = PHASE_PATTERN.exec(line)?.[1]
  return phase ? { type: 'phase', at, phase } : null
}
