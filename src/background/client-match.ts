import type { ClientApiResponse } from '../platform/types'
import { computeClientBoardTraits, TOCKERS_TRIALS_FINAL_ROUND, TOCKERS_TRIALS_QUEUE_ID } from './board'
import { isRecord, readNumberFromRaw } from './raw'

// Match start, placement and final board via the LCU (Electron). Live events come from src/vision.

// from /lol-game-queues/v1/queues
export const COUNTED_TFT_QUEUES: Record<number, string> = {
  1090: 'Normal',
  1100: 'Ranked',
  1220: "Tocker's Trials",
}

// Tocker's Trials always reports placement 1, so majors need a win instead: reach 3-10 with a
// life left. Surrender writes health -99 to TFTEoGStats.json.

const IN_GAME_PHASES = new Set(['InProgress', 'Reconnect'])
const PHASE_POLL_INTERVAL_MS = 2000
const RESULT_POLL_INTERVAL_MS = 15000
// history only lists a game once the whole lobby is done
const RESULT_TIMEOUT_MS = 2 * 60 * 60 * 1000
const HISTORY_PAGE_SIZE = 5
const END_OF_GAME_SETTLE_MS = 4000
// no game id (client was down at match start): history game must end after our session started
const SESSION_MATCH_TOLERANCE_MS = 5 * 60 * 1000
// InProgress already shows during the loading screen
const GAME_DETECTION_LEAD_MS = 10 * 60 * 1000
export const PENDING_CLIENT_MATCHES_PATH = 'TFTArchipelago/pending-client-matches.json'

export interface ClientGameInfo {
  gameId: number
  queueId: number | null
  queueName: string
  isCounted: boolean
  detectedAt: number
}

export interface ClientBoardUnit {
  championId: string
  starLevel: number
  rarity: number | null
  itemIds: string[]
}

export interface ClientBoardTrait {
  name: string
  numUnits: number
  tierCurrent: number
  tierTotal: number
}

export interface ClientMatchResult {
  gameId: number
  queueId: number | null
  placement: number
  level: number | null
  lastRound: number | null
  playersEliminated: number | null
  // from TFTEoGStats.json (lives in Tocker's Trials), null from match history
  health: number | null
  units: ClientBoardUnit[]
  traits: ClientBoardTrait[]
}

// persisted so a restart doesn't lose it
export interface PendingClientMatch {
  gameId: number | null
  queueId: number | null
  queueName: string
  sessionStartedAt: number
  endedAt: number
  isValidRun: boolean
  violationReason: string | null
  placement: number | null
  result: ClientMatchResult | null
  // TFTEoGStats.json board, arrives first. History later only adds level, rounds, eliminations.
  endOfGame?: ClientMatchResult | null
  endOfGameDelivered?: boolean
  // TFT.log round count at session end
  logRound?: number | null
}

export type ClientPendingStatus =
  | 'waiting_for_lobby'
  | 'waiting_for_result'
  | 'waiting_for_archipelago'

export interface ClientMatchStatus {
  connected: boolean
  phase: string | null
  currentGame: ClientGameInfo | null
  pending: { gameId: number | null; queueName: string; placement: number | null; status: ClientPendingStatus }[]
  lastOutcome: ClientMatchOutcome | null
}

export interface ClientMatchOutcome {
  gameId: number | null
  queueName: string
  placement: number | null
  // 'evaluated': majors (Top 4, or a Tocker's Trials victory) and minors were evaluated, possibly none fulfilled
  kind: 'evaluated' | 'not_counted' | 'invalid_run' | 'timed_out'
  fulfilledLocationIds: number[]
  finishedAt: number
}

