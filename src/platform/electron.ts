import type { ElectronBridge } from './bridge'
import type { Platform } from './types'

export function createElectronPlatform(bridge: ElectronBridge): Platform {
  return {
    kind: 'electron',

    obtainWindow: (name) => bridge.invoke({ type: 'obtainWindow', name }),
    restoreWindow: (windowId) => bridge.invoke({ type: 'restoreWindow', windowId }),
    hideWindow: (windowId) => bridge.invoke({ type: 'hideWindow', windowId }),
    bringToFront: (windowId, grabFocus) => {
      void bridge.invoke({ type: 'bringToFront', windowId, grabFocus })
    },
    setWindowBounds: (windowId, rect) => bridge.invoke({ type: 'setWindowBounds', windowId, rect }),
    setWindowMinSize: (windowId, width, height) => bridge.invoke({ type: 'setWindowMinSize', windowId, width, height }),
    setClickThrough: (windowId, enabled) => {
      void bridge.invoke({ type: 'setClickThrough', windowId, enabled })
    },
    setWindowFocusable: (windowId, enabled) => {
      void bridge.invoke({ type: 'setWindowFocusable', windowId, enabled })
    },

    getCurrentWindow: () => bridge.invoke({ type: 'getCurrentWindow' }),
    changeWindowPosition: (windowId, x, y) => {
      void bridge.invoke({ type: 'changeWindowPosition', windowId, x: Math.round(x), y: Math.round(y) })
    },
    changeWindowSize: (windowId, width, height) => {
      void bridge.invoke({ type: 'changeWindowSize', windowId, width: Math.round(width), height: Math.round(height) })
    },
    // Electron frameless windows drag through the CSS `-webkit-app-region: drag` rule instead
    dragMove: () => {},
    dragWindow: (windowId, mode, limits) => bridge.invoke({ type: 'dragWindow', windowId, mode, limits }),
    minimizeWindow: (windowId) => {
      void bridge.invoke({ type: 'minimizeWindow', windowId })
    },
    maximizeWindow: (windowId) => bridge.invoke({ type: 'maximizeWindow', windowId }),
    closeWindow: (windowId) => {
      void bridge.invoke({ type: 'closeWindow', windowId })
    },
    // Window coordinates are physical pixels while pointer deltas are CSS pixels
    pointerToWindowScale: () => window.devicePixelRatio || 1,

    sendMessage: (windowId, id, content) => {
      void bridge.invoke({ type: 'sendMessage', windowId, message: { id, content } })
    },
    onMessage: (handler) => bridge.onMessage(handler),

    readDocumentsFile: (relativePath, encoding) => bridge.invoke({ type: 'readDocumentsFile', relativePath, encoding }),
    writeDocumentsFile: (relativePath, content, encoding) => bridge.invoke({ type: 'writeDocumentsFile', relativePath, content, encoding }),

    getRunningGame: () => bridge.invoke({ type: 'getRunningGame' }),
    onGameStateChanged: (handler) => {
      bridge.onGameStateChanged(handler)
    },
    listCandidateWindows: () => bridge.invoke({ type: 'listCandidateWindows' }),
    getCaptureSourceId: () => bridge.invoke({ type: 'getCaptureSourceId' }),
    getCaptureGeometry: () => bridge.invoke({ type: 'getCaptureGeometry' }),
    clientApiGet: (apiPath) => bridge.invoke({ type: 'clientApiGet', apiPath }),
    saveDownload: (download) => bridge.invoke({ type: 'saveDownload', download }),
    pruneViolationEvidence: () => bridge.invoke({ type: 'pruneViolationEvidence' }),
    getUpdateStatus: () => bridge.invoke({ type: 'getUpdateStatus' }),
    installUpdate: () => bridge.invoke({ type: 'installUpdate' }),
    openExternalUrl: (url) => {
      void bridge.invoke({ type: 'openExternalUrl', url })
    },
  }
}
