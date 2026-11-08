// Events from the UE5 TFT client's own log file (%LOCALAPPDATA%/TFT/Saved/Logs/TFT.log).
// Shared by the Electron main process (which tails the file) and the background (which uses the events).
// The client writes one log per game process; the lines below were measured on Set 18 (2026-10-18).
// The standalone client (2026-11-03) runs menu, lobby and every match in one process and one log.

export type TftLogEvent =
  // "Entering LobbyState[ETFTLobbyState::InGame]": a new match in this client process
  | { type: 'match_start'; at: string }
  // "Exiting LobbyState[ETFTLobbyState::InGame]": back to the client menu (standalone client only).
  // Comes after the final TFTEoGStats.json write.
  | { type: 'match_end'; at: string }
  // Any other "Entering LobbyState[...]": Frontend, SoloMode, SocialMode, Matchmaking, EndOfGameSummary, ...
  | { type: 'lobby_state'; at: string; state: string }
  // Riot messaging "gsm/game-update/IN_PROGRESS" (standalone client): game found, before loading
  | { type: 'game_start'; at: string; gameId: number; queueId: number | null; puuid: string | null }
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
  // The first lines of a log file (the client starts a new file per process); state from an older file is stale
  isNewFile?: boolean
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
const MATCH_END_MARKER = 'Exiting LobbyState[ETFTLobbyState::InGame]'
const LOBBY_STATE_PATTERN = /Entering LobbyState\[ETFTLobbyState::(\w+)\]/
const LOBBY_STATE_REPEAT_SUFFIX = 'had no side effect'
// One RMS line per game; the same message also appears escaped in a "Got message" line, which is skipped.
// The payload also holds connection keys: only the three fields below are read, the line is never kept.
const GAME_START_MARKER = "for resource 'lol-gsm-server/v1/gsm/game-update/IN_PROGRESS'"
const GAME_ID_PATTERN = /"playerCredentials":\{"gameId":(\d+)/
const PAYLOAD_ID_PATTERN = /payload '\{"id":(\d+)/
const QUEUE_ID_PATTERN = /"queueId":(\d+)/
const PUUID_PATTERN = /"puuid":"([0-9A-Za-z_-]{20,100})"/

function parseGameStart(line: string, at: string): TftLogEvent | null {
  const gameId = Number(GAME_ID_PATTERN.exec(line)?.[1] ?? PAYLOAD_ID_PATTERN.exec(line)?.[1])
  if (!Number.isSafeInteger(gameId) || gameId <= 0) return null
  const queueText = QUEUE_ID_PATTERN.exec(line)?.[1]
  return {
    type: 'game_start',
    at,
    gameId,
    queueId: queueText === undefined ? null : Number(queueText),
    puuid: PUUID_PATTERN.exec(line)?.[1] ?? null,
  }
}

export function parseTftLogLine(line: string): TftLogEvent | null {
  const at = TIMESTAMP_PATTERN.exec(line)?.[1]
  if (!at) return null

  // "Entering LobbyState[...] had no side effect" repeats the line before it
  const isRepeat = line.endsWith(LOBBY_STATE_REPEAT_SUFFIX)
  if (line.includes(MATCH_START_MARKER)) return isRepeat ? null : { type: 'match_start', at }
  if (line.includes(MATCH_END_MARKER)) return isRepeat ? null : { type: 'match_end', at }
  if (line.includes(GAME_START_MARKER)) return parseGameStart(line, at)
  const lobbyState = isRepeat ? undefined : LOBBY_STATE_PATTERN.exec(line)?.[1]
  if (lobbyState) return { type: 'lobby_state', at, state: lobbyState }

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
