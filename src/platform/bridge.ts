// IPC contract between the Electron main process, the preload script and the
// renderer-side Electron platform. Imported by both electron/ and src/.

import type {
  AppUpdateStatus,
  CandidateWindowInfo,
  CaptureGeometry,
  DiscordPresenceStatus,
  ClientApiResponse,
  EvidencePruneResult,
  FileEncoding,
  GameState,
  GameStateChange,
  PlatformMessage,
  PlatformRect,
  PlatformWindowInfo,
  RichPresence,
  SaveDownloadRequest,
  WindowDragLimits,
  WindowDragMode,
} from './types'

export const BRIDGE_INVOKE_CHANNEL = 'tft-platform:invoke'
export const BRIDGE_MESSAGE_CHANNEL = 'tft-platform:message'
export const BRIDGE_GAME_STATE_CHANNEL = 'tft-platform:game-state'

export type BridgeRequest =
  | { type: 'obtainWindow'; name: string }
  | { type: 'restoreWindow'; windowId: string }
  | { type: 'hideWindow'; windowId: string }
  | { type: 'bringToFront'; windowId: string; grabFocus: boolean }
  | { type: 'setWindowBounds'; windowId: string; rect: PlatformRect }
  | { type: 'setWindowMinSize'; windowId: string; width: number; height: number }
  | { type: 'setClickThrough'; windowId: string; enabled: boolean }
  | { type: 'setWindowFocusable'; windowId: string; enabled: boolean }
  | { type: 'getCurrentWindow' }
  | { type: 'changeWindowPosition'; windowId: string; x: number; y: number }
  | { type: 'changeWindowSize'; windowId: string; width: number; height: number }
  | { type: 'dragWindow'; windowId: string; mode: WindowDragMode; limits: WindowDragLimits }
  | { type: 'minimizeWindow'; windowId: string }
  | { type: 'maximizeWindow'; windowId: string }
  | { type: 'closeWindow'; windowId: string }
  | { type: 'sendMessage'; windowId: string; message: PlatformMessage }
  | { type: 'readDocumentsFile'; relativePath: string; encoding?: FileEncoding }
  | { type: 'writeDocumentsFile'; relativePath: string; content: string; encoding?: FileEncoding }
  | { type: 'getRunningGame' }
  | { type: 'listCandidateWindows' }
  | { type: 'getCaptureSourceId' }
  | { type: 'getCaptureGeometry' }
  | { type: 'clientApiGet'; apiPath: string }
  | { type: 'saveDownload'; download: SaveDownloadRequest }
  | { type: 'pruneViolationEvidence' }
  | { type: 'getUpdateStatus' }
  | { type: 'installUpdate' }
  | { type: 'openExternalUrl'; url: string }
  | { type: 'setRichPresence'; presence: RichPresence | null }
  | { type: 'getDiscordPresenceStatus' }
  | { type: 'setDiscordPresenceEnabled'; enabled: boolean }

export interface BridgeResponses {
  obtainWindow: string | null
  restoreWindow: boolean
  hideWindow: boolean
  bringToFront: void
  setWindowBounds: boolean
  setWindowMinSize: boolean
  setClickThrough: void
  setWindowFocusable: void
  getCurrentWindow: PlatformWindowInfo | null
  changeWindowPosition: void
  changeWindowSize: void
  dragWindow: PlatformRect | null
  minimizeWindow: void
  maximizeWindow: boolean
  closeWindow: void
  sendMessage: void
  readDocumentsFile: string | null
  writeDocumentsFile: boolean
  getRunningGame: GameState
  listCandidateWindows: CandidateWindowInfo[]
  getCaptureSourceId: string | null
  getCaptureGeometry: CaptureGeometry | null
  clientApiGet: ClientApiResponse | null
  saveDownload: string | null
  pruneViolationEvidence: EvidencePruneResult
  getUpdateStatus: AppUpdateStatus | null
  installUpdate: boolean
  openExternalUrl: void
  setRichPresence: void
  getDiscordPresenceStatus: DiscordPresenceStatus
  setDiscordPresenceEnabled: DiscordPresenceStatus
}

export interface ElectronBridge {
  invoke<T extends BridgeRequest>(request: T): Promise<BridgeResponses[T['type']]>
  onMessage(handler: (message: PlatformMessage) => void): () => void
  onGameStateChanged(handler: (change: GameStateChange) => void): () => void
}

declare global {
  interface Window {
    tftPlatform?: ElectronBridge
  }
}
