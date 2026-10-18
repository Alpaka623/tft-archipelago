/// <reference types="@overwolf/types" />
import { logGep } from './log'
import {
  isRecord,
  isTruthyGepValue,
  parseGepValueForLog,
  parseMaybeJson,
  readNumberFromRaw,
  readStringFromRaw,
} from './raw'
import type {
  AugmentSnapshot,
  BoardSnapshot,
  LocalPlayerIdentity,
  PickedAugmentSnapshot,
  PlayerCombatOutcome,
  RoundInfoSnapshot,
  ShopSnapshot,
  UnknownRecord,
  XpSnapshot,
} from './types'

export const SHOP_SLOT_COUNT = 5

export function readInfoValue(infoUpdate: overwolf.games.events.InfoUpdates2Event, feature: string, key: string): unknown {
  const update = infoUpdate as unknown as UnknownRecord
  const info = update['info']

  if (isRecord(info)) {
    const featureInfo = info[feature]
    if (isRecord(featureInfo) && key in featureInfo) {
      return featureInfo[key]
    }

    if (update['feature'] === feature) {
      const category = update['category']
      if (typeof category === 'string') {
        const categoryInfo = info[category]
        if (isRecord(categoryInfo) && key in categoryInfo) {
          return categoryInfo[key]
        }
      }

      for (const categoryInfo of Object.values(info)) {
        if (isRecord(categoryInfo) && key in categoryInfo) {
          return categoryInfo[key]
        }
      }
    }
  }

  if (update['feature'] === feature && update['key'] === key) {
    return update['value'] ?? update['data']
  }

  return undefined
}

export function readInfoValueFromRecord(info: unknown, feature: string, key: string): unknown {
  if (!isRecord(info)) return undefined

  const featureInfo = info[feature]
  if (isRecord(featureInfo) && key in featureInfo) {
    return featureInfo[key]
  }

  return undefined
}

export function summarizeGetInfoShape(info: unknown): UnknownRecord {
  return {
    topLevelKeys: isRecord(info) ? Object.keys(info) : [],
    featureKeys: isRecord(info)
      ? Object.fromEntries(
        Object.entries(info)
          .filter(([, value]) => isRecord(value))
          .map(([feature, value]) => [feature, Object.keys(value as UnknownRecord)]),
      )
      : {},
  }
}

export function summarizeGepEnvironment(info: unknown): UnknownRecord {
  const matchInfo = isRecord(info) && isRecord(info['match_info'])
    ? info['match_info'] as UnknownRecord
    : null
  const gameInfo = isRecord(info) && isRecord(info['game_info'])
    ? info['game_info'] as UnknownRecord
    : null
  const rosterPlayerStatusRaw = readInfoValueFromRecord(info, 'roster', 'player_status')
  const rosterPlayerStatus = parseGepValueForLog(rosterPlayerStatusRaw)
  const localRosterPlayer = isRecord(rosterPlayerStatus)
    ? Object.values(rosterPlayerStatus).find(player => isRecord(player) && isTruthyGepValue(player['localplayer']))
    : null

  return {
    versionInfo: parseGepValueForLog(readInfoValueFromRecord(info, 'gep_internal', 'version_info')),
    matchInfoKeys: matchInfo ? Object.keys(matchInfo) : [],
    matchInfo: {
      game_mode: parseGepValueForLog(readInfoValueFromRecord(info, 'match_info', 'game_mode')),
      game_type: parseGepValueForLog(readInfoValueFromRecord(info, 'match_info', 'game_type')),
      queue_id: parseGepValueForLog(readInfoValueFromRecord(info, 'match_info', 'queue_id')),
      round_type: parseGepValueForLog(readInfoValueFromRecord(info, 'match_info', 'round_type')),
      round_outcome: parseGepValueForLog(readInfoValueFromRecord(info, 'match_info', 'round_outcome')),
    },
    summonerName: parseGepValueForLog(readInfoValueFromRecord(info, 'me', 'summoner_name')),
    gameInfoKeys: gameInfo ? Object.keys(gameInfo) : [],
    gameInfo: {
      queueId: gameInfo?.['queueId'],
      matchId: gameInfo?.['matchId'],
      match_started: gameInfo?.['match_started'],
      matchStarted: gameInfo?.['matchStarted'],
      game_mode: parseGepValueForLog(readInfoValueFromRecord(info, 'game_info', 'game_mode')),
      game_type: parseGepValueForLog(readInfoValueFromRecord(info, 'game_info', 'game_type')),
    },
    rosterPlayerStatusKeys: isRecord(rosterPlayerStatus) ? Object.keys(rosterPlayerStatus) : [],
    rosterLocalPlayer: isRecord(localRosterPlayer)
      ? {
        keys: Object.keys(localRosterPlayer),
        xp: localRosterPlayer['xp'],
        level: localRosterPlayer['level'],
        gold: localRosterPlayer['gold'],
        localplayer: localRosterPlayer['localplayer'],
        tag_line: localRosterPlayer['tag_line'],
      }
      : null,
  }
}

