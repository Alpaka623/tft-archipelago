import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pendingTraps: { rerollLock: 1, xpLock: 0, augmentLock: 0, shopLock: 0 },
}))

vi.mock('../app-state', () => ({
  deriveState: () => ({
    bonusItems: {
      stock: { reroll: 0, xp: 0, augmentReroll: 0, augmentPick: 0, shopSlotPass: 0 },
      pendingTraps: mocks.pendingTraps,
      activeTraps: { rerollLock: false, xpLock: false, augmentLock: false, shopLock: false },
    },
  }),
}))
vi.mock('../broadcast', () => ({ broadcastState: vi.fn() }))
vi.mock('../log', () => ({ logGep: vi.fn() }))
vi.mock('../runtime', () => ({ client: { authenticated: false } }))
vi.mock('./engine', () => ({ invalidateRun: vi.fn() }))

type BonusUsageModule = typeof import('./bonus-usage')
type StateModule = typeof import('../state')

let bonusUsage: BonusUsageModule
let state: StateModule

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  bonusUsage = await import('./bonus-usage')
  state = await import('../state')
})

describe('applyPendingTraps', () => {
  it('does not consume traps while the standalone client is in its menu', () => {
    state.session.isTftRunning = true
    state.session.matchState = 'menu'

    bonusUsage.applyPendingTraps()

    expect(state.bonus.appliedTraps.rerollLock).toBe(0)
    expect(state.bonus.activeTraps.rerollLock).toBe(false)
  })

  it('applies pending traps once in a match', () => {
    state.session.isTftRunning = true
    state.session.matchState = 'in_match'

    bonusUsage.applyPendingTraps()

    expect(state.bonus.appliedTraps.rerollLock).toBe(1)
    expect(state.bonus.activeTraps.rerollLock).toBe(true)
  })
})
