import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCATION_CHECKS } from '../data/locations'
import type { TftLogEvent } from '../platform/tft-log'
import type { LocationCheck, LocationCondition } from '../data/locations'
import { championTraits, isLocationCheckSatisfiedByClientResult, TOCKERS_TRIALS_QUEUE_ID } from './board'
import {
  ClientMatchTracker,
  type ClientMatchResult,
  type ClientMatchTrackerDeps,
  type PendingClientMatch,
  findMatchHistoryResult,
  getTockersTrialsVictory,
  readEndOfGameBoard,
  readEndOfGamePlacement,
  readEndOfGameResult,
  readGameflowGame,
  readLogGame,
} from './client-match'

const PUUID = 'me-puuid'
const [championId] = Object.entries(championTraits).find(([, traits]) => traits.length > 0)!

function result(overrides: Partial<ClientMatchResult> = {}): ClientMatchResult {
  return {
    gameId: 1,
    queueId: 1100,
    placement: 3,
    level: 8,
    lastRound: 30,
    health: null,
    units: [],
    traits: [],
    ...overrides,
  }
}

function pending(overrides: Partial<PendingClientMatch> = {}): PendingClientMatch {
  return {
    gameId: 1,
    queueId: TOCKERS_TRIALS_QUEUE_ID,
    queueName: "Tocker's Trials",
    sessionStartedAt: 0,
    endedAt: 0,
    isValidRun: true,
    violationReason: null,
    placement: null,
    result: null,
    ...overrides,
  }
}

function check(condition: LocationCondition): LocationCheck {
  return { id: 1, name: 'test', category: 'minor', condition }
}

function historyGame(json: Record<string, unknown>) {
  return { json }
}

describe('readGameflowGame', () => {
  const session = (queue: Record<string, unknown>, gameId: unknown = 42) => ({ gameData: { gameId, queue } })

  it('reads counted TFT queues', () => {
    expect(readGameflowGame(session({ gameMode: 'TFT', id: 1100 }), 5)).toEqual({
      gameId: 42, queueId: 1100, queueName: 'Ranked', isCounted: true, detectedAt: 5,
    })
  })

  it('keeps other TFT queues but does not count them', () => {
    const game = readGameflowGame(session({ gameMode: 'TFT', id: 1160, description: 'Double Up' }), 0)
    expect(game?.isCounted).toBe(false)
    expect(game?.queueName).toBe('Double Up')
  })

  it('ignores other game modes and missing game ids', () => {
    expect(readGameflowGame(session({ gameMode: 'CLASSIC', id: 420 }), 0)).toBeNull()
    expect(readGameflowGame(session({ gameMode: 'TFT', id: 1100 }, 0), 0)).toBeNull()
    expect(readGameflowGame(null, 0)).toBeNull()
  })
})

describe('findMatchHistoryResult', () => {
  const me = {
    puuid: PUUID,
    placement: 2,
    level: 9,
    last_round: 33,
    units: [{ character_id: championId, tier: 2, rarity: 4, itemNames: ['TFT_Item_Bloodthirster', ''] }],
    traits: [{ name: 'DA_18_Slayer', num_units: 4, tier_current: 2, tier_total: 3 }],
  }
  const history = {
    games: [
      historyGame({ game_id: 7, queue_id: 1100, game_datetime: 1000, participants: [{ puuid: 'other', placement: 1 }] }),
      historyGame({ game_id: 8, queue_id: 1100, game_datetime: 2000, participants: [me] }),
    ],
  }

  it('finds the pending game by id', () => {
    const found = findMatchHistoryResult(history, PUUID, { gameId: 8, sessionStartedAt: 0 })
    expect(found).toMatchObject({ gameId: 8, placement: 2, level: 9, lastRound: 33 })
    expect(found?.units).toEqual([{ championId, starLevel: 2, rarity: 4, itemIds: ['TFT_Item_Bloodthirster'] }])
    expect(found?.traits).toEqual([{ name: 'DA_18_Slayer', numUnits: 4, tierCurrent: 2, tierTotal: 3 }])
  })

  it('skips games the player was not in', () => {
    expect(findMatchHistoryResult(history, PUUID, { gameId: 7, sessionStartedAt: 0 })).toBeNull()
  })

  it('falls back to the session start without a game id', () => {
    const started = 2000 + 60_000
    expect(findMatchHistoryResult(history, PUUID, { gameId: null, sessionStartedAt: started })?.gameId).toBe(8)
    // too old for this session
    expect(findMatchHistoryResult(history, PUUID, { gameId: null, sessionStartedAt: 2000 + 60 * 60_000 })).toBeNull()
  })
})

