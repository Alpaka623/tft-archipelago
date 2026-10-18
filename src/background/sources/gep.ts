// Overwolf Game Events Provider: translates GEP info updates and events into the detection modules
/// <reference types="@overwolf/types" />
import { broadcastState } from '../broadcast'
import {
  handleAugmentUpdate,
  handleGodPickedFavorUpdate,
  handlePickedAugmentUpdate,
  handleRoundInfoUpdate,
} from '../detection/augments'
import {
  handleBattleEnd,
  handleBattleStart,
  handleMatchEnd,
  handleRoundEnd,
  handleRoundOutcomeUpdate,
  handleRoundStart,
  resetMatchDetectionState,
  updateLocalPlayerIdentity,
} from '../detection/match'
import {
  SHOP_SLOT_COUNT,
  handleShopUpdate,
  handleShopVisibleUpdate,
  inferShopVisibleFromShopData,
} from '../detection/shop'
import { handleEconomyUpdate } from '../detection/xp'
import {
  normalizeOutcomeValue,
  normalizePlayerIdentityValue,
  readAugmentSnapshot,
  readBoardSnapshot,
  readGodPickedFavor,
  readGold,
  readInfoValue,
  readInfoValueFromRecord,
  readLocalSummonerName,
  readNameSlots,
  readPickedAugmentSnapshot,
  readRank,
  readRosterLocalPlayerIdentity,
  readRosterLocalPlayerIdentityFromRaw,
  readRoundInfo,
  readShopSnapshot,
  readXp,
  readXpFromRaw,
  summarizeGepEnvironment,
  summarizeGetInfoShape,
} from '../gep-parsing'
import { logGep } from '../log'
import {
  isRecord,
  parseMaybeJson,
  readNumberFromRaw,
  readStringFromRaw,
} from '../raw'
import { economy, round, run, session, shop } from '../state'
import type { PlayerCombatOutcome, UnknownRecord } from '../types'

const GEP_REQUIRED_FEATURES = ['me', 'match_info', 'store', 'board', 'augments', 'roster']
const GEP_FEATURE_RETRY_DELAY_MS = 1000
const MAX_GEP_FEATURE_REGISTRATION_ATTEMPTS = 10
const DEBUG_GEP_INFO_UPDATES = true
const MAX_DEBUG_INFO_UPDATE_LOGS = 80

let debugInfoUpdateLogsRemaining = MAX_DEBUG_INFO_UPDATE_LOGS
let hasRegisteredListeners = false

export function resetGepDebugLogBudget(): void {
  debugInfoUpdateLogsRemaining = MAX_DEBUG_INFO_UPDATE_LOGS
}

// Logs the shape of the first info updates per match, for tracking GEP payload changes
function describeInfoUpdate(infoUpdate: overwolf.games.events.InfoUpdates2Event): void {
  if (!DEBUG_GEP_INFO_UPDATES || debugInfoUpdateLogsRemaining <= 0) return

  const update = infoUpdate as unknown as UnknownRecord
  const feature = typeof update['feature'] === 'string' ? update['feature'] : 'unknown'
  if (!GEP_REQUIRED_FEATURES.includes(feature)) return

  const info = update['info']
  const infoKeys = isRecord(info) ? Object.keys(info) : []
  const nestedInfoKeys = isRecord(info)
    ? Object.fromEntries(
      Object.entries(info)
        .filter(([, value]) => isRecord(value))
        .map(([nestedKey, nestedValue]) => [nestedKey, Object.keys(nestedValue as UnknownRecord)]),
    )
    : {}

  debugInfoUpdateLogsRemaining -= 1
  logGep('GEP info update shape', {
    feature,
    category: update['category'],
    key: update['key'],
    hasValue: update['value'] !== undefined,
    topLevelKeys: Object.keys(update),
    infoKeys,
    nestedInfoKeys,
  })
}