export interface ClientMatchTrackerDeps {
  get(apiPath: string): Promise<ClientApiResponse | null>
  readFile(relativePath: string): Promise<string | null>
  writeFile(relativePath: string, content: string): Promise<boolean>
  log(message: string, data?: unknown): void
  canDeliverResults(): boolean
  deliverResult(pending: PendingClientMatch, result: ClientMatchResult): number[]
  onStatusChanged(): void
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function readGameflowGame(session: unknown, detectedAt: number): ClientGameInfo | null {
  if (!isRecord(session)) return null
  const gameData = isRecord(session['gameData']) ? session['gameData'] : null
  const queue = gameData && isRecord(gameData['queue']) ? gameData['queue'] : null
  const gameMode = readString(queue?.['gameMode'])
  const gameId = readNumberFromRaw(gameData?.['gameId'])
  if (gameMode !== 'TFT' || gameId === null || gameId <= 0) return null

  const queueId = readNumberFromRaw(queue?.['id'])
  const countedName = queueId !== null ? COUNTED_TFT_QUEUES[queueId] : undefined
  return {
    gameId,
    queueId,
    queueName: countedName ?? readString(queue?.['description']) ?? readString(queue?.['type']) ?? 'Unknown',
    isCounted: countedName !== undefined,
    detectedAt,
  }
}

function readUnits(raw: unknown): ClientBoardUnit[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((unit) => ({
    championId: readString(unit['character_id']) ?? '',
    starLevel: readNumberFromRaw(unit['tier']) ?? 1,
    rarity: readNumberFromRaw(unit['rarity']),
    itemIds: Array.isArray(unit['itemNames'])
      ? unit['itemNames'].filter((item): item is string => typeof item === 'string' && item !== '')
      : [],
  })).filter(unit => unit.championId !== '')
}

function readTraits(raw: unknown): ClientBoardTrait[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((trait) => ({
    name: readString(trait['name']) ?? '',
    numUnits: readNumberFromRaw(trait['num_units']) ?? 0,
    tierCurrent: readNumberFromRaw(trait['tier_current']) ?? 0,
    tierTotal: readNumberFromRaw(trait['tier_total']) ?? 0,
  })).filter(trait => trait.name !== '')
}

// /lol-match-history/v1/products/tft/{puuid}/matches, Match-V5 shaped
export function findMatchHistoryResult(
  history: unknown,
  puuid: string,
  pending: Pick<PendingClientMatch, 'gameId' | 'sessionStartedAt'>,
): ClientMatchResult | null {
  const games = isRecord(history) && Array.isArray(history['games']) ? history['games'] : []
  for (const game of games) {
    const info = isRecord(game) && isRecord(game['json']) ? game['json'] : null
    if (!info) continue

    const gameId = readNumberFromRaw(info['game_id']) ?? readNumberFromRaw(info['gameId'])
    if (gameId === null) continue
    if (pending.gameId !== null) {
      if (gameId !== pending.gameId) continue
    } else {
      const gameDatetime = readNumberFromRaw(info['game_datetime'])
      if (gameDatetime === null || gameDatetime < pending.sessionStartedAt - SESSION_MATCH_TOLERANCE_MS) continue
    }

    const participants = Array.isArray(info['participants']) ? info['participants'].filter(isRecord) : []
    const me = participants.find(participant => participant['puuid'] === puuid)
    const placement = readNumberFromRaw(me?.['placement'])
    if (!me || placement === null) continue

    return {
      gameId,
      queueId: readNumberFromRaw(info['queue_id']) ?? readNumberFromRaw(info['queueId']),
      placement,
      level: readNumberFromRaw(me['level']),
      lastRound: readNumberFromRaw(me['last_round']),
      playersEliminated: readNumberFromRaw(me['players_eliminated']),
      health: null,
      units: readUnits(me['units']),
      traits: readTraits(me['traits']),
    }
  }
  return null
}

// /lol-end-of-game/v1/tft-eog-stats - haven't seen a real response yet, so be defensive
export function readEndOfGamePlacement(stats: unknown, puuid: string | null): { gameId: number | null; placement: number } | null {
  if (!isRecord(stats)) return null
  const gameId = readNumberFromRaw(stats['gameId'])
  const readPlacement = (player: Record<string, unknown>) => (
    readNumberFromRaw(player['placement']) ?? readNumberFromRaw(player['ffaStanding'])
  )

  if (isRecord(stats['localPlayer'])) {
    const placement = readPlacement(stats['localPlayer'])
    if (placement !== null && placement >= 1 && placement <= 8) return { gameId, placement }
  }
  const players = Array.isArray(stats['players']) ? stats['players'].filter(isRecord) : []
  const me = players.find(player => player['isLocalPlayer'] === true || (puuid !== null && player['puuid'] === puuid))
  const placement = me ? readPlacement(me) : null
  return placement !== null && placement >= 1 && placement <= 8 ? { gameId, placement } : null
}

// TFTEoGStats.json, rewritten after every round and at game end:
// { gameId, queueId, statsBlock: { gameLengthSeconds, players: [{ PUUID, ffaStanding, health,
//   boardPieces: [{ championName, itemNames, starLevel, price }] }] } }
// boardPieces = board only, no bench. No level/rounds/eliminations in there.
export interface EndOfGameBoard {
  gameId: number
  queueId: number | null
  placement: number | null
  // -99 after a surrender
  health: number | null
  units: ClientBoardUnit[]
  traits: ClientBoardTrait[]
}

export function readEndOfGameBoard(stats: unknown, puuid: string | null): EndOfGameBoard | null {
  if (!isRecord(stats)) return null
  const gameId = readNumberFromRaw(stats['gameId'])
  const statsBlock = isRecord(stats['statsBlock']) ? stats['statsBlock'] : null
  const players = Array.isArray(statsBlock?.['players']) ? statsBlock['players'].filter(isRecord) : []
  const me = players.find(player => puuid !== null && player['PUUID'] === puuid)
    ?? (players.length === 1 ? players[0] : undefined)
  if (gameId === null || !me) return null
  const placement = readNumberFromRaw(me['ffaStanding'])

  const pieces = Array.isArray(me['boardPieces']) ? me['boardPieces'].filter(isRecord) : []
  const units: ClientBoardUnit[] = pieces
    .map(piece => ({
      championId: readString(piece['championName']) ?? '',
      starLevel: readNumberFromRaw(piece['starLevel']) ?? 1,
      rarity: null,
      itemIds: Array.isArray(piece['itemNames']) ? piece['itemNames'].filter((item): item is string => typeof item === 'string') : [],
    }))
    .filter(unit => unit.championId !== '')

  return {
    gameId,
    queueId: readNumberFromRaw(stats['queueId']),
    placement: placement !== null && placement >= 1 && placement <= 8 ? placement : null,
    health: readNumberFromRaw(me['health']),
    units,
    traits: computeClientBoardTraits(units),
  }
}

export function readEndOfGameResult(stats: unknown, puuid: string | null): ClientMatchResult | null {
  const board = readEndOfGameBoard(stats, puuid)
  if (!board || board.placement === null) return null
  return { ...board, placement: board.placement, level: null, lastRound: null, playersEliminated: null }
}

export function isTockersTrialsMatch(pending: PendingClientMatch, result: ClientMatchResult): boolean {
  return (pending.queueId ?? result.queueId) === TOCKERS_TRIALS_QUEUE_ID
}

// Tocker's Trials win = reached 3-10 with a life left.
// Health from the EoG file wins over history (surrender -99 or <= 0 fails). Round comes from TFT.log
// or last_round; quitting mid-run leaves a positive-health file, hence the round check.
// Without the file we only know the round, so losing the last fight at 3-10 still counts.
export function getTockersTrialsVictory(pending: PendingClientMatch, result: ClientMatchResult): {
  isVictory: boolean
  health: number | null
  round: number | null
} {
  const health = pending.endOfGame?.health ?? result.health
  const rounds = [pending.logRound, result.lastRound, pending.result?.lastRound]
    .filter((round): round is number => typeof round === 'number')
  const round = rounds.length > 0 ? Math.max(...rounds) : null
  const reachedFinalRound = round !== null && round >= TOCKERS_TRIALS_FINAL_ROUND
  if (health === null) return { isVictory: reachedFinalRound, health, round }
  // no log, no history yet: best we have is a final file with lives left
  return { isVictory: health > 0 && (reachedFinalRound || round === null), health, round }
}

export class ClientMatchTracker {
  private connected = false
  private phase: string | null = null
  private puuid: string | null = null
  private currentGame: ClientGameInfo | null = null
  private pending: PendingClientMatch[] = []
  private lastOutcome: ClientMatchOutcome | null = null
  private lastResultPollAt = 0
  private isPolling = false
  private hasLoadedPending = false
  private readonly finishedGameIds = new Set<number>()
  // EoG files can show up before we notice the session ended
  private readonly endOfGameByGameId = new Map<number, ClientMatchResult>()
  // needs the puuid, which only comes with the client connection
  private unparsedEndOfGameStats: unknown = null