describe('readEndOfGamePlacement', () => {
  it('prefers the local player block', () => {
    expect(readEndOfGamePlacement({ gameId: 3, localPlayer: { placement: 4 } }, null)).toEqual({ gameId: 3, placement: 4 })
  })

  it('finds the player in the list and rejects impossible placements', () => {
    const stats = { gameId: 3, players: [{ puuid: 'x', ffaStanding: 1 }, { puuid: PUUID, ffaStanding: 6 }] }
    expect(readEndOfGamePlacement(stats, PUUID)).toEqual({ gameId: 3, placement: 6 })
    expect(readEndOfGamePlacement({ players: [{ isLocalPlayer: true, placement: 0 }] }, null)).toBeNull()
  })
})

describe('end of game file', () => {
  const file = (players: unknown[]) => ({ gameId: 9, queueId: 1100, statsBlock: { gameLengthSeconds: 1800, players } })
  const mine = {
    PUUID,
    ffaStanding: 3,
    health: 12,
    boardPieces: [{ championName: championId, itemNames: [], starLevel: 3, price: 4 }, { championName: '' }],
  }

  it('reads the board of the matching player', () => {
    const board = readEndOfGameBoard(file([{ PUUID: 'x', ffaStanding: 1 }, mine]), PUUID)
    expect(board).toMatchObject({ gameId: 9, queueId: 1100, placement: 3, health: 12 })
    expect(board?.units).toEqual([{ championId, starLevel: 3, rarity: null, itemIds: [] }])
    expect(board?.traits.length).toBeGreaterThan(0)
  })

  it('uses the only player when the puuid is unknown', () => {
    expect(readEndOfGameBoard(file([mine]), null)?.placement).toBe(3)
    expect(readEndOfGameBoard(file([mine, { PUUID: 'x' }]), null)).toBeNull()
  })

  it('only yields a match result with a final placement', () => {
    expect(readEndOfGameResult(file([mine]), PUUID)?.placement).toBe(3)
    expect(readEndOfGameResult(file([{ ...mine, ffaStanding: 0 }]), PUUID)).toBeNull()
  })
})

describe('getTockersTrialsVictory', () => {
  it('needs the final round and a life left', () => {
    expect(getTockersTrialsVictory(pending({ logRound: 30 }), result({ health: 1, lastRound: null })).isVictory).toBe(true)
    expect(getTockersTrialsVictory(pending({ logRound: 24 }), result({ health: 2, lastRound: null })).isVictory).toBe(false)
  })

  it('fails on a surrender even at the final round', () => {
    expect(getTockersTrialsVictory(pending({ logRound: 30 }), result({ health: -99 })).isVictory).toBe(false)
  })

  it('lets the end of game health win over a later history result', () => {
    const endOfGame = result({ health: 0 })
    expect(getTockersTrialsVictory(pending({ endOfGame }), result({ health: 3, lastRound: 30 })).isVictory).toBe(false)
  })

  it('takes the highest known round', () => {
    const outcome = getTockersTrialsVictory(pending({ logRound: 12, result: result({ lastRound: 30 }) }), result({ lastRound: 20 }))
    expect(outcome.round).toBe(30)
  })

  it('accepts lives left when no round is known yet', () => {
    expect(getTockersTrialsVictory(pending(), result({ health: 1, lastRound: null })).isVictory).toBe(true)
  })

  it('counts the round alone without health', () => {
    expect(getTockersTrialsVictory(pending(), result({ health: null, lastRound: 30 })).isVictory).toBe(true)
    expect(getTockersTrialsVictory(pending(), result({ health: null, lastRound: 29 })).isVictory).toBe(false)
  })
})