// round_outcome lists every player; the local one is matched by name, or by tag line as a fallback
function readRoundOutcomeForLocalPlayer(infoUpdate: overwolf.games.events.InfoUpdates2Event): PlayerCombatOutcome | null {
  const raw = readInfoValue(infoUpdate, 'match_info', 'round_outcome')
  if (!raw) return null

  const parsed = parseMaybeJson(raw)
  if (!isRecord(parsed)) return null

  const localName = normalizePlayerIdentityValue(session.localPlayerName)
  const localTagLine = normalizePlayerIdentityValue(session.localPlayerTagLine)
  let tagLineMatchOutcome: PlayerCombatOutcome | null = null

  for (const [playerName, playerOutcome] of Object.entries(parsed)) {
    if (!isRecord(playerOutcome)) continue

    const outcome = normalizeOutcomeValue(playerOutcome['outcome'])
    if (!outcome) continue

    if (localName && normalizePlayerIdentityValue(playerName) === localName) {
      return outcome
    }

    const tagLine = normalizePlayerIdentityValue(readStringFromRaw(playerOutcome['tag_line']))
    if (localTagLine && tagLine === localTagLine) {
      tagLineMatchOutcome = outcome
    }
  }

  return tagLineMatchOutcome
}

function handleInfoUpdate(infoUpdate: overwolf.games.events.InfoUpdates2Event): void {
  describeInfoUpdate(infoUpdate)

  const localSummonerName = readLocalSummonerName(infoUpdate)
  if (localSummonerName) updateLocalPlayerIdentity({ name: localSummonerName })

  const rosterLocalPlayer = readRosterLocalPlayerIdentity(infoUpdate)
  if (rosterLocalPlayer) updateLocalPlayerIdentity(rosterLocalPlayer)

  const roundInfo = readRoundInfo(infoUpdate)
  if (roundInfo) handleRoundInfoUpdate(roundInfo)

  const roundOutcome = readRoundOutcomeForLocalPlayer(infoUpdate)
  if (roundOutcome) handleRoundOutcomeUpdate(roundOutcome)

  const pickedAugment = readPickedAugmentSnapshot(infoUpdate)
  const augmentSnapshot = readAugmentSnapshot(infoUpdate)
  if (augmentSnapshot) {
    handleAugmentUpdate(augmentSnapshot, {
      pickedAugmentInSameUpdate: pickedAugment !== null,
    })
  }

  if (pickedAugment) handlePickedAugmentUpdate(pickedAugment)

  const pickedGodFavor = readGodPickedFavor(infoUpdate)
  if (pickedGodFavor) handleGodPickedFavorUpdate(pickedGodFavor)

  const shopSnapshot = readShopSnapshot(infoUpdate)
  if (shopSnapshot) handleShopUpdate(shopSnapshot)

  const nextGold = readGold(infoUpdate)
  const nextXp = readXp(infoUpdate)
  if (nextGold !== null || nextXp !== null) handleEconomyUpdate(nextGold, nextXp)

  const nextRank = readRank(infoUpdate)
  if (nextRank !== null && nextRank !== run.rank) {
    run.rank = nextRank
    broadcastState()
  }

  const boardSnapshot = readBoardSnapshot(infoUpdate)
  if (boardSnapshot) round.latestBoard = boardSnapshot
}

function handleNewEvents(newEvents: overwolf.games.events.NewGameEvents): void {
  for (const event of newEvents.events ?? []) {
    logGep('GEP new event', { name: event.name })

    switch (event.name) {
      case 'shop_visible':
        handleShopVisibleUpdate((event as unknown as UnknownRecord)['data'])
        break
      case 'match_start':
        resetMatchDetectionState()
        console.log('GEP match_start: detection state reset')
        broadcastState()
        break
      case 'round_start':
        handleRoundStart()
        break
      case 'round_end':
        handleRoundEnd()
        break
      case 'battle_start':
        handleBattleStart()
        break
      case 'battle_end':
        handleBattleEnd()
        break
      case 'match_end':
        handleMatchEnd()
        break
    }
  }
}

function registerListeners(): void {
  if (hasRegisteredListeners) return
  hasRegisteredListeners = true

  overwolf.games.events.onInfoUpdates2.removeListener(handleInfoUpdate)
  overwolf.games.events.onInfoUpdates2.addListener(handleInfoUpdate)
  overwolf.games.events.onNewEvents.removeListener(handleNewEvents)
  overwolf.games.events.onNewEvents.addListener(handleNewEvents)

  console.log('GEP listeners registered')
}