export function readRoundInfo(infoUpdate: overwolf.games.events.InfoUpdates2Event): RoundInfoSnapshot | null {
  const raw = readInfoValue(infoUpdate, 'match_info', 'round_type')
  if (!raw) return null

  const roundData = parseMaybeJson(raw)
  if (typeof roundData === 'string') {
    return {
      type: roundData,
      name: null,
      nativeName: null,
      stage: null,
    }
  }
  if (!isRecord(roundData)) return null

  const type = roundData['type']
  const name = roundData['name']
  const nativeName = roundData['native_name']
  const stage = roundData['stage']
  return {
    type: typeof type === 'string' ? type : null,
    name: typeof name === 'string' ? name : null,
    nativeName: typeof nativeName === 'string' ? nativeName : null,
    stage: typeof stage === 'string' ? stage : null,
  }
}

export function normalizePlayerIdentityValue(value: string | null): string {
  return value?.trim().toLowerCase() ?? ''
}

export function normalizeOutcomeValue(raw: unknown): PlayerCombatOutcome | null {
  const value = readStringFromRaw(raw)?.toLowerCase()
  if (value === 'victory' || value === 'win' || value === 'won') return 'victory'
  if (value === 'defeat' || value === 'loss' || value === 'lost') return 'defeat'
  return null
}

export function readLocalSummonerName(infoUpdate: overwolf.games.events.InfoUpdates2Event): string | null {
  return readStringFromRaw(readInfoValue(infoUpdate, 'me', 'summoner_name'))
}

export function readRosterLocalPlayerIdentityFromRaw(raw: unknown): LocalPlayerIdentity | null {
  const parsed = parseMaybeJson(raw)
  if (!isRecord(parsed)) return null

  for (const [playerName, player] of Object.entries(parsed)) {
    if (!isRecord(player) || !isTruthyGepValue(player['localplayer'])) continue

    return {
      name: playerName.trim() === '' ? null : playerName,
      tagLine: readStringFromRaw(player['tag_line']),
    }
  }

  return null
}

export function readRosterLocalPlayerIdentity(infoUpdate: overwolf.games.events.InfoUpdates2Event): LocalPlayerIdentity | null {
  return readRosterLocalPlayerIdentityFromRaw(readInfoValue(infoUpdate, 'roster', 'player_status'))
}

export function readGodPickedFavor(infoUpdate: overwolf.games.events.InfoUpdates2Event): string | null {
  return readStringFromRaw(readInfoValue(infoUpdate, 'match_info', 'god_picked_favor'))
}

export function readNameSlots(raw: unknown, prefix: string, count: number): string[] | null {
  const parsed = parseMaybeJson(raw)
  if (!isRecord(parsed)) return null

  const slots: string[] = []
  for (let i = 1; i <= count; i += 1) {
    const slot = parsed[`${prefix}_${i}`]
    if (!isRecord(slot)) {
      slots.push('')
      continue
    }

    const name = slot['name']
    slots.push(typeof name === 'string' ? name : '')
  }

  return slots
}