describe('isLocationCheckSatisfiedByClientResult', () => {
  const units = [{ championId, starLevel: 2, rarity: 4, itemIds: [] }]

  it('matches champions by star level', () => {
    const condition: LocationCondition = { type: 'champion', championId, minimumStarLevel: 2 }
    expect(isLocationCheckSatisfiedByClientResult(check(condition), result({ units }))).toBe(true)
    expect(isLocationCheckSatisfiedByClientResult(check({ ...condition, minimumStarLevel: 3 }), result({ units }))).toBe(false)
  })

  it('maps Match-V5 rarity to shop cost', () => {
    const condition: LocationCondition = { type: 'unit', cost: 4, minimumStarLevel: 2 }
    expect(isLocationCheckSatisfiedByClientResult(check(condition), result({ units }))).toBe(true)
    expect(isLocationCheckSatisfiedByClientResult(check({ ...condition, cost: 5 }), result({ units }))).toBe(false)
  })

  it('counts active traits only', () => {
    const traits = [
      { name: 'A', numUnits: 2, tierCurrent: 1, tierTotal: 3 },
      { name: 'B', numUnits: 1, tierCurrent: 0, tierTotal: 3 },
    ]
    const condition: LocationCondition = { type: 'activeTraitCount', minimumActiveTraits: 2 }
    expect(isLocationCheckSatisfiedByClientResult(check(condition), result({ traits }))).toBe(false)
    expect(isLocationCheckSatisfiedByClientResult(check({ ...condition, minimumActiveTraits: 1 }), result({ traits }))).toBe(true)
  })

  it('needs history data for level and stage', () => {
    const empty = result({ level: null, lastRound: null })
    expect(isLocationCheckSatisfiedByClientResult(check({ type: 'level', minimumLevel: 8 }), result())).toBe(true)
    expect(isLocationCheckSatisfiedByClientResult(check({ type: 'level', minimumLevel: 8 }), empty)).toBe(false)
    expect(isLocationCheckSatisfiedByClientResult(check({ type: 'stage', minimumStage: 5 }), result({ lastRound: 33 }))).toBe(true)
    expect(isLocationCheckSatisfiedByClientResult(check({ type: 'stage', minimumStage: 5 }), empty)).toBe(false)
  })

  it('never fulfils live-only conditions', () => {
    expect(isLocationCheckSatisfiedByClientResult(check({ type: 'gold', minimumGold: 0 }), result())).toBe(false)
  })
})

