// Electron main process: app lifecycle, game polling and the windows' bridge
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import {
  BRIDGE_GAME_STATE_CHANNEL,
  BRIDGE_INVOKE_CHANNEL,
  type BridgeRequest,
} from '../src/platform/bridge'
import { TFT_END_OF_GAME_MESSAGE_ID, TFT_LOG_EVENTS_MESSAGE_ID } from '../src/platform/tft-log'
import { APP_UPDATE_STATUS_MESSAGE_ID, BACKGROUND_WINDOW_ID } from '../src/platform/types'
import { handleBridgeRequest } from './bridge-handler'
import { loadElectronConfig } from './config'
import { GameTracker } from './game-tracker'
import { LcuClient } from './lcu-client'
import { TftLogWatcher } from './tft-log-watcher'
import { AppUpdater } from './updater'
import { WindowManager } from './window-manager'

const GAME_POLL_INTERVAL_MS = 250
const VISION_WINDOW_ID = 'vision'
const DESKTOP_WINDOW_ID = 'desktop'
const GAME_STATE_SUBSCRIBERS = [BACKGROUND_WINDOW_ID, VISION_WINDOW_ID]
const APP_USER_MODEL_ID = 'gg.archipelago.tft'

function getDefaultTftLogDir(): string {
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(app.getPath('home'), 'AppData', 'Local')
  return path.join(localAppData, 'TFT', 'Saved', 'Logs')
}

function pollGame(game: GameTracker, windows: WindowManager): void {
  const { clientRectChanged, ingameVisibilityChanged, stateChange } = game.poll()

  if (clientRectChanged) {
    windows.forEachIngameWindow((managed) => {
      if (managed.win.isVisible()) windows.applyIngameBounds(managed)
    })
  }

  if (ingameVisibilityChanged) {
    windows.forEachIngameWindow(managed => windows.applyIngameVisibility(managed))
  }

  if (stateChange) {
    console.log('Game state changed:', stateChange.state)
    for (const windowId of GAME_STATE_SUBSCRIBERS) {
      windows.get(windowId)?.win.webContents.send(BRIDGE_GAME_STATE_CHANNEL, stateChange)
    }
  }
}

function startApp(): void {
  const config = loadElectronConfig(app.getPath('documents'))
  if (app.isPackaged) config.fakeGame = false
  else if (process.argv.includes('--fake-game')) config.fakeGame = true
  console.log('Electron config:', config)

  const game = new GameTracker(config)
  const windows = new WindowManager(game)
  let appUpdater: AppUpdater | null = null

  app.on('second-instance', () => {
    const desktop = windows.get(DESKTOP_WINDOW_ID)?.win
    if (!desktop) return
    if (desktop.isMinimized()) desktop.restore()
    desktop.show()
    desktop.focus()
  })
  app.on('before-quit', () => {
    windows.isQuitting = true
  })

  const bridgeContext = {
    windows,
    game,
    lcuClient: new LcuClient(config.riotClientInstallDirs),
    getAppUpdater: () => appUpdater,
  }
  ipcMain.handle(BRIDGE_INVOKE_CHANNEL, (event, request: BridgeRequest) => (
    handleBridgeRequest(bridgeContext, BrowserWindow.fromWebContents(event.sender), request)
  ))

  pollGame(game, windows)
  setInterval(() => pollGame(game, windows), GAME_POLL_INTERVAL_MS)

  // The background controller opens the desktop tracker and everything else
  windows.create(BACKGROUND_WINDOW_ID)
  windows.create(VISION_WINDOW_ID)

  // Messages queue in the window manager until the background page has loaded
  const tftLogWatcher = new TftLogWatcher(config.tftLogDir ?? getDefaultTftLogDir(), {
    onLogEvents: batch => windows.send(BACKGROUND_WINDOW_ID, { id: TFT_LOG_EVENTS_MESSAGE_ID, content: batch }),
    onEndOfGame: file => windows.send(BACKGROUND_WINDOW_ID, { id: TFT_END_OF_GAME_MESSAGE_ID, content: file }),
  })
  tftLogWatcher.start()

  // Unpackaged builds have no update feed
  if (app.isPackaged) {
    appUpdater = new AppUpdater({
      onStatus: status => windows.send(DESKTOP_WINDOW_ID, { id: APP_UPDATE_STATUS_MESSAGE_ID, content: status }),
      isGameRunning: () => game.isGameProcessRunning,
    })
    appUpdater.start()
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('window-all-closed', () => app.quit())

  // Groups taskbar entries and notifications under the installed app's identity
  app.setAppUserModelId(APP_USER_MODEL_ID)

  void app.whenReady().then(startApp)
}
