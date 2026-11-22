import { type LocationCheck } from '../data/locations'
import traitsData from '../data/traits.json'
import type { ClientBoardTrait, ClientMatchResult } from './client-match'
import { isRecord, readNumberFromRaw } from './raw'
import type {
  BoardSnapshot,
  BoardUnit,
  LocationValidationContext,
  TraitsData,
  UnknownRecord,
} from './types'

export const championTraits = (traitsData as TraitsData).champions ?? {}
export const championCosts = (traitsData as TraitsData).championCosts ?? {}
export const traitBreakpoints = (traitsData as TraitsData).traitBreakpoints ?? {}
export const itemGrantedTraits = (traitsData as TraitsData).items ?? {}
const traitDisplayNames = (traitsData as TraitsData).traitNames ?? {}
const championAliases = (traitsData as TraitsData).championAliases ?? {}

const AVATAR_TRAIT = 'Avatar'

// "Lux on your board" accepts every Lux form; Adaptor (_AD/_AP) and transforming forms (Gnar)
// normalize to the id listed in traits.json
export function getCanonicalChampionId(championId: string): string {
  const aliased = championAliases[championId]
  if (aliased) return aliased
  if (championCosts[championId] !== undefined) return championId

  const base = championId.replace(/_?(?:AD|AP|Big|Large|Mega|Small)$/i, '')
  const known = [`${base}_AD`, `${base}_AP`, `${base}Small`, base].find(candidate => championCosts[candidate] !== undefined)
  return known ? (championAliases[known] ?? known) : championId
}

// Resolve traits from the specific form first (e.g. DA_18_Lux_Inferno -> ['Avatar', 'Inferno']),
// then fall back to the canonical id (e.g. DA_18_Akali_AP -> DA_18_Akali_AD, DA_18_GnarBig -> DA_18_GnarSmall)
function getChampionBaseTraits(championId: string): string[] {
  return championTraits[championId] ?? championTraits[getCanonicalChampionId(championId)] ?? []
}

// Count trait contributions from unique canonical champions + Avatar doubling + emblems
function countBoardTraits(units: { championId: string; itemIds: string[] }[]): Map<string, number> {
  const championsByTrait = new Map<string, Set<string>>()
  const avatarBonusByTrait = new Map<string, Set<string>>()
  const emblemsByTrait = new Map<string, number>()

  for (const unit of units) {
    const championId = getCanonicalChampionId(unit.championId)
    const baseTraits = getChampionBaseTraits(unit.championId)
    const isAvatar = baseTraits.includes(AVATAR_TRAIT)

    for (const trait of baseTraits) {
      const champions = championsByTrait.get(trait) ?? new Set<string>()
      champions.add(championId)
      championsByTrait.set(trait, champions)

      // Avatar doubles the champion's chosen origin trait once per unique Avatar champion
      if (isAvatar && trait !== AVATAR_TRAIT) {
        const bonusChampions = avatarBonusByTrait.get(trait) ?? new Set<string>()
        bonusChampions.add(championId)
        avatarBonusByTrait.set(trait, bonusChampions)
      }
    }

    for (const itemId of unit.itemIds) {
      for (const trait of itemGrantedTraits[itemId] ?? []) {
        // An emblem on a unit that already has the trait adds nothing
        if (baseTraits.includes(trait)) continue
        emblemsByTrait.set(trait, (emblemsByTrait.get(trait) ?? 0) + 1)
      }
    }
  }

  const traitNames = new Set([...championsByTrait.keys(), ...emblemsByTrait.keys()])
  const counts = new Map<string, number>()
  for (const name of traitNames) {
    const numUnits = (championsByTrait.get(name)?.size ?? 0)
      + (avatarBonusByTrait.get(name)?.size ?? 0)
      + (emblemsByTrait.get(name) ?? 0)
    counts.set(name, numUnits)
  }
  return counts
}

// The EoG file has no trait counts, so count unique champions + Avatar + emblems like the GEP path
export function computeClientBoardTraits(units: { championId: string; itemIds: string[] }[]): ClientBoardTrait[] {
  return [...countBoardTraits(units).entries()].map(([name, numUnits]) => {
    const breakpoints = traitBreakpoints[name] ?? []
    return {
      name,
      numUnits,
      tierCurrent: breakpoints.filter(breakpoint => numUnits >= breakpoint).length,
      tierTotal: breakpoints.length,
    }
  })
}

export function countNonEmptyBoardPieces(snapshot: BoardSnapshot | null): number {
  if (!snapshot) return 0

  return Object.values(snapshot).filter((piece) => {
    if (!isRecord(piece)) return false
    const name = piece['name']
    return typeof name === 'string' && name.trim() !== ''
  }).length
}