// Standalone TFT client (18.6): the League client never sees the match, TFT.log names it
describe('standalone client via TFT.log', () => {
  const GAME_ID = 8039442375
  const ME = 'cd1a3207-c62c-572f-80ab-6f9f2870beb6'
  const BOT = '00000000-0000-0000-0000-000000000000'
  const gameInfo = (overrides: Partial<Extract<TftLogEvent, { type: 'game_info' }>> = {}): TftLogEvent => ({
    type: 'game_info',
    at: '2026.11.08-00.00.44:215',
    gameId: GAME_ID,
    queueId: 1090,
    puuid: ME,
    gameMode: 'TFT',
    gameState: 'IN_PROGRESS',
    ...overrides,
  })
  const eogFile = (standing: number) => ({
    gameId: GAME_ID,
    queueId: 1090,
    statsBlock: {
      players: [
        { PUUID: BOT, boardPieces: [{ championName: championId, itemNames: [], price: 5, starLevel: 3 }], ffaStanding: 1, health: 40 },
        { PUUID: ME, boardPieces: [{ championName: championId, itemNames: ['DA_InfinityEdge'], price: 1, starLevel: 2 }], ffaStanding: standing, health: -99 },
      ],
    },
  })

  function createTracker() {
    const delivered: { pending: PendingClientMatch; result: ClientMatchResult }[] = []
    const deps: ClientMatchTrackerDeps = {
      // no League client running
      get: async () => null,
      readFile: async () => null,
      writeFile: async () => true,
      log: () => {},
      canDeliverResults: () => true,
      deliverResult: (pending, result) => {
        delivered.push({ pending, result })
        return []
      },
      onStatusChanged: () => {},
    }
    const tracker = new ClientMatchTracker(deps)
    const poll = () => (tracker as unknown as { poll(): Promise<void> }).poll()
    return { tracker, delivered, poll }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('takes the running game and puuid from the game-update message', () => {
    const { tracker } = createTracker()
    tracker.handleLogEvents([gameInfo()])
    expect(tracker.getCurrentGame()).toMatchObject({ gameId: GAME_ID, queueId: 1090, queueName: 'Normal', isCounted: true })
    expect(tracker.getCurrentGame()?.detectedAt).toBe(Date.UTC(2026, 10, 8, 0, 0, 44, 215))
    expect(tracker.getPuuid()).toBe(ME)
  })

  it('ignores other modes, finished games and older replayed lines', () => {
    const { tracker } = createTracker()
    expect(readLogGame(gameInfo({ gameMode: 'CLASSIC' }) as Extract<TftLogEvent, { type: 'game_info' }>, 0)).toBeNull()
    expect(readLogGame(gameInfo({ gameState: 'TERMINATED' }) as Extract<TftLogEvent, { type: 'game_info' }>, 0)).toBeNull()
    tracker.handleLogEvents([gameInfo()])
    tracker.handleLogEvents([gameInfo({ gameId: 1, at: '2026.11.07-20.00.00:000' })])
    expect(tracker.getCurrentGame()?.gameId).toBe(GAME_ID)
  })

  it('reads our board from the eight-player file without the League client', () => {
    const { tracker } = createTracker()
    tracker.handleLogEvents([gameInfo()])
    expect(readEndOfGameBoard(eogFile(8), tracker.getPuuid())).toMatchObject({
      gameId: GAME_ID,
      placement: 8,
      health: -99,
      units: [{ championId, starLevel: 2, itemIds: ['DA_InfinityEdge'] }],
    })
  })

  it('fulfils "Field a 2-Star Varus" from the reported 8th-place board', () => {
    const { tracker } = createTracker()
    tracker.handleLogEvents([gameInfo()])
    const file = eogFile(8)
    file.statsBlock.players[1].boardPieces = [{ championName: 'DA_18_Varus', itemNames: ['DA_InfinityEdge'], price: 1, starLevel: 2 }]
    const varus = LOCATION_CHECKS.find(location => location.name === 'Field a 2-Star Varus')!
    const board = readEndOfGameBoard(file, tracker.getPuuid())!
    expect(board.gameId).toBe(tracker.getCurrentGame()?.gameId)
    expect(isLocationCheckSatisfiedByClientResult(varus, { ...board, placement: 8, level: null, lastRound: null })).toBe(true)
  })

  it('files the session result under the game id and delivers the final board', async () => {
    const { tracker, delivered, poll } = createTracker()
    const startedAt = Date.UTC(2026, 10, 7, 23, 59, 0)
    tracker.handleLogEvents([gameInfo(), { type: 'match_start', at: '2026.11.08-00.00.58:272' }])
    tracker.handleEndOfGameStats(eogFile(8))
    tracker.handleLogEvents([{ type: 'match_end', at: '2026.11.08-00.11.58:035' }])

    tracker.queueSessionResult({ sessionStartedAt: startedAt, isValidRun: true, violationReason: null, logRound: 20 })
    expect(tracker.getStatus().pending).toEqual([
      { gameId: GAME_ID, queueName: 'Normal', placement: null, status: 'waiting_for_archipelago' },
    ])

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000)
    await poll()
    expect(delivered).toHaveLength(1)
    expect(delivered[0].pending.gameId).toBe(GAME_ID)
    expect(delivered[0].result).toMatchObject({ gameId: GAME_ID, placement: 8, units: [{ championId, starLevel: 2 }] })
  })

  it('keeps an end-of-game file that arrived before the puuid', async () => {
    const { tracker, poll } = createTracker()
    tracker.handleEndOfGameStats(eogFile(3))
    tracker.handleLogEvents([gameInfo()])
    await poll()
    tracker.queueSessionResult({ sessionStartedAt: Date.UTC(2026, 10, 7, 23, 59, 0), isValidRun: true, violationReason: null, logRound: null })
    expect(tracker.getStatus().pending[0]).toMatchObject({ gameId: GAME_ID, status: 'waiting_for_archipelago' })
  })

  it('restores the run when the log shows the same match running again', () => {
    const { tracker } = createTracker()
    const startedAt = Date.UTC(2026, 10, 7, 23, 59, 0)
    tracker.handleLogEvents([gameInfo(), { type: 'match_start', at: '2026.11.08-00.00.58:272' }])
    tracker.queueSessionResult({ sessionStartedAt: startedAt, isValidRun: false, violationReason: 'test', logRound: 5 })
    // crashed mid-match: no EndOfGame line before the new process logs the game again
    tracker.handleLogEvents([gameInfo({ at: '2026.11.08-00.05.00:000' }), { type: 'match_start', at: '2026.11.08-00.05.10:000' }])
    expect(tracker.takeReconnectSession()).toMatchObject({ gameId: GAME_ID, isValidRun: false, sessionStartedAt: startedAt })

    tracker.queueSessionResult({ sessionStartedAt: startedAt, isValidRun: true, violationReason: null, logRound: 30 })
    tracker.handleLogEvents([{ type: 'match_end', at: '2026.11.08-00.11.58:035' }])
    expect(tracker.takeReconnectSession()).toBeNull()
  })
})
