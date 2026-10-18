// Tracks the TFT window: running state, client area and whether in-game windows may show
import { screen, type Rectangle } from 'electron'
import { NOT_RUNNING_GAME_STATE, type GameState } from '../src/platform/types'
import type { ElectronConfig } from './config'
import {
  GameMonitor,
  getPrimaryMonitorRect,
  type GameWindowSnapshot,
  type PhysicalRect,
} from './game-monitor'

export interface GameStateChange {
  state: GameState
  resolutionChanged: boolean
}

export interface GamePollResult {
  clientRectChanged: boolean
  ingameVisibilityChanged: boolean
  stateChange: GameStateChange | null
}

export class GameTracker {
  readonly monitor: GameMonitor | null
  private snapshot: GameWindowSnapshot = {
    isRunning: false,
    isMinimized: false,
    clientRect: null,
    foregroundIsGame: false,
    foregroundIsOwnProcess: false,
    foregroundRect: null,
  }
  private lastState: GameState = NOT_RUNNING_GAME_STATE
  private lastClientRectKey = ''
  private lastIngameVisible = false

  constructor(private readonly config: ElectronConfig) {
    let monitor: GameMonitor | null = null
    try {
      monitor = new GameMonitor(config.gameProcessNames)
    } catch (error) {
      console.error('Game window monitor unavailable:', error)
    }
    this.monitor = monitor
  }

  get isFakeGame(): boolean {
    return this.config.fakeGame
  }

  get isGameProcessRunning(): boolean {
    return this.snapshot.isRunning
  }

  getPrimaryDisplayPhysicalRect(): PhysicalRect {
    if (this.monitor) return getPrimaryMonitorRect()
    return screen.dipToScreenRect(null, screen.getPrimaryDisplay().bounds)
  }

  getGameClientRect(): PhysicalRect | null {
    if (this.config.fakeGame) return this.getPrimaryDisplayPhysicalRect()
    return this.snapshot.clientRect
  }

  getGameState(): GameState {
    const clientRect = this.getGameClientRect()
    const isRunning = this.config.fakeGame || this.snapshot.isRunning
    if (!isRunning || !clientRect) return isRunning ? { isRunning: true, width: 0, height: 0 } : NOT_RUNNING_GAME_STATE
    return { isRunning: true, width: clientRect.width, height: clientRect.height }
  }

  // In-game windows stay visible while the game is visible and the player is in the
  // game, in this app, or in a window on another monitor (e.g. the tracker on a second
  // screen). They hide when the player switches to another app on the game's monitor.
  shouldShowIngameWindows(): boolean {
    if (this.config.fakeGame) return true
    const { snapshot } = this
    if (!snapshot.isRunning || snapshot.isMinimized || !snapshot.clientRect) return false
    if (snapshot.foregroundIsGame || snapshot.foregroundIsOwnProcess) return true
    if (!snapshot.foregroundRect) return true
    return getDisplayIdForPhysicalRect(snapshot.foregroundRect) !== getDisplayIdForPhysicalRect(snapshot.clientRect)
  }

  poll(): GamePollResult {
    if (this.monitor) {
      try {
        this.snapshot = this.monitor.snapshot()
      } catch (error) {
        console.warn('Game window poll failed:', error)
      }
    }

    const clientRect = this.getGameClientRect()
    const clientRectKey = clientRect ? `${clientRect.x},${clientRect.y},${clientRect.width},${clientRect.height}` : ''
    const clientRectChanged = clientRectKey !== this.lastClientRectKey
    this.lastClientRectKey = clientRectKey

    const ingameVisible = this.shouldShowIngameWindows()
    const ingameVisibilityChanged = ingameVisible !== this.lastIngameVisible
    this.lastIngameVisible = ingameVisible

    const nextState = this.getGameState()
    const runningChanged = nextState.isRunning !== this.lastState.isRunning
    const resolutionChanged = nextState.width !== this.lastState.width || nextState.height !== this.lastState.height
    let stateChange: GameStateChange | null = null
    if (runningChanged || resolutionChanged) {
      this.lastState = nextState
      stateChange = { state: nextState, resolutionChanged: resolutionChanged && nextState.isRunning }
    }

    return { clientRectChanged, ingameVisibilityChanged, stateChange }
  }
}

export function physicalToDip(rect: PhysicalRect): Rectangle {
  const dip = screen.screenToDipRect(null, rect)
  return {
    x: Math.round(dip.x),
    y: Math.round(dip.y),
    width: Math.max(1, Math.round(dip.width)),
    height: Math.max(1, Math.round(dip.height)),
  }
}

function getDisplayIdForPhysicalRect(rect: PhysicalRect): number {
  const center = screen.screenToDipPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  return screen.getDisplayNearestPoint({ x: Math.round(center.x), y: Math.round(center.y) }).id
}