export function readBoardUnits(snapshot: BoardSnapshot | null): BoardUnit[] {
  if (!snapshot) return []

  return Object.entries(snapshot)
    .map(([cellId, piece]) => {
      if (!isRecord(piece)) return null
      const name = piece['name']
      if (typeof name !== 'string' || name.trim() === '') return null
      const starLevel = readNumberFromRaw(piece['level']) ?? 1

      const itemIds = [piece['item_1'], piece['item_2'], piece['item_3']]
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')

      return {
        cellId,
        championId: name,
        starLevel,
        itemIds,
      }
    })
    .filter((unit): unit is BoardUnit => unit !== null)
}

export function getUnitTraits(unit: BoardUnit): Set<string> {
  const traits = new Set(getChampionBaseTraits(unit.championId))

  for (const itemId of unit.itemIds) {
    for (const trait of itemGrantedTraits[itemId] ?? []) {
      traits.add(trait)
    }
  }

  return traits
}

export function getChampionCost(championId: string): number | null {
  const direct = championCosts[championId] ?? championCosts[getCanonicalChampionId(championId)]
  const cost = Number(direct)
  return Number.isFinite(cost) ? cost : null
}

export function countTraitContributors(boardUnits: BoardUnit[]): Record<string, number> {
  return Object.fromEntries(countBoardTraits(boardUnits))
}

export function isTraitActive(trait: string, count: number): boolean {
  const breakpoints = traitBreakpoints[trait] ?? []
  const firstBreakpoint = breakpoints[0]
  return firstBreakpoint !== undefined && count >= firstBreakpoint
}

export function countActiveTraits(boardUnits: BoardUnit[]): number {
  return Object.entries(countTraitContributors(boardUnits))
    .filter(([trait, count]) => isTraitActive(trait, count))
    .length
}

export function isLocationCheckSatisfied(location: LocationCheck, context: LocationValidationContext): boolean {
  const boardUnits = readBoardUnits(context.snapshot)
  const condition = location.condition

  switch (condition.type) {
    case 'champion':
      if (condition.requiresPlayerCombat && !context.isPlayerCombat) return false
      return boardUnits.some(unit => (
        getCanonicalChampionId(unit.championId) === condition.championId
        && unit.starLevel >= (condition.minimumStarLevel ?? 1)
      ))
    case 'trait':
      return (countTraitContributors(boardUnits)[condition.trait] ?? 0) >= condition.minimumActive
    case 'unit':
      if (condition.requiresPlayerCombat && !context.isPlayerCombat) return false
      return boardUnits.some(unit => (
        getChampionCost(unit.championId) === condition.cost
        && unit.starLevel >= condition.minimumStarLevel
      ))
    case 'activeTraitCount':
      if (condition.requiresPlayerCombat && !context.isPlayerCombat) return false
      return countActiveTraits(boardUnits) >= condition.minimumActiveTraits
    case 'gold':
      return context.gold !== null && context.gold >= condition.minimumGold
    case 'playerCombatWins':
      return condition.consecutive
        ? context.playerCombatWinStreak >= condition.minimumWins
        : context.totalPlayerCombatWins >= condition.minimumWins
    case 'level':
      return context.level !== null && context.level >= condition.minimumLevel
    case 'stage':
      return context.stage !== null && context.stage >= condition.minimumStage
  }
}

