import { describe, expect, it } from 'vitest'
import type { LocationCheck, LocationCondition } from '../data/locations'
import {
  championTraits,
  computeClientBoardTraits,
  formatStageRound,
  getCanonicalChampionId,
  getStageFromRound,
  isLocationCheckSatisfied,
  isLocationCheckSatisfiedByClientResult,
  TOCKERS_TRIALS_QUEUE_ID,
} from './board'
import type { ClientMatchResult } from './client-match'
import type { BoardSnapshot, LocationValidationContext } from './types'

function check(condition: LocationCondition): LocationCheck {
  return { id: 1, name: 'test', category: 'minor', condition }
}

function context(overrides: Partial<LocationValidationContext> = {}): LocationValidationContext {
  return {
    snapshot: null,
    gold: null,
    totalPlayerCombatWins: 0,
    playerCombatWinStreak: 0,
    isPlayerCombat: false,
    level: null,
    stage: null,
    ...overrides,
  }
}

function board(...units: { name: string; level?: number }[]): BoardSnapshot {
  return Object.fromEntries(units.map((unit, index) => [`cell_${index}`, { name: unit.name, level: unit.level ?? 1 }]))
}

// Any champion with a trait from the current set data, so the test survives set updates
const [championId, traits] = Object.entries(championTraits).find(([, championTraitList]) => championTraitList.length > 0)!
const trait = traits[0]!

describe('isLocationCheckSatisfied', () => {
  it('finds a champion with the required star level', () => {
    const condition: LocationCondition = { type: 'champion', championId, minimumStarLevel: 2 }

    expect(isLocationCheckSatisfied(check(condition), context({ snapshot: board({ name: championId, level: 2 }) }))).toBe(true)
    expect(isLocationCheckSatisfied(check(condition), context({ snapshot: board({ name: championId, level: 1 }) }))).toBe(false)
  })

  it('requires player combat where the check says so', () => {
    const condition: LocationCondition = { type: 'champion', championId, requiresPlayerCombat: true }
    const snapshot = board({ name: championId })

    expect(isLocationCheckSatisfied(check(condition), context({ snapshot }))).toBe(false)
    expect(isLocationCheckSatisfied(check(condition), context({ snapshot, isPlayerCombat: true }))).toBe(true)
  })

  it('counts each champion only once for a trait', () => {
    const condition: LocationCondition = { type: 'trait', trait, minimumActive: 2 }
    const duplicates = board({ name: championId }, { name: championId })

    expect(isLocationCheckSatisfied(check(condition), context({ snapshot: duplicates }))).toBe(false)
    expect(isLocationCheckSatisfied(check({ ...condition, minimumActive: 1 }), context({ snapshot: duplicates }))).toBe(true)
  })

  it('compares gold, level and stage with the live values', () => {
    expect(isLocationCheckSatisfied(check({ type: 'gold', minimumGold: 50 }), context({ gold: 50 }))).toBe(true)
    expect(isLocationCheckSatisfied(check({ type: 'gold', minimumGold: 50 }), context())).toBe(false)
    expect(isLocationCheckSatisfied(check({ type: 'level', minimumLevel: 8 }), context({ level: 7 }))).toBe(false)
    expect(isLocationCheckSatisfied(check({ type: 'stage', minimumStage: 4 }), context({ stage: 4 }))).toBe(true)
  })

  it('distinguishes total wins from win streaks', () => {
    const live = context({ totalPlayerCombatWins: 5, playerCombatWinStreak: 2 })

    expect(isLocationCheckSatisfied(check({ type: 'playerCombatWins', minimumWins: 5, consecutive: false }), live)).toBe(true)
    expect(isLocationCheckSatisfied(check({ type: 'playerCombatWins', minimumWins: 3, consecutive: true }), live)).toBe(false)
  })
})

describe('stage and round numbers', () => {
  it('maps round counts to stages: four rounds in stage 1, seven after', () => {
    expect([1, 4, 5, 11, 12].map(round => getStageFromRound(round))).toEqual([1, 1, 2, 2, 3])
    expect([1, 4, 5, 11, 12].map(round => formatStageRound(round))).toEqual(['1-1', '1-4', '2-1', '2-7', '3-1'])
  })

  it('uses ten rounds per stage in Tocker\'s Trials and caps at 3-10', () => {
    expect(formatStageRound(5, TOCKERS_TRIALS_QUEUE_ID)).toBe('1-5')
    expect(formatStageRound(11, TOCKERS_TRIALS_QUEUE_ID)).toBe('2-1')
    expect(formatStageRound(31, TOCKERS_TRIALS_QUEUE_ID)).toBe('3-10')
    expect(getStageFromRound(31, TOCKERS_TRIALS_QUEUE_ID)).toBe(3)
  })
})

