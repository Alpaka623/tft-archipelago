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

// "Lux on your board" accepts every Lux form
export function getCanonicalChampionId(championId: string): string {
  const aliased = championAliases[championId]
  if (aliased) return aliased
  if (championCosts[championId] !== undefined) return championId

  // Adaptor champions switch between _AD and _AP forms in game (log: DA_18_Akali_AP), while the
  // data lists one form (DA_18_Akali_AD)
  const base = championId.replace(/_(?:AD|AP)$/i, '')
  if (base === championId) return championId
  const known = [`${base}_AD`, `${base}_AP`, base].find(candidate => championCosts[candidate] !== undefined)
  return known ? (championAliases[known] ?? known) : championId
}

// The EoG file has no trait counts, so count unique champions + emblems like the GEP path
export function computeClientBoardTraits(units: { championId: string; itemIds: string[] }[]): ClientBoardTrait[] {
  const championsByTrait = new Map<string, Set<string>>()
  const emblemsByTrait = new Map<string, number>()

  for (const unit of units) {
    const championId = getCanonicalChampionId(unit.championId)
    for (const trait of championTraits[championId] ?? championTraits[unit.championId] ?? []) {
      const champions = championsByTrait.get(trait) ?? new Set<string>()
      champions.add(championId)
      championsByTrait.set(trait, champions)
    }
    for (const itemId of unit.itemIds) {
      for (const trait of itemGrantedTraits[itemId] ?? []) {
        // An emblem on a unit that already has the trait adds nothing
        if ((championTraits[championId] ?? []).includes(trait)) continue
        emblemsByTrait.set(trait, (emblemsByTrait.get(trait) ?? 0) + 1)
      }
    }
  }

  const traitNames = new Set([...championsByTrait.keys(), ...emblemsByTrait.keys()])
  return [...traitNames].map((name) => {
    const numUnits = (championsByTrait.get(name)?.size ?? 0) + (emblemsByTrait.get(name) ?? 0)
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
  const traits = new Set(championTraits[unit.championId] ?? [])

  for (const itemId of unit.itemIds) {
    for (const trait of itemGrantedTraits[itemId] ?? []) {
      traits.add(trait)
    }
  }

  return traits
}

export function getChampionCost(championId: string): number | null {
  const cost = Number(championCosts[championId])
  return Number.isFinite(cost) ? cost : null
}

export function countTraitContributors(boardUnits: BoardUnit[]): Record<string, number> {
  const uniqueChampionTraits = new Map<string, Set<string>>()

  for (const unit of boardUnits) {
    uniqueChampionTraits.set(unit.championId, getUnitTraits(unit))
  }

  const counts: Record<string, number> = {}
  for (const traits of uniqueChampionTraits.values()) {
    for (const trait of traits) {
      counts[trait] = (counts[trait] ?? 0) + 1
    }
  }

  return counts
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
    case 'trait': {
      const uniqueContributors = new Set<string>()

      for (const unit of boardUnits) {
        if (getUnitTraits(unit).has(condition.trait)) {
          uniqueContributors.add(unit.championId)
        }
      }

      return uniqueContributors.size >= condition.minimumActive
    }
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
    // Only the match history knows eliminations
    case 'playersEliminated':
      return false
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
    case 'playersEliminated':
      return result.playersEliminated !== null && result.playersEliminated >= condition.minimumPlayers
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
    const baseTraits = championTraits[unit.championId]
    const itemTraits = unit.itemIds.flatMap(itemId => itemGrantedTraits[itemId] ?? [])

    if (!baseTraits) unmappedChampionIds.push(unit.championId)
    for (const itemId of unit.itemIds) {
      if (!itemGrantedTraits[itemId]) unmappedItemIds.add(itemId)
    }

    return {
      cellId: unit.cellId,
      championId: unit.championId,
      baseTraits: baseTraits ?? [],
      itemIds: unit.itemIds,
      itemTraits,
      effectiveTraits: [...getUnitTraits(unit)],
    }
  })

  const uniqueChampionTraits = new Map<string, Set<string>>()
  for (const unit of boardUnits) {
    uniqueChampionTraits.set(unit.championId, getUnitTraits(unit))
    for (const itemId of unit.itemIds) {
      for (const trait of itemGrantedTraits[itemId] ?? []) {
        itemTraitCounts[trait] = (itemTraitCounts[trait] ?? 0) + 1
      }
    }
  }

  for (const traits of uniqueChampionTraits.values()) {
    for (const trait of traits) {
      traitCounts[trait] = (traitCounts[trait] ?? 0) + 1
    }
  }

  return {
    championIds: [...championIds],
    traitCounts,
    itemTraitCounts,
    unmappedChampionIds,
    unmappedItemIds: [...unmappedItemIds],
    units,
  }
}