// 'TFT17_Ornn' (CDragon) vs 'DA_18_Ornn' / 'DA_Riftbeast18' (UE5 history), compare bare names
export function normalizeGameAssetName(id: string): string {
  return id
    .replace(/^(?:TFT|DA)(?:_?\d+)?_/i, '')
    .replace(/\d+$/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

// Match-V5 unit rarity → shop cost
const CLIENT_RARITY_COSTS: Record<number, number> = { 0: 1, 1: 2, 2: 3, 4: 4, 6: 5 }

const normalizedChampionCosts = new Map(
  Object.entries(championCosts).map(([championId, cost]) => [normalizeGameAssetName(championId), Number(cost)]),
)

function getClientUnitCost(unit: ClientMatchResult['units'][number]): number | null {
  if (unit.rarity !== null && CLIENT_RARITY_COSTS[unit.rarity] !== undefined) return CLIENT_RARITY_COSTS[unit.rarity] ?? null
  const direct = getChampionCost(unit.championId)
  if (direct !== null) return direct
  const cost = normalizedChampionCosts.get(normalizeGameAssetName(unit.championId))
  return cost !== undefined && Number.isFinite(cost) ? cost : null
}

// Tocker's Trials: 30 PvE rounds in stages 1-3 with 10 rounds each, and 3 lives
export const TOCKERS_TRIALS_QUEUE_ID = 1220
export const TOCKERS_TRIALS_FINAL_ROUND = 30
const TOCKERS_TRIALS_ROUNDS_PER_STAGE = 10

// Match-V5 last_round counts every round: stage 1 has 4 rounds, later stages 7 (2-1 = round 5).
// Not verified live in Set 18 yet. Tocker's Trials uses 10 rounds per stage and ends at 3-10; the
// log count can read one past the final round, so it is capped there.
export function getStageFromRound(round: number, queueId: number | null = null): number {
  if (queueId === TOCKERS_TRIALS_QUEUE_ID) {
    return Math.ceil(Math.min(round, TOCKERS_TRIALS_FINAL_ROUND) / TOCKERS_TRIALS_ROUNDS_PER_STAGE)
  }
  return round <= 4 ? 1 : Math.floor((round - 5) / 7) + 2
}

// Round count → in-game label, e.g. 5 → "2-1" (Tocker's Trials: 5 → "1-5")
export function formatStageRound(round: number, queueId: number | null = null): string {
  if (queueId === TOCKERS_TRIALS_QUEUE_ID) {
    const cappedRound = Math.min(round, TOCKERS_TRIALS_FINAL_ROUND)
    const stage = getStageFromRound(cappedRound, queueId)
    return `${stage}-${cappedRound - (stage - 1) * TOCKERS_TRIALS_ROUNDS_PER_STAGE}`
  }
  if (round <= 4) return `1-${round}`
  return `${getStageFromRound(round)}-${((round - 5) % 7) + 1}`
}

function matchesChampion(unitChampionId: string, conditionChampionId: string): boolean {
  return getCanonicalChampionId(unitChampionId) === conditionChampionId
    || normalizeGameAssetName(unitChampionId) === normalizeGameAssetName(conditionChampionId)
}

// Riot reports trait api names (DA_18_Slayer); conditions use display names (Ravager)
function matchesTrait(traitApiName: string, conditionTrait: string): boolean {
  const displayName = traitDisplayNames[traitApiName] ?? traitApiName
  return normalizeGameAssetName(displayName) === normalizeGameAssetName(conditionTrait)
    || normalizeGameAssetName(traitApiName) === normalizeGameAssetName(conditionTrait)
}

// Riot's trait counts already include emblems. Live-only conditions never match here.
export function isLocationCheckSatisfiedByClientResult(location: LocationCheck, result: ClientMatchResult): boolean {
  const condition = location.condition

  switch (condition.type) {
    case 'champion': {
      return result.units.some(unit => (
        matchesChampion(unit.championId, condition.championId)
        && unit.starLevel >= (condition.minimumStarLevel ?? 1)
      ))
    }
    case 'trait':
      return result.traits.some(trait => (
        matchesTrait(trait.name, condition.trait) && trait.numUnits >= condition.minimumActive
      ))
    case 'unit':
      return result.units.some(unit => (
        getClientUnitCost(unit) === condition.cost && unit.starLevel >= condition.minimumStarLevel
      ))
    case 'activeTraitCount':
      return result.traits.filter(trait => trait.tierCurrent > 0).length >= condition.minimumActiveTraits
    case 'level':
      return result.level !== null && result.level >= condition.minimumLevel
    case 'stage':
      return result.lastRound !== null && getStageFromRound(result.lastRound, result.queueId) >= condition.minimumStage
    case 'gold':
    case 'playerCombatWins':
      return false
  }
}

export function summarizeBoardTraits(snapshot: BoardSnapshot | null): UnknownRecord {
  const boardUnits = readBoardUnits(snapshot)
  const championIds = new Set(boardUnits.map(unit => unit.championId))
  const traitCounts: Record<string, number> = {}
  const itemTraitCounts: Record<string, number> = {}
  const unmappedChampionIds: string[] = []
  const unmappedItemIds = new Set<string>()
  const units = boardUnits.map((unit) => {
    const baseTraits = getChampionBaseTraits(unit.championId)
    const itemTraits = unit.itemIds.flatMap(itemId => itemGrantedTraits[itemId] ?? [])

    if (baseTraits.length === 0) unmappedChampionIds.push(unit.championId)
    for (const itemId of unit.itemIds) {
      if (!itemGrantedTraits[itemId]) unmappedItemIds.add(itemId)
    }

    return {
      cellId: unit.cellId,
      championId: unit.championId,
      baseTraits,
      itemIds: unit.itemIds,
      itemTraits,
      effectiveTraits: [...getUnitTraits(unit)],
    }
  })

  for (const unit of boardUnits) {
    for (const itemId of unit.itemIds) {
      for (const trait of itemGrantedTraits[itemId] ?? []) {
        itemTraitCounts[trait] = (itemTraitCounts[trait] ?? 0) + 1
      }
    }
  }

  Object.assign(traitCounts, countTraitContributors(boardUnits))

  return {
    championIds: [...championIds],
    traitCounts,
    itemTraitCounts,
    unmappedChampionIds,
    unmappedItemIds: [...unmappedItemIds],
    units,
  }
}