describe('Lux (Avatar) and transforming champion forms', () => {
  function clientResult(units: { championId: string; starLevel?: number; itemIds?: string[] }[]): ClientMatchResult {
    const normalized = units.map(unit => ({
      championId: unit.championId,
      starLevel: unit.starLevel ?? 1,
      rarity: null,
      itemIds: unit.itemIds ?? [],
    }))
    return {
      gameId: 1,
      queueId: 1100,
      placement: 1,
      level: 8,
      lastRound: 30,
      health: 20,
      units: normalized,
      traits: computeClientBoardTraits(normalized),
    }
  }

  it('counts Lux variant origin traits twice via Avatar without losing the origin to the base alias', () => {
    const faeTraits = computeClientBoardTraits([{ championId: 'DA_18_Lux_Fae', itemIds: [] }])
    expect(faeTraits.find(entry => entry.name === 'Fae')).toMatchObject({ numUnits: 2, tierCurrent: 1 })
    expect(faeTraits.find(entry => entry.name === 'Avatar')).toMatchObject({ numUnits: 1, tierCurrent: 1 })

    const infernoResult = clientResult([
      { championId: 'DA_18_Lux_Inferno' },
      { championId: 'DA_18_Akali_AP' },
      { championId: 'DA_18_Kennen' },
      { championId: 'DA_18_Shen' },
      { championId: 'DA_18_Varus' },
    ])
    expect(infernoResult.traits.find(entry => entry.name === 'Inferno')?.numUnits).toBe(6)
    expect(isLocationCheckSatisfiedByClientResult(
      check({ type: 'trait', trait: 'Inferno', minimumActive: 5 }),
      infernoResult,
    )).toBe(true)
    expect(isLocationCheckSatisfiedByClientResult(
      check({ type: 'champion', championId: 'DA_Lux18_Base' }),
      infernoResult,
    )).toBe(true)
  })

  it('does not double-count duplicate Lux copies and handles emblems on Lux accurately', () => {
    const duplicateLux = computeClientBoardTraits([
      { championId: 'DA_18_Lux_Inferno', itemIds: ['DA_18_EmblemInferno', 'DA_18_EmblemBrawler'] },
      { championId: 'DA_18_Lux_Inferno', itemIds: [] },
    ])
    expect(duplicateLux.find(entry => entry.name === 'Inferno')?.numUnits).toBe(2)
    expect(duplicateLux.find(entry => entry.name === 'Brawler')?.numUnits).toBe(1)
  })

  it('applies Avatar doubling in GEP board validation too', () => {
    const snapshot = board({ name: 'DA_18_Lux_Fae' })
    expect(isLocationCheckSatisfied(check({ type: 'trait', trait: 'Fae', minimumActive: 2 }), context({ snapshot }))).toBe(true)
  })

  it('normalizes Mega Gnar forms to DA_18_GnarSmall for champion, cost and Brawler checks', () => {
    expect(getCanonicalChampionId('DA_18_GnarBig')).toBe('DA_18_GnarSmall')
    expect(getCanonicalChampionId('DA_18_GnarMega')).toBe('DA_18_GnarSmall')
    expect(getCanonicalChampionId('DA_18_Gnar')).toBe('DA_18_GnarSmall')

    const brawlerResult = clientResult([
      { championId: 'DA_18_GnarBig', starLevel: 2 },
      { championId: 'DA_18_Alistar' },
      { championId: 'DA_18_Kobuko' },
      { championId: 'DA_18_Sett' },
    ])
    expect(brawlerResult.traits.find(entry => entry.name === 'Brawler')?.numUnits).toBe(4)
    expect(isLocationCheckSatisfiedByClientResult(
      check({ type: 'trait', trait: 'Brawler', minimumActive: 4 }),
      brawlerResult,
    )).toBe(true)
    expect(isLocationCheckSatisfiedByClientResult(
      check({ type: 'champion', championId: 'DA_18_GnarSmall' }),
      brawlerResult,
    )).toBe(true)
    expect(isLocationCheckSatisfiedByClientResult(
      check({ type: 'unit', cost: 5, minimumStarLevel: 2 }),
      brawlerResult,
    )).toBe(true)
  })
})
