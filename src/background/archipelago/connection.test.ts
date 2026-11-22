import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

const mocks = vi.hoisted(() => {
  const socketHandlers = new Map<string, Handler[]>()
  const itemHandlers = new Map<string, Handler[]>()
  const messageHandlers = new Map<string, Handler[]>()
  const roomHandlers = new Map<string, Handler[]>()
  const on = (map: Map<string, Handler[]>) => (event: string, handler: Handler) => {
    map.set(event, [...(map.get(event) ?? []), handler])
  }
  const emit = (map: Map<string, Handler[]>, event: string, ...args: unknown[]) => {
    for (const handler of map.get(event) ?? []) handler(...args)
  }

  return {
    socketHandlers,
    itemHandlers,
    emit,
    authenticated: false,
    login: vi.fn(),
    loadBonusUsage: vi.fn().mockResolvedValue(undefined),
    loadCompletedMajors: vi.fn().mockResolvedValue(undefined),
    flushPendingChecks: vi.fn(),
    maybeReportGoal: vi.fn(),
    client: {
      get authenticated() {
        return mocks.authenticated
      },
      login: (...args: unknown[]) => mocks.login(...args),
      socket: { on: on(socketHandlers) },
      items: { on: on(itemHandlers), received: [] },
      messages: { on: on(messageHandlers) },
      room: { on: on(roomHandlers), checkedLocations: [], missingLocations: [] },
    },
  }
})

vi.mock('../app-state', () => ({
  getErrorMessage: (error: unknown) => String(error),
  isMajorLocationUnlocked: () => true,
}))
vi.mock('../broadcast', () => ({ broadcastState: vi.fn() }))
vi.mock('../rules/bonus-usage', () => ({ loadBonusUsage: mocks.loadBonusUsage }))
vi.mock('../runtime', () => ({ client: mocks.client }))
vi.mock('./checks', () => ({
  flushPendingChecks: mocks.flushPendingChecks,
  loadCompletedMajors: mocks.loadCompletedMajors,
  maybeReportGoal: mocks.maybeReportGoal,
}))
vi.mock('./notifications', () => ({
  consumeItemNotificationSuppression: () => true,
  notifyGlobalItemSent: vi.fn(),
  notifyHint: vi.fn(),
  notifyItemsReceived: vi.fn(),
  suppressInitialItemNotifications: vi.fn(),
}))

type ConnectionModule = typeof import('./connection')
type StateModule = typeof import('../state')

let connection: ConnectionModule
let state: StateModule

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  vi.resetModules()
  vi.clearAllMocks()
  mocks.socketHandlers.clear()
  mocks.itemHandlers.clear()
  mocks.authenticated = false
  connection = await import('./connection')
  state = await import('../state')
  connection.registerArchipelagoListeners()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Archipelago connection lifecycle', () => {
  it('retries reconnecting with backoff when the first reconnect attempt fails', async () => {
    mocks.login.mockImplementationOnce(async () => {
      mocks.authenticated = true
      return { goal_checks: 10, trust_mode: false }
    })

    await connection.connect({ hostname: 'archipelago.gg', port: 38281, slotName: 'Player', password: '' })
    expect(mocks.login).toHaveBeenCalledTimes(1)

    // Disconnect; first retry fails, second succeeds
    mocks.authenticated = false
    mocks.login
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockImplementationOnce(async () => {
        mocks.authenticated = true
        return { goal_checks: 10, trust_mode: false }
      })

    mocks.emit(mocks.socketHandlers, 'disconnected')
    await vi.advanceTimersByTimeAsync(2000)
    expect(mocks.login).toHaveBeenCalledTimes(2)
    expect(mocks.authenticated).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mocks.login).toHaveBeenCalledTimes(3)
    expect(mocks.authenticated).toBe(true)
  })

  it('does not invalidate an active trust-mode run when itemsReceived fires during login', async () => {
    state.economy.xpBuysThisRound = 3
    mocks.login.mockImplementationOnce(async () => {
      // Archipelago emits itemsReceived before login() resolves with slotData
      mocks.emit(mocks.itemHandlers, 'itemsReceived', [])
      mocks.authenticated = true
      return { goal_checks: 10, trust_mode: true }
    })

    await connection.connect({ hostname: 'archipelago.gg', port: 38281, slotName: 'Player', password: '' })

    expect(state.slot.trustMode).toBe(true)
    expect(state.run.isValid).toBe(true)
    expect(mocks.loadBonusUsage).toHaveBeenCalledTimes(1)
  })
})