  constructor(private readonly deps: ClientMatchTrackerDeps) {}

  start(): void {
    void this.loadPending().then(() => {
      void this.poll()
      window.setInterval(() => void this.poll(), PHASE_POLL_INTERVAL_MS)
    })
  }

  getStatus(): ClientMatchStatus {
    return {
      connected: this.connected,
      phase: this.phase,
      currentGame: this.currentGame,
      pending: this.pending.filter(entry => !entry.endOfGameDelivered).map(entry => ({
        gameId: entry.gameId,
        queueName: entry.queueName,
        placement: entry.placement,
        status: this.getPendingStatus(entry),
      })),
      lastOutcome: this.lastOutcome,
    }
  }

  getPuuid(): string | null {
    return this.puuid
  }

  getCurrentGame(): ClientGameInfo | null {
    return this.currentGame
  }

  // game process closed, rule state gets frozen here
  // also replayed once at app start for a pending game
  handleEndOfGameStats(stats: unknown): void {
    const result = readEndOfGameResult(stats, this.puuid)
    if (!result && this.puuid === null) {
      this.unparsedEndOfGameStats = stats
      return
    }
    if (!result) return
    this.endOfGameByGameId.set(result.gameId, result)
    const entry = this.pending.find(candidate => candidate.gameId === result.gameId)
    // only a write after the session ended is final
    if (!entry || entry.endOfGameDelivered) return
    entry.endOfGame = result
    void this.savePending()
    this.deps.log('Client match: end-of-game file for a finished game', {
      gameId: result.gameId,
      placement: result.placement,
      health: result.health,
      units: result.units.map(unit => `${unit.championId}*${unit.starLevel}`),
    })
  }