export function readXpFromRecord(parsed: UnknownRecord): XpSnapshot | null {
  const level = Number(parsed['level'])
  const currentXp = Number(parsed['current_xp'])
  const xpMaxRaw = parsed['xp_max']
  const xpMax = xpMaxRaw === undefined ? undefined : Number(xpMaxRaw)

  if (Number.isFinite(level) && Number.isFinite(currentXp)) {
    return {
      level,
      current_xp: currentXp,
      ...(Number.isFinite(xpMax) ? { xp_max: xpMax } : {}),
    }
  }

  const nestedXp = parsed['xp']
  if (nestedXp) {
    const nestedParsed = parseMaybeJson(nestedXp)
    if (isRecord(nestedParsed)) return readXpFromRecord(nestedParsed)
  }

  return null
}

export function readXpFromRaw(raw: unknown): XpSnapshot | null {
  if (!raw) return null

  const parsed = parseMaybeJson(raw)
  return isRecord(parsed) ? readXpFromRecord(parsed) : null
}

export function readShopSnapshot(infoUpdate: overwolf.games.events.InfoUpdates2Event): ShopSnapshot | null {
  const raw = readInfoValue(infoUpdate, 'store', 'shop_pieces')
  if (!raw) return null
  return readNameSlots(raw, 'slot', SHOP_SLOT_COUNT)
}

export function readAugmentSnapshot(infoUpdate: overwolf.games.events.InfoUpdates2Event): AugmentSnapshot | null {
  const raw = readInfoValue(infoUpdate, 'augments', 'me')
  if (!raw) return null

  const snapshot = readNameSlots(raw, 'augment', 3)
  const parsed = parseMaybeJson(raw)
  logGep('GEP augment snapshot raw shape', {
    keys: isRecord(parsed) ? Object.keys(parsed) : [],
    snapshot,
  })

  return snapshot
}

export function readPickedAugmentSnapshot(infoUpdate: overwolf.games.events.InfoUpdates2Event): PickedAugmentSnapshot | null {
  const raw = readInfoValue(infoUpdate, 'augments', 'picked_augment')
  if (!raw) return null

  const parsed = parseMaybeJson(raw)
  if (!isRecord(parsed)) return null

  const filledSlots: Array<{ name: string; position: number }> = []

  for (let i = 1; i <= 3; i += 1) {
    const slot = parsed[`slot_${i}`]
    if (!isRecord(slot)) continue

    const name = slot['name']
    if (typeof name === 'string' && name.trim() !== '') {
      filledSlots.push({ name, position: i })
    }
  }

  logGep('GEP picked augment raw shape', {
    keys: Object.keys(parsed),
    filledSlots,
    hasFourthSlot: 'slot_4' in parsed,
  })

  if (filledSlots.length === 0) return null
  const picked = filledSlots[filledSlots.length - 1]

  return {
    name: picked.name,
    position: filledSlots.length === 1 ? picked.position : null,
    hasFourthSlot: 'slot_4' in parsed,
  }
}

export function readBoardSnapshot(infoUpdate: overwolf.games.events.InfoUpdates2Event): BoardSnapshot | null {
  const raw = readInfoValue(infoUpdate, 'board', 'board_pieces')
  if (!raw) return null

  const parsed = parseMaybeJson(raw)
  return isRecord(parsed) ? parsed : null
}

export function readGold(infoUpdate: overwolf.games.events.InfoUpdates2Event): number | null {
  const raw = readInfoValue(infoUpdate, 'me', 'gold')
  return readNumberFromRaw(raw)
}

export function readRank(infoUpdate: overwolf.games.events.InfoUpdates2Event): number | null {
  const raw = readInfoValue(infoUpdate, 'me', 'rank')
  return readNumberFromRaw(raw)
}

export function readXp(infoUpdate: overwolf.games.events.InfoUpdates2Event): XpSnapshot | null {
  const rawXp = readInfoValue(infoUpdate, 'me', 'xp')
  const xp = readXpFromRaw(rawXp)
  if (xp) return xp

  const rawMe = readInfoValue(infoUpdate, 'me', 'me')
  return readXpFromRaw(rawMe)
}

export function hasXpIncreased(current: XpSnapshot, previous: XpSnapshot | null): boolean {
  if (!previous) return false
  return current.level > previous.level || current.current_xp > previous.current_xp
}