// The app can start mid-match; getInfo provides the values the info updates would have set
function bootstrapGepState(): void {
  overwolf.games.events.getInfo((result) => {
    if (!result.success) {
      console.warn('GEP getInfo bootstrap failed:', result.error)
      return
    }

    const info = result.res
    logGep('GEP getInfo bootstrap shape', summarizeGetInfoShape(info))
    logGep('GEP getInfo environment', summarizeGepEnvironment(info))

    const shopRaw = readInfoValueFromRecord(info, 'store', 'shop_pieces')
    const shopSnapshot = shopRaw ? readNameSlots(shopRaw, 'slot', SHOP_SLOT_COUNT) : null
    if (shopSnapshot) {
      shop.latest = shopSnapshot
      shop.baseline = [...shopSnapshot]
      if (!round.hasSeenPlanningPhaseEvent) {
        round.isInPlanningPhase = true
        logGep('GEP planning phase inferred from bootstrap shop snapshot')
      }
      if (round.isInPlanningPhase) {
        inferShopVisibleFromShopData('bootstrap shop snapshot', shopSnapshot)
      }
    }

    const boardRaw = readInfoValueFromRecord(info, 'board', 'board_pieces')
    if (boardRaw) {
      const boardSnapshot = parseMaybeJson(boardRaw)
      if (isRecord(boardSnapshot)) round.latestBoard = boardSnapshot
    }

    const bootstrappedGold = readNumberFromRaw(readInfoValueFromRecord(info, 'me', 'gold'))
    if (bootstrappedGold !== null) economy.gold = bootstrappedGold

    const bootstrappedRank = readNumberFromRaw(readInfoValueFromRecord(info, 'me', 'rank'))
    if (bootstrappedRank !== null) run.rank = bootstrappedRank

    const bootstrappedSummonerName = readStringFromRaw(readInfoValueFromRecord(info, 'me', 'summoner_name'))
    if (bootstrappedSummonerName) updateLocalPlayerIdentity({ name: bootstrappedSummonerName })

    const rosterRaw = readInfoValueFromRecord(info, 'roster', 'player_status')
    const bootstrappedRosterIdentity = readRosterLocalPlayerIdentityFromRaw(rosterRaw)
    if (bootstrappedRosterIdentity) updateLocalPlayerIdentity(bootstrappedRosterIdentity)

    const roundTypeData = parseMaybeJson(readInfoValueFromRecord(info, 'match_info', 'round_type'))
    if (isRecord(roundTypeData) && typeof roundTypeData['type'] === 'string') {
      round.info = {
        type: roundTypeData['type'],
        name: typeof roundTypeData['name'] === 'string' ? roundTypeData['name'] : null,
        nativeName: typeof roundTypeData['native_name'] === 'string' ? roundTypeData['native_name'] : null,
        stage: typeof roundTypeData['stage'] === 'string' ? roundTypeData['stage'] : null,
      }
      round.type = round.info.type
    }

    const xpRaw = readInfoValueFromRecord(info, 'me', 'xp')
    const meRaw = readInfoValueFromRecord(info, 'me', 'me')
    const bootstrappedXp = readXpFromRaw(xpRaw) ?? readXpFromRaw(meRaw)
    if (bootstrappedXp) economy.xp = bootstrappedXp

    const parsedMe = parseMaybeJson(meRaw)
    logGep('GEP me bootstrap values', {
      gold: economy.gold,
      xp: economy.xp,
      rank: run.rank,
      localPlayerName: session.localPlayerName,
      localPlayerTagLine: session.localPlayerTagLine,
      meKeys: isRecord(parsedMe) ? Object.keys(parsedMe) : [],
    })
    broadcastState()
  })
}

export function startGepSource(attempt = 1): void {
  overwolf.games.events.setRequiredFeatures(
    GEP_REQUIRED_FEATURES,
    (result) => {
      if (result.success) {
        logGep('GEP features registered successfully', { supportedFeatures: result.supportedFeatures })
        registerListeners()
        bootstrapGepState()
      } else {
        console.error('setRequiredFeatures failed:', result.error)
        if (attempt < MAX_GEP_FEATURE_REGISTRATION_ATTEMPTS) {
          window.setTimeout(() => startGepSource(attempt + 1), GEP_FEATURE_RETRY_DELAY_MS)
        }
      }
    },
  )
}
