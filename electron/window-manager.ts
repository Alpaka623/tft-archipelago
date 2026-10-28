// Creates the app's BrowserWindows and keeps in-game windows aligned with the TFT client area
import path from 'node:path'
import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { BRIDGE_MESSAGE_CHANNEL } from '../src/platform/bridge'
import type {
  PlatformMessage,
  PlatformRect,
  PlatformWindowInfo,
  WindowDragLimits,
  WindowDragMode,
} from '../src/platform/types'
import { getCursorPhysicalPoint, isPrimaryMouseButtonDown } from './game-monitor'
import { physicalToDip, type GameTracker } from './game-tracker'
import { WINDOW_DEFS, type WindowDef } from './windows'

export const DIST_DIR = path.join(__dirname, '..', 'dist')
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs')
// Development switches are ignored in the installed app
const DEV_SERVER_URL = app.isPackaged ? '' : process.env['TFT_ARCHIPELAGO_DEV_SERVER_URL'] ?? ''
const OPEN_DEVTOOLS = !app.isPackaged && process.env['TFT_ARCHIPELAGO_DEVTOOLS'] === '1'

const DRAG_POLL_INTERVAL_MS = 16
const DRAG_MAX_DURATION_MS = 60_000

export interface ManagedWindow {
  name: string
  def: WindowDef
  win: BrowserWindow
  isLoaded: boolean
  pendingMessages: PlatformMessage[]
  // In-game windows only: whether the background wants it shown, and where (game-relative px)
  wantsVisible: boolean
  gameRect: PlatformRect
  // Click-through windows never receive forwarded clicks
  ignoresMouseEvents: boolean
}

function getDefaultGameRect(def: WindowDef): PlatformRect {
  return { x: def.defaultX ?? 0, y: def.defaultY ?? 0, w: def.width, h: def.height }
}

function buildWindowOptions(def: WindowDef): BrowserWindowConstructorOptions {
  const base: BrowserWindowConstructorOptions = {
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  }

  switch (def.kind) {
    case 'background':
      return { ...base, width: 400, height: 300, skipTaskbar: true }
    case 'desktop':
      return {
        ...base,
        width: def.width,
        height: def.height,
        minWidth: def.minWidth,
        minHeight: def.minHeight,
        frame: false,
        title: 'TFT Archipelago',
        icon: path.join(DIST_DIR, 'assets', 'window_icon.png'),
      }
    case 'ingame':
      return {
        ...base,
        width: def.width,
        height: def.height,
        transparent: true,
        backgroundColor: '#00000000',
        frame: false,
        thickFrame: false,
        hasShadow: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        // Never take keyboard focus away from TFT, clicks are still received
        focusable: false,
      }
  }
}

// Renderer console output ends up in the main process log, prefixed with the window name
function forwardConsole(name: string, win: BrowserWindow): void {
  win.webContents.on('console-message', (...args: unknown[]) => {
    const [first, , legacyMessage] = args
    const message = typeof legacyMessage === 'string'
      ? legacyMessage
      : (first as { message?: string } | undefined)?.message ?? ''
    console.log(`[${name}] ${message}`)
  })
}

export class WindowManager {
  private readonly windows = new Map<string, ManagedWindow>()
  private finishActiveDrag: (() => void) | null = null
  isQuitting = false

  constructor(private readonly game: GameTracker) {}

  get(name: string): ManagedWindow | null {
    return this.windows.get(name) ?? null
  }

  findByBrowserWindow(win: BrowserWindow | null): ManagedWindow | null {
    return [...this.windows.values()].find(candidate => candidate.win === win) ?? null
  }

  create(name: string): ManagedWindow | null {
    const def = WINDOW_DEFS[name]
    if (!def) return null

    const win = new BrowserWindow(buildWindowOptions(def))
    const managed: ManagedWindow = {
      name,
      def,
      win,
      isLoaded: false,
      pendingMessages: [],
      wantsVisible: false,
      gameRect: getDefaultGameRect(def),
      ignoresMouseEvents: false,
    }
    this.windows.set(name, managed)

    if (def.kind === 'ingame') {
      win.setAlwaysOnTop(true, 'screen-saver')
      if (def.clickThrough) this.setClickThrough(managed, true)
    }

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.webContents.on('did-finish-load', () => {
      managed.isLoaded = true
      for (const message of managed.pendingMessages.splice(0)) {
        win.webContents.send(BRIDGE_MESSAGE_CHANNEL, message)
      }
    })
    forwardConsole(name, win)

    win.on('closed', () => {
      this.windows.delete(name)
      if (def.kind === 'desktop' && !this.isQuitting) app.quit()
    })

    if (DEV_SERVER_URL) {
      void win.loadURL(new URL(def.file, DEV_SERVER_URL).toString())
    } else {
      void win.loadFile(path.join(DIST_DIR, def.file))
    }

    if (OPEN_DEVTOOLS && def.kind !== 'ingame') {
      win.webContents.openDevTools({ mode: 'detach' })
    }

    return managed
  }

