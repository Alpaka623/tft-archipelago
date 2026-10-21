/// <reference types="@overwolf/types" />
import {
  NOT_RUNNING_GAME_STATE,
  isHttpsUrl,
  type GameState,
  type GameStateChange,
  type Platform,
  type PlatformMessage,
  type PlatformWindowInfo,
} from './types'

const TFT_GAME_ID = 5426
const INPUT_PASS_THROUGH_STYLE = 'InputPassThrough' as overwolf.windows.enums.WindowStyle
const UTF8_ENCODING = 'UTF8' as overwolf.io.enums.eEncoding
const DOWNLOAD_FOLDER = 'TFTArchipelago'

interface OverwolfRunningGameInfo {
  id?: number
  classId?: number
  isRunning?: boolean
  width?: number
  height?: number
}

function toGameState(gameInfo: OverwolfRunningGameInfo | undefined | null): GameState {
  const isTft = Boolean(
    gameInfo?.isRunning
    && (gameInfo.id === TFT_GAME_ID || gameInfo.classId === TFT_GAME_ID),
  )
  if (!isTft || !gameInfo) return NOT_RUNNING_GAME_STATE

  return {
    isRunning: true,
    width: Number.isFinite(gameInfo.width) ? gameInfo.width ?? 0 : 0,
    height: Number.isFinite(gameInfo.height) ? gameInfo.height ?? 0 : 0,
  }
}

function toDocumentsPath(relativePath: string): string {
  return `${overwolf.io.paths.documents}/${relativePath.replace(/^[/\\]+/, '')}`
}

function succeeded(result: { success?: boolean } | undefined): boolean {
  return result?.success ?? false
}

