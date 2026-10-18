import { describe, expect, it } from 'vitest'
import type { LocationCheck, LocationCondition } from '../data/locations'
import {
  championTraits,
  formatStageRound,
  getStageFromRound,
  isLocationCheckSatisfied,
  TOCKERS_TRIALS_QUEUE_ID,
} from './board'
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

  it('never completes elimination checks live', () => {
    expect(isLocationCheckSatisfied(check({ type: 'playersEliminated', minimumPlayers: 1 }), context())).toBe(false)
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
