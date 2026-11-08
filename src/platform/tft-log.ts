// Events from the UE5 TFT client's own log file (%LOCALAPPDATA%/TFT/Saved/Logs/TFT.log).
// Shared by the Electron main process (which tails the file) and the background (which uses the events).
// The client writes one log per game process; the lines below were measured on Set 18 (2026-10-18).

export type TftLogEvent =
  // "Entering LobbyState[ETFTLobbyState::InGame]": a new match in this client process
  | { type: 'match_start'; at: string }
  // "Entering LobbyState[ETFTLobbyState::EndOfGameInterstitial]" (and ::EndOfGameSummary)
  | { type: 'match_end'; at: string }
  // Standalone client (TFT 18.6, 2026-11-04): the game server's game-update message, which the
  // League client no longer sees. Only these fields are read; the payload also holds the server
  // address and encryption key, which never leave parseTftLogLine.
  | { type: 'game_info'; at: string; gameId: number; queueId: number | null; puuid: string | null; gameMode: string | null; gameState: string | null }
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
const MATCH_END_PATTERN = /Entering LobbyState\[ETFTLobbyState::EndOfGame(Interstitial|Summary)\]/
const GAME_INFO_MARKER = 'playerCredentials'

// The payload shows up plain in the RMS line and escaped once more in the riot-messaging-service
// line, so keys and string values may carry backslashes: \"gameId\":123
function jsonField(key: string): RegExp {
  return new RegExp(`\\\\*"${key}\\\\*"\\s*:\\s*(?:(-?\\d+)|\\\\*"([^"\\\\]*)\\\\*")`)
}

function readJsonNumber(text: string, key: string): number | null {
  const value = jsonField(key).exec(text)?.[1]
  return value === undefined ? null : Number(value)
}

function readJsonString(text: string, key: string): string | null {
  const value = jsonField(key).exec(text)?.[2]
  return value === undefined || value === '' ? null : value
}

// gameId, queueId and puuid from the flat playerCredentials object only, so another player's
// puuid elsewhere in the payload is never taken for ours
export function parseGameInfo(line: string, at: string): Extract<TftLogEvent, { type: 'game_info' }> | null {
  const credentialsStart = /\\*"playerCredentials\\*"\s*:\s*\{/.exec(line)
  if (!credentialsStart) return null
  const credentialsEnd = line.indexOf('}', credentialsStart.index)
  const credentials = line.slice(credentialsStart.index, credentialsEnd < 0 ? undefined : credentialsEnd)

  const gameId = readJsonNumber(credentials, 'gameId')
  if (gameId === null || gameId <= 0) return null
  const queueId = readJsonNumber(credentials, 'queueId')
  return {
    type: 'game_info',
    at,
    gameId,
    queueId: queueId !== null && queueId > 0 ? queueId : null,
    puuid: readJsonString(credentials, 'puuid'),
    gameMode: readJsonString(line, 'gameMode'),
    gameState: readJsonString(line, 'gameState') ?? /gsm\/game-update\/(\w+)/.exec(line)?.[1] ?? null,
  }
}

export function parseTftLogLine(line: string): TftLogEvent | null {
  const at = TIMESTAMP_PATTERN.exec(line)?.[1]
  if (!at) return null

  if (line.includes(MATCH_START_MARKER)) return { type: 'match_start', at }
  if (MATCH_END_PATTERN.test(line)) return { type: 'match_end', at }
  if (line.includes(GAME_INFO_MARKER)) return parseGameInfo(line, at)

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