  queueSessionResult(session: {
    sessionStartedAt: number
    isValidRun: boolean
    violationReason: string | null
    logRound: number | null
  }): void {
    // game from an earlier session
    const game = this.currentGame
      && !this.finishedGameIds.has(this.currentGame.gameId)
      && this.currentGame.detectedAt >= session.sessionStartedAt - GAME_DETECTION_LEAD_MS
      ? this.currentGame
      : null
    if (game) this.finishedGameIds.add(game.gameId)
    if (game && !game.isCounted) {
      this.finish({ gameId: game.gameId, queueName: game.queueName, placement: null, kind: 'not_counted', fulfilledLocationIds: [] })
      return
    }
    if (game && this.pending.some(entry => entry.gameId === game.gameId)) return

    const entry: PendingClientMatch = {
      gameId: game?.gameId ?? null,
      queueId: game?.queueId ?? null,
      queueName: game?.queueName ?? 'Unknown',
      sessionStartedAt: session.sessionStartedAt,
      endedAt: Date.now(),
      isValidRun: session.isValidRun,
      violationReason: session.violationReason,
      placement: null,
      result: null,
      endOfGame: game ? this.endOfGameByGameId.get(game.gameId) ?? null : null,
      logRound: session.logRound,
    }
    this.pending.push(entry)
    this.deps.log('Client match: session ended, waiting for result', {
      gameId: entry.gameId,
      queue: entry.queueName,
      isValidRun: entry.isValidRun,
      logRound: entry.logRound,
    })
    this.lastResultPollAt = 0
    void this.savePending()
    this.deps.onStatusChanged()
  }