  setClickThrough(managed: ManagedWindow, enabled: boolean): void {
    managed.ignoresMouseEvents = enabled
    managed.win.setIgnoreMouseEvents(enabled)
  }

  // Messages to a window that is still loading are delivered once it has loaded
  send(windowId: string, message: PlatformMessage): void {
    const managed = this.windows.get(windowId)
    if (!managed) return
    if (!managed.isLoaded) {
      managed.pendingMessages.push(message)
      return
    }
    managed.win.webContents.send(BRIDGE_MESSAGE_CHANNEL, message)
  }

  forEachIngameWindow(callback: (managed: ManagedWindow) => void): void {
    for (const managed of this.windows.values()) {
      if (managed.def.kind === 'ingame') callback(managed)
    }
  }

  applyIngameBounds(managed: ManagedWindow): void {
    const origin = this.game.getGameClientRect() ?? this.game.getPrimaryDisplayPhysicalRect()
    managed.win.setBounds(physicalToDip({
      x: origin.x + managed.gameRect.x,
      y: origin.y + managed.gameRect.y,
      width: managed.gameRect.w,
      height: managed.gameRect.h,
    }))
  }

  applyIngameVisibility(managed: ManagedWindow): void {
    const shouldShow = managed.wantsVisible && this.game.shouldShowIngameWindows()
    if (shouldShow && !managed.win.isVisible()) {
      this.applyIngameBounds(managed)
      managed.win.showInactive()
      managed.win.setAlwaysOnTop(true, 'screen-saver')
      managed.win.moveTop()
      console.log(`In-game window shown: ${managed.name}`, { gameRect: managed.gameRect, dipBounds: managed.win.getBounds() })
    } else if (!shouldShow && managed.win.isVisible()) {
      managed.win.hide()
      console.log(`In-game window hidden: ${managed.name}`)
    }
  }

  getWindowInfo(managed: ManagedWindow): PlatformWindowInfo {
    if (managed.def.kind === 'ingame') {
      const { x, y, w, h } = managed.gameRect
      return { id: managed.name, name: managed.name, left: x, top: y, width: w, height: h }
    }
    const bounds = managed.win.getBounds()
    return { id: managed.name, name: managed.name, left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }
  }

  // Keeps an in-game window fully inside the game client
  clampToGameClient(rect: PlatformRect): PlatformRect {
    const clientRect = this.game.getGameClientRect() ?? this.game.getPrimaryDisplayPhysicalRect()
    return {
      ...rect,
      x: Math.min(Math.max(0, rect.x), Math.max(0, clientRect.width - rect.w)),
      y: Math.min(Math.max(0, rect.y), Math.max(0, clientRect.height - rect.h)),
    }
  }

  // In-game widget drags: the main process follows the cursor instead of the renderer, because
  // in-game windows are not focusable and the renderer loses mouse input once the cursor outruns
  // the window. Resolves with the final game-relative rect once the mouse button is released.
  dragIngameWindow(managed: ManagedWindow, mode: WindowDragMode, limits: WindowDragLimits): Promise<PlatformRect> {
    this.finishActiveDrag?.()
    const startCursor = getCursorPhysicalPoint()
    const startRect = { ...managed.gameRect }
    const startedAt = Date.now()

    return new Promise((resolve) => {
      const finish = () => {
        clearInterval(timer)
        this.finishActiveDrag = null
        resolve({ ...managed.gameRect })
      }

      const timer = setInterval(() => {
        const isButtonDown = isPrimaryMouseButtonDown()
        const cursor = getCursorPhysicalPoint()
        const dx = cursor.x - startCursor.x
        const dy = cursor.y - startCursor.y

        if (mode === 'move') {
          managed.gameRect = this.clampToGameClient({ ...startRect, x: startRect.x + dx, y: startRect.y + dy })
        } else {
          // The corner follows whichever axis the cursor pulled further, keeping the aspect ratio
          const factor = Math.max((startRect.w + dx) / startRect.w, (startRect.h + dy) / startRect.h)
          const width = Math.min(Math.max(startRect.w * factor, limits.minWidth), limits.maxWidth)
          const clampedFactor = width / startRect.w
          managed.gameRect = {
            ...startRect,
            w: Math.round(startRect.w * clampedFactor),
            h: Math.round(startRect.h * clampedFactor),
          }
        }
        this.applyIngameBounds(managed)

        if (!isButtonDown || Date.now() - startedAt > DRAG_MAX_DURATION_MS) finish()
      }, DRAG_POLL_INTERVAL_MS)

      this.finishActiveDrag = finish
    })
  }
}