export function createOverwolfPlatform(): Platform {
  return {
    kind: 'overwolf',

    obtainWindow(name) {
      return new Promise((resolve) => {
        overwolf.windows.obtainDeclaredWindow(name, (result) => {
          if (!result.success) {
            console.warn(`Failed to obtain window ${name}:`, result.error)
            resolve(null)
            return
          }
          resolve(result.window.id)
        })
      })
    },

    restoreWindow(windowId) {
      return new Promise((resolve) => {
        overwolf.windows.restore(windowId, (result) => resolve(succeeded(result)))
      })
    },

    hideWindow(windowId) {
      return new Promise((resolve) => {
        overwolf.windows.hide(windowId, (result) => resolve(succeeded(result)))
      })
    },

    bringToFront(windowId, grabFocus) {
      overwolf.windows.bringToFront(windowId, grabFocus, () => {})
    },

    setWindowBounds(windowId, rect) {
      return new Promise((resolve) => {
        overwolf.windows.changeSize(windowId, rect.w, rect.h, (sizeResult) => {
          overwolf.windows.changePosition(windowId, rect.x, rect.y, (positionResult) => {
            resolve(succeeded(sizeResult) && succeeded(positionResult))
          })
        })
      })
    },

    setWindowMinSize(windowId, width, height) {
      return new Promise((resolve) => {
        overwolf.windows.setMinSize(windowId, width, height, (result) => resolve(succeeded(result)))
      })
    },

    setClickThrough(windowId, enabled) {
      if (enabled) {
        overwolf.windows.setWindowStyle(windowId, INPUT_PASS_THROUGH_STYLE, () => {})
      } else {
        overwolf.windows.removeWindowStyle(windowId, INPUT_PASS_THROUGH_STYLE, () => {})
      }
    },

    // Overwolf in-game windows already receive drags while TFT is focused
    setWindowFocusable() {},

    getCurrentWindow() {
      return new Promise((resolve) => {
        overwolf.windows.getCurrentWindow((result) => {
          if (!result.success) {
            resolve(null)
            return
          }
          const info: PlatformWindowInfo = {
            id: result.window.id,
            name: result.window.name,
            left: result.window.left,
            top: result.window.top,
            width: result.window.width,
            height: result.window.height,
          }
          resolve(info)
        })
      })
    },

    changeWindowPosition(windowId, x, y) {
      overwolf.windows.changePosition(windowId, Math.round(x), Math.round(y), () => {})
    },

    changeWindowSize(windowId, width, height) {
      overwolf.windows.changeSize(windowId, Math.round(width), Math.round(height), () => {})
    },

    dragMove(windowId) {
      overwolf.windows.dragMove(windowId, () => {})
    },

    // Overwolf runs its own drag loops; scale drags resize freely and the widget derives its scale afterwards
    dragWindow(windowId, mode) {
      return new Promise((resolve) => {
        const resolveWithCurrentRect = () => {
          overwolf.windows.getCurrentWindow((result) => {
            resolve(result.success
              ? { x: result.window.left, y: result.window.top, w: result.window.width, h: result.window.height }
              : null)
          })
        }
        if (mode === 'move') {
          overwolf.windows.dragMove(windowId, resolveWithCurrentRect)
          return
        }
        overwolf.windows.getCurrentWindow((result) => {
          if (!result.success) {
            resolve(null)
            return
          }
          const { left, top, width, height } = result.window
          overwolf.windows.dragResize(
            windowId,
            'BottomRight' as overwolf.windows.enums.WindowDragEdge,
            { left, top, width, height },
            resolveWithCurrentRect,
          )
        })
      })
    },

    minimizeWindow(windowId) {
      overwolf.windows.minimize(windowId, () => {})
    },

    maximizeWindow(windowId) {
      return new Promise((resolve) => {
        overwolf.windows.maximize(windowId, (result) => resolve(succeeded(result)))
      })
    },

    closeWindow(windowId) {
      overwolf.windows.close(windowId, () => {})
    },

    pointerToWindowScale() {
      return 1
    },

    sendMessage(windowId, id, content) {
      overwolf.windows.sendMessage(windowId, id, content, () => {})
    },

    onMessage(handler) {
      const listener = (event: overwolf.windows.MessageReceivedEvent) => {
        handler(event as unknown as PlatformMessage)
      }
      overwolf.windows.onMessageReceived.addListener(listener)
      return () => overwolf.windows.onMessageReceived.removeListener(listener)
    },

    readDocumentsFile(relativePath, encoding = 'utf8') {
      // Binary file access is only needed by the Electron-only vision pipeline
      if (encoding !== 'utf8') return Promise.resolve(null)
      return new Promise((resolve) => {
        overwolf.io.readFileContents(toDocumentsPath(relativePath), UTF8_ENCODING, (result) => {
          resolve(result.success && result.content ? result.content : null)
        })
      })
    },

    writeDocumentsFile(relativePath, content, encoding = 'utf8') {
      if (encoding !== 'utf8') return Promise.resolve(false)
      return new Promise((resolve) => {
        overwolf.io.writeFileContents(toDocumentsPath(relativePath), content, UTF8_ENCODING, false, (result) => {
          resolve(succeeded(result))
        })
      })
    },

    getRunningGame() {
      return new Promise((resolve) => {
        overwolf.games.getRunningGameInfo((result) => {
          if (!result?.success) {
            console.warn('Failed to query running game info:', result?.error)
            resolve(NOT_RUNNING_GAME_STATE)
            return
          }
          resolve(toGameState(result as OverwolfRunningGameInfo))
        })
      })
    },

    onGameStateChanged(handler) {
      overwolf.games.onGameLaunched.addListener((gameInfo) => {
        const change: GameStateChange = { state: toGameState(gameInfo as OverwolfRunningGameInfo), resolutionChanged: false }
        handler(change)
      })
      overwolf.games.onGameInfoUpdated.addListener((event) => {
        handler({
          state: toGameState(event.gameInfo as OverwolfRunningGameInfo | undefined),
          resolutionChanged: event.resolutionChanged,
        })
      })
    },

    listCandidateWindows() {
      return Promise.resolve([])
    },

    getCaptureSourceId() {
      return Promise.resolve(null)
    },

    getCaptureGeometry() {
      return Promise.resolve(null)
    },
    // Match results come from GEP on Overwolf
    clientApiGet() {
      return Promise.resolve(null)
    },
    // Overwolf evidence is only a small violation.json, and overwolf.io cannot delete
    pruneViolationEvidence() {
      return Promise.resolve(null)
    },

    // Overwolf updates apps through its own store
    getUpdateStatus() {
      return Promise.resolve(null)
    },

    installUpdate() {
      return Promise.resolve(false)
    },

    openExternalUrl(url) {
      if (isHttpsUrl(url)) overwolf.utils.openUrlInDefaultBrowser(url)
    },

    // Overwolf apps cannot reach Discord's local IPC pipe
    setRichPresence() {},

    getDiscordPresenceStatus() {
      return Promise.resolve(null)
    },

    setDiscordPresenceEnabled() {
      return Promise.resolve(null)
    },

    // Overwolf has no save dialog: downloads go to Documents/TFTArchipelago
    saveDownload(download) {
      const destination = toDocumentsPath(`${DOWNLOAD_FOLDER}/${download.fileName}`)
      return new Promise((resolve) => {
        const done = (result: { success?: boolean } | undefined) => resolve(succeeded(result) ? destination : null)
        if ('text' in download) {
          overwolf.io.writeFileContents(destination, download.text, UTF8_ENCODING, false, done)
        } else {
          overwolf.io.copyFile(download.bundledPath, destination, true, false, done)
        }
      })
    },
  }
}