  // crash/reconnect into the same match keeps the frozen rule state
  takeReconnectSession(): PendingClientMatch | null {
    const game = this.currentGame
    if (!game || !this.phase || !IN_GAME_PHASES.has(this.phase)) return null
    const index = this.pending.findIndex(entry => entry.gameId === game.gameId)
    if (index < 0) return null
    const [entry] = this.pending.splice(index, 1)
    this.finishedGameIds.delete(game.gameId)
    this.deps.log('Client match: reconnected to the same game, rule state restored', { gameId: game.gameId })
    void this.savePending()
    this.deps.onStatusChanged()
    return entry ?? null
  }

  private getPendingStatus(entry: PendingClientMatch): ClientPendingStatus {
    if (entry.result || entry.endOfGame) return 'waiting_for_archipelago'
    if (this.isStillInGame(entry)) return 'waiting_for_lobby'
    return 'waiting_for_result'
  }

  private isStillInGame(entry: PendingClientMatch): boolean {
    return entry.gameId !== null
      && this.currentGame?.gameId === entry.gameId
      && this.phase !== null
      && IN_GAME_PHASES.has(this.phase)
  }

  private async poll(): Promise<void> {
    if (this.isPolling) return
    this.isPolling = true
    try {
      await this.pollPhase()
      await this.processPending()
    } catch (error) {
      this.deps.log('Client match: poll failed', { error: String(error) })
    } finally {
      this.isPolling = false
    }
  }

  private async pollPhase(): Promise<void> {
    const phaseResponse = await this.deps.get('/lol-gameflow/v1/gameflow-phase')
    const connected = phaseResponse !== null && phaseResponse.status === 200
    const phase = connected ? readString(phaseResponse.data) : null
    let changed = connected !== this.connected || phase !== this.phase

    if (connected !== this.connected) {
      this.deps.log(connected ? 'Client match: Riot client connected' : 'Client match: Riot client not reachable')
      if (!connected) this.puuid = null
    }
    if (connected && phase !== this.phase) this.deps.log('Client match: gameflow phase', { phase })
    this.connected = connected
    this.phase = phase

    if (connected && this.puuid === null) {
      const summoner = await this.deps.get('/lol-summoner/v1/current-summoner')
      this.puuid = summoner?.status === 200 && isRecord(summoner.data) ? readString(summoner.data['puuid']) : null
    }

    if (connected && phase !== null && IN_GAME_PHASES.has(phase)) {
      const session = await this.deps.get('/lol-gameflow/v1/session')
      const game = session?.status === 200 ? readGameflowGame(session.data, Date.now()) : null
      if (game && game.gameId !== this.currentGame?.gameId) {
        this.currentGame = game
        changed = true
        this.deps.log('Client match: TFT game detected', {
          gameId: game.gameId,
          queueId: game.queueId,
          queue: game.queueName,
          counted: game.isCounted,
        })
      }
    }

    if (changed) this.deps.onStatusChanged()
  }

