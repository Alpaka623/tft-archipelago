// Main-process side of the platform bridge: answers the renderer's BridgeRequests
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, desktopCapturer, dialog, screen, shell, type BrowserWindow } from 'electron'
import type { BridgeRequest } from '../src/platform/bridge'
import { isHttpsUrl, type SaveDownloadRequest } from '../src/platform/types'
import type { DiscordPresence } from './discord-presence'
import type { GameTracker } from './game-tracker'
import type { LcuClient } from './lcu-client'
import type { AppUpdater } from './updater'
import { pruneViolationEvidence } from './violation-evidence'
import { DIST_DIR, type WindowManager } from './window-manager'

export interface BridgeContext {
  windows: WindowManager
  game: GameTracker
  lcuClient: LcuClient | null
  discordPresence: DiscordPresence
  getAppUpdater(): AppUpdater | null
}

function resolveDocumentsPath(relativePath: string): string | null {
  const documentsDir = app.getPath('documents')
  const resolved = path.resolve(documentsDir, relativePath)
  return resolved.startsWith(documentsDir + path.sep) ? resolved : null
}

// Bundled downloads may only come from the built renderer files
function resolveBundledPath(relativePath: string): string | null {
  const resolved = path.resolve(DIST_DIR, relativePath)
  return resolved.startsWith(DIST_DIR + path.sep) ? resolved : null
}

async function readDocumentsFile(relativePath: string, encoding: BufferEncoding = 'utf8'): Promise<string | null> {
  const filePath = resolveDocumentsPath(relativePath)
  if (!filePath) return null
  try {
    return await fs.readFile(filePath, encoding)
  } catch {
    return null
  }
}

async function writeDocumentsFile(relativePath: string, content: string, encoding: BufferEncoding = 'utf8'): Promise<boolean> {
  const filePath = resolveDocumentsPath(relativePath)
  if (!filePath) return false
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, encoding)
    return true
  } catch (error) {
    console.warn('Failed to write documents file:', error)
    return false
  }
}

async function saveDownload(senderWindow: BrowserWindow | null, download: SaveDownloadRequest): Promise<string | null> {
  const sourcePath = 'bundledPath' in download ? resolveBundledPath(download.bundledPath) : null
  if ('bundledPath' in download && !sourcePath) return null

  const extension = path.extname(download.fileName).slice(1)
  const options = {
    defaultPath: path.join(app.getPath('downloads'), path.basename(download.fileName)),
    filters: extension ? [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }] : [],
  }
  const result = senderWindow ? await dialog.showSaveDialog(senderWindow, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null

  try {
    if (sourcePath) {
      await fs.copyFile(sourcePath, result.filePath)
    } else if ('text' in download) {
      await fs.writeFile(result.filePath, download.text, 'utf8')
    }
    return result.filePath
  } catch (error) {
    console.warn('Failed to save download:', error)
    return null
  }
}

// Window capture of TFT only (never the whole screen), so our own overlay and
// blocker windows do not appear in the frames. Fake-game mode captures the
// primary screen for testing instead.
async function findCaptureSourceId(game: GameTracker): Promise<string | null> {
  if (game.isFakeGame) {
    const primaryDisplayId = String(screen.getPrimaryDisplay().id)
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    return (sources.find(source => source.display_id === primaryDisplayId) ?? sources[0])?.id ?? null
  }

  const gameHandle = game.monitor?.getGameWindowHandle() ?? null
  if (gameHandle === null) return null

  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
  const match = sources.find((source) => {
    const [kind, handle] = source.id.split(':')
    return kind === 'window' && handle !== undefined && /^\d+$/.test(handle) && BigInt(handle) === gameHandle
  })
  return match?.id ?? null
}

