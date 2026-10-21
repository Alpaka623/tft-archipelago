// TFT keeps the mouse captured while it is in the foreground, so Windows sends every click to the
// game even when the cursor is over an overlay window. This forwards the primary button to the
// in-game window under the cursor through Chromium's own input pipeline. It only reads the cursor
// and button state; the game still receives its click (nothing is blocked or injected into it).
import { screen } from 'electron'
import { getCursorPhysicalPoint, isPrimaryMouseButtonDown } from './game-monitor'
import type { GameTracker } from './game-tracker'
import type { ManagedWindow, WindowManager } from './window-manager'

const POLL_INTERVAL_MS = 16
// how long a press waits for the game to take the capture before it counts as a real window click
const CAPTURE_WAIT_MS = 150

interface ForwardTarget {
  managed: ManagedWindow
  x: number
  y: number
}

export class ClickForwarder {
  private timer: NodeJS.Timeout | null = null
  private wasButtonDown = false
  private hovered: ManagedWindow | null = null
  // window that got the forwarded mouseDown; receives moves and the mouseUp wherever the cursor is
  private pressed: ManagedWindow | null = null
  private pendingPress: { managed: ManagedWindow; startedAt: number } | null = null
  private lastMoveKey = ''

  constructor(private readonly game: GameTracker, private readonly windows: WindowManager) {}

  start(): void {
    if (this.timer || !this.game.monitor) return
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private poll(): void {
    let isButtonDown: boolean
    let isCaptured: boolean
    try {
      isButtonDown = isPrimaryMouseButtonDown()
      isCaptured = this.game.monitor?.isGameHoldingMouseCapture() ?? false
    } catch (error) {
      console.warn('Click forwarding poll failed:', error)
      this.stop()
      return
    }
    const wasButtonDown = this.wasButtonDown
    this.wasButtonDown = isButtonDown

    const physical = getCursorPhysicalPoint()
    const cursor = screen.screenToDipPoint(physical)

    if (this.pressed) {
      const target = this.toTarget(this.pressed, cursor)
      if (!target) {
        this.pressed = null
      } else if (!isButtonDown) {
        this.send(target, 'mouseUp')
        this.pressed = null
      } else {
        this.sendMove(target)
      }
      return
    }

    // A press over an overlay window: the game takes the capture once it handles the press, which
    // can be a frame after the button went down. No capture means the window got the real click.
    if (isButtonDown && !wasButtonDown) {
      const hit = this.hitTest(cursor)
      this.pendingPress = hit ? { managed: hit.managed, startedAt: Date.now() } : null
    }
    if (this.pendingPress) {
      const target = this.toTarget(this.pendingPress.managed, cursor)
      if (target && isCaptured) {
        this.pendingPress = null
        console.log(`Click forwarded to ${target.managed.name}`, { x: target.x, y: target.y })
        this.send(target, 'mouseDown')
        this.pressed = target.managed
        if (!isButtonDown) {
          this.send(target, 'mouseUp')
          this.pressed = null
        }
        return
      }
      if (!target || !isButtonDown || Date.now() - this.pendingPress.startedAt > CAPTURE_WAIT_MS) {
        console.log(`Click on ${this.pendingPress.managed.name} not forwarded (game did not take the capture)`)
        this.pendingPress = null
      }
    }

    // Hover only matters while the game holds the capture; otherwise the window gets real moves
    const hit = isCaptured && !isButtonDown ? this.hitTest(cursor) : null
    if (this.hovered && this.hovered !== hit?.managed) {
      const previous = this.toTarget(this.hovered, cursor)
      if (previous) this.send(previous, 'mouseLeave')
      this.hovered = null
    }
    if (!hit) return

    if (this.hovered !== hit.managed) {
      this.hovered = hit.managed
      this.send(hit, 'mouseEnter')
    }
    this.sendMove(hit)
  }

  private hitTest(cursor: Electron.Point): ForwardTarget | null {
    let hit: ForwardTarget | null = null
    this.windows.forEachIngameWindow((managed) => {
      if (hit || managed.ignoresMouseEvents || !managed.isLoaded || !managed.win.isVisible()) return
      const bounds = managed.win.getBounds()
      if (
        cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width &&
        cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
      ) {
        hit = this.toTarget(managed, cursor)
      }
    })
    return hit
  }

  private toTarget(managed: ManagedWindow, cursor: Electron.Point): ForwardTarget | null {
    if (managed.win.isDestroyed()) return null
    const bounds = managed.win.getBounds()
    return { managed, x: Math.round(cursor.x - bounds.x), y: Math.round(cursor.y - bounds.y) }
  }

  private sendMove(target: ForwardTarget): void {
    const key = `${target.managed.name}:${target.x},${target.y}`
    if (key === this.lastMoveKey) return
    this.lastMoveKey = key
    this.send(target, 'mouseMove')
  }

  private send(target: ForwardTarget, type: 'mouseDown' | 'mouseUp' | 'mouseMove' | 'mouseEnter' | 'mouseLeave'): void {
    const { webContents } = target.managed.win
    if (type === 'mouseDown' || type === 'mouseUp') {
      webContents.sendInputEvent({ type, x: target.x, y: target.y, button: 'left', clickCount: 1 })
    } else {
      webContents.sendInputEvent({ type, x: target.x, y: target.y })
    }
  }
}