  private async processPending(): Promise<void> {
    if (this.unparsedEndOfGameStats !== null && this.puuid !== null) {
      const stats = this.unparsedEndOfGameStats
      this.unparsedEndOfGameStats = null
      this.handleEndOfGameStats(stats)
    }
    if (this.pending.length === 0) return
    const now = Date.now()
    const isResultPollDue = now - this.lastResultPollAt >= RESULT_POLL_INTERVAL_MS
    let changed = false

    for (const entry of [...this.pending]) {
      if (this.isStillInGame(entry)) continue

      if (!entry.isValidRun) {
        this.removePending(entry)
        this.finish({ gameId: entry.gameId, queueName: entry.queueName, placement: null, kind: 'invalid_run', fulfilledLocationIds: [] })
        continue
      }

      // client may still rewrite the file with the final board
      if (entry.endOfGame && !entry.endOfGameDelivered && now - entry.endedAt >= END_OF_GAME_SETTLE_MS) {
        if (!this.deps.canDeliverResults()) continue
        const fulfilledLocationIds = this.deps.deliverResult(entry, entry.endOfGame)
        entry.endOfGameDelivered = true
        entry.placement = entry.endOfGame.placement
        changed = true
        this.finish({ gameId: entry.gameId, queueName: entry.queueName, placement: entry.placement, kind: 'evaluated', fulfilledLocationIds })
      }

      if (entry.result) {
        if (this.deps.canDeliverResults()) this.deliver(entry, entry.result)
        continue
      }

      if (now - entry.endedAt > RESULT_TIMEOUT_MS) {
        this.removePending(entry)
        if (!entry.endOfGameDelivered) {
          this.finish({ gameId: entry.gameId, queueName: entry.queueName, placement: entry.placement, kind: 'timed_out', fulfilledLocationIds: [] })
        }
        continue
      }

      if (!this.connected || this.puuid === null || !isResultPollDue) continue

      if (entry.placement === null) {
        const stats = await this.deps.get('/lol-end-of-game/v1/tft-eog-stats')
        const endOfGame = stats?.status === 200 ? readEndOfGamePlacement(stats.data, this.puuid) : null
        if (endOfGame && (entry.gameId === null || endOfGame.gameId === null || endOfGame.gameId === entry.gameId)) {
          entry.placement = endOfGame.placement
          changed = true
          this.deps.log('Client match: placement from end-of-game stats', { gameId: entry.gameId, placement: entry.placement })
        }
      }

      // minors need the final board for any placement, so always wait for history
      const history = await this.deps.get(`/lol-match-history/v1/products/tft/${this.puuid}/matches?begin=0&count=${HISTORY_PAGE_SIZE}`)
      const result = history?.status === 200 ? findMatchHistoryResult(history.data, this.puuid, entry) : null
      if (!result) continue

      entry.result = result
      entry.placement = result.placement
      if (entry.gameId === null) entry.gameId = result.gameId
      changed = true
      this.deps.log('Client match: result from match history', {
        gameId: result.gameId,
        placement: result.placement,
        units: result.units.map(unit => `${unit.championId}*${unit.starLevel}`),
        traits: result.traits.filter(trait => trait.tierCurrent > 0).map(trait => `${trait.name}:${trait.numUnits}`),
      })

      if (this.deps.canDeliverResults()) this.deliver(entry, result)
    }

    if (isResultPollDue) this.lastResultPollAt = now
    if (changed) {
      void this.savePending()
      this.deps.onStatusChanged()
    }
  }

  private deliver(entry: PendingClientMatch, result: ClientMatchResult): void {
    const fulfilledLocationIds = this.deps.deliverResult(entry, result)
    this.removePending(entry)
    if (entry.endOfGameDelivered) {
      // follow-up to the EoG file: only level, rounds, eliminations are new
      this.deps.log('Client match: history follow-up delivered', { gameId: entry.gameId, fulfilledLocationIds })
      return
    }
    this.finish({ gameId: entry.gameId, queueName: entry.queueName, placement: result.placement, kind: 'evaluated', fulfilledLocationIds })
  }

  private removePending(entry: PendingClientMatch): void {
    this.pending = this.pending.filter(candidate => candidate !== entry)
    void this.savePending()
  }

  private finish(outcome: Omit<ClientMatchOutcome, 'finishedAt'>): void {
    this.lastOutcome = { ...outcome, finishedAt: Date.now() }
    this.deps.log('Client match: finished', this.lastOutcome)
    this.deps.onStatusChanged()
  }

  private async loadPending(): Promise<void> {
    if (this.hasLoadedPending) return
    this.hasLoadedPending = true
    const content = await this.deps.readFile(PENDING_CLIENT_MATCHES_PATH)
    if (!content) return
    try {
      const parsed: unknown = JSON.parse(content)
      if (Array.isArray(parsed)) {
        this.pending = parsed.filter((entry): entry is PendingClientMatch => (
          isRecord(entry) && typeof entry['sessionStartedAt'] === 'number' && typeof entry['isValidRun'] === 'boolean'
        ))
        if (this.pending.length > 0) this.deps.log('Client match: restored pending results', { count: this.pending.length })
      }
    } catch {
      this.deps.log('Client match: pending results file unreadable, ignored')
    }
  }

  private async savePending(): Promise<void> {
    await this.deps.writeFile(PENDING_CLIENT_MATCHES_PATH, `${JSON.stringify(this.pending, null, 2)}\n`)
  }
}