export async function handleBridgeRequest(
  context: BridgeContext,
  senderWindow: BrowserWindow | null,
  request: BridgeRequest,
): Promise<unknown> {
  const { windows, game } = context

  switch (request.type) {
    case 'obtainWindow': {
      const managed = windows.get(request.name) ?? windows.create(request.name)
      return managed?.name ?? null
    }
    case 'restoreWindow': {
      const managed = windows.get(request.windowId)
      if (!managed) return false
      if (managed.def.kind === 'ingame') {
        managed.wantsVisible = true
        windows.applyIngameVisibility(managed)
      } else if (managed.def.kind === 'desktop') {
        if (managed.win.isMinimized()) managed.win.restore()
        if (managed.win.isMaximized()) managed.win.unmaximize()
        managed.win.show()
      }
      return true
    }
    case 'hideWindow': {
      const managed = windows.get(request.windowId)
      if (!managed) return false
      managed.wantsVisible = false
      if (managed.win.isVisible()) {
        managed.win.hide()
        console.log(`Window hidden: ${managed.name}`)
      }
      return true
    }
    case 'bringToFront': {
      const managed = windows.get(request.windowId)
      if (!managed || !managed.win.isVisible()) return undefined
      managed.win.moveTop()
      if (request.grabFocus && managed.def.kind !== 'ingame') managed.win.focus()
      return undefined
    }
    case 'setWindowBounds': {
      const managed = windows.get(request.windowId)
      if (!managed) return false
      if (managed.def.kind === 'ingame') {
        managed.gameRect = { ...request.rect }
        windows.applyIngameBounds(managed)
      } else {
        managed.win.setBounds({ x: request.rect.x, y: request.rect.y, width: request.rect.w, height: request.rect.h })
      }
      return true
    }
    case 'setWindowMinSize': {
      const managed = windows.get(request.windowId)
      if (!managed) return false
      managed.win.setMinimumSize(Math.max(1, request.width), Math.max(1, request.height))
      return true
    }
    case 'setClickThrough': {
      const managed = windows.get(request.windowId)
      if (managed) windows.setClickThrough(managed, request.enabled)
      return undefined
    }
    case 'setWindowFocusable': {
      // Windows only routes mouse moves outside a window to it while it is in the
      // foreground, so calibration drags need a focusable blocker window
      const managed = windows.get(request.windowId)
      if (managed?.def.kind === 'ingame') managed.win.setFocusable(request.enabled)
      return undefined
    }
    case 'getCurrentWindow': {
      const managed = windows.findByBrowserWindow(senderWindow)
      return managed ? windows.getWindowInfo(managed) : null
    }
    case 'changeWindowPosition':
    case 'changeWindowSize': {
      const managed = windows.get(request.windowId)
      if (!managed) return undefined
      if (managed.def.kind === 'ingame') {
        // Calibration drags must not push a blocker off the game client, where it cannot be grabbed again
        managed.gameRect = windows.clampToGameClient(request.type === 'changeWindowPosition'
          ? { ...managed.gameRect, x: request.x, y: request.y }
          : { ...managed.gameRect, w: Math.max(1, request.width), h: Math.max(1, request.height) })
        windows.applyIngameBounds(managed)
      } else if (request.type === 'changeWindowPosition') {
        managed.win.setPosition(request.x, request.y)
      } else {
        managed.win.setSize(request.width, request.height)
      }
      return undefined
    }
    case 'dragWindow': {
      const managed = windows.get(request.windowId)
      if (!managed || managed.def.kind !== 'ingame') return null
      return windows.dragIngameWindow(managed, request.mode, request.limits)
    }
    case 'minimizeWindow':
      windows.get(request.windowId)?.win.minimize()
      return undefined
    case 'maximizeWindow': {
      const managed = windows.get(request.windowId)
      if (!managed) return false
      managed.win.maximize()
      return true
    }
    case 'closeWindow':
      windows.get(request.windowId)?.win.close()
      return undefined
    case 'sendMessage':
      windows.send(request.windowId, request.message)
      return undefined
    case 'readDocumentsFile':
      return readDocumentsFile(request.relativePath, request.encoding)
    case 'writeDocumentsFile':
      return writeDocumentsFile(request.relativePath, request.content, request.encoding)
    case 'getRunningGame':
      return game.getGameState()
    case 'listCandidateWindows':
      return game.monitor?.listCandidateWindows() ?? []
    case 'getCaptureSourceId':
      return findCaptureSourceId(game)
    case 'getCaptureGeometry': {
      if (game.isFakeGame) {
        const screenRect = game.getPrimaryDisplayPhysicalRect()
        return { offsetX: 0, offsetY: 0, clientWidth: screenRect.width, clientHeight: screenRect.height }
      }
      return game.monitor?.getCaptureGeometry() ?? null
    }
    case 'clientApiGet':
      return context.lcuClient?.get(request.apiPath) ?? null
    case 'saveDownload':
      return saveDownload(senderWindow, request.download)
    case 'pruneViolationEvidence':
      return pruneViolationEvidence(app.getPath('documents'))
    case 'getUpdateStatus':
      return context.getAppUpdater()?.getStatus() ?? null
    case 'installUpdate':
      return context.getAppUpdater()?.install() ?? false
    case 'openExternalUrl':
      if (isHttpsUrl(request.url)) void shell.openExternal(request.url)
      return
    case 'setRichPresence':
      context.discordPresence.setPresence(request.presence)
      return undefined
    case 'getDiscordPresenceStatus':
      return context.discordPresence.getStatus()
    case 'setDiscordPresenceEnabled':
      return context.discordPresence.setEnabled(request.enabled)
  }
}
