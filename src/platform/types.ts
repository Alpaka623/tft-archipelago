// Shared by the Overwolf and Electron runtimes.
// All in-game window rects are physical pixels relative to the TFT client area's top-left;
// each platform converts to its own window space.

export type PlatformKind = 'overwolf' | 'electron'

export interface PlatformRect {
  x: number
  y: number
  w: number
  h: number
}

export interface PlatformWindowInfo {
  id: string
  name: string
  left: number
  top: number
  width: number
  height: number
}

export type WindowDragMode = 'move' | 'scale'

// Window width limits for 'scale' drags, in window pixels
export interface WindowDragLimits {
  minWidth: number
  maxWidth: number
}

export interface PlatformMessage {
  id: string
  content: unknown
}

export interface GameState {
  isRunning: boolean
  width: number
  height: number
}

export interface GameStateChange {
  state: GameState
  resolutionChanged: boolean
}

export interface CandidateWindowInfo {
  title: string
  processName: string
  width: number
  height: number
  isGame: boolean
}

export interface Platform {
  kind: PlatformKind

  obtainWindow(name: string): Promise<string | null>
  restoreWindow(windowId: string): Promise<boolean>
  hideWindow(windowId: string): Promise<boolean>
  bringToFront(windowId: string, grabFocus: boolean): void
  setWindowBounds(windowId: string, rect: PlatformRect): Promise<boolean>
  setWindowMinSize(windowId: string, width: number, height: number): Promise<boolean>
  setClickThrough(windowId: string, enabled: boolean): void
  // In-game windows never take focus during play; calibration enables it so drags keep mouse capture
  setWindowFocusable(windowId: string, enabled: boolean): void

  getCurrentWindow(): Promise<PlatformWindowInfo | null>
  changeWindowPosition(windowId: string, x: number, y: number): void
  changeWindowSize(windowId: string, width: number, height: number): void
  dragMove(windowId: string): void
  // drags until mouse up, resolves with the final rect. 'scale' = bottom-right corner,
  // Electron keeps the aspect ratio
  dragWindow(windowId: string, mode: WindowDragMode, limits: WindowDragLimits): Promise<PlatformRect | null>
  minimizeWindow(windowId: string): void
  maximizeWindow(windowId: string): Promise<boolean>
  closeWindow(windowId: string): void
  // Multiplier from CSS pointer deltas to window coordinate deltas
  pointerToWindowScale(): number

  sendMessage(windowId: string, id: string, content: unknown): void
  onMessage(handler: (message: PlatformMessage) => void): () => void

  // Files relative to the user's Documents folder; 'base64' transfers binary content
  readDocumentsFile(relativePath: string, encoding?: FileEncoding): Promise<string | null>
  writeDocumentsFile(relativePath: string, content: string, encoding?: FileEncoding): Promise<boolean>

  getRunningGame(): Promise<GameState>
  onGameStateChanged(handler: (change: GameStateChange) => void): void
  // Diagnostic list of visible top-level windows (Electron only, empty on Overwolf)
  listCandidateWindows(): Promise<CandidateWindowInfo[]>
  // Desktop capture source id of the TFT window for getUserMedia (Electron only, null on Overwolf)
  getCaptureSourceId(): Promise<string | null>
  // Offset of the game client area inside the captured frame (Electron only, null on Overwolf)
  getCaptureGeometry(): Promise<CaptureGeometry | null>
  // Read-only GET on the Riot client's local API (Electron only); null when the client is not reachable
  clientApiGet(apiPath: string): Promise<ClientApiResponse | null>
  // Electron shows a save dialog, Overwolf writes to Documents/TFTArchipelago. null = cancelled/failed
  saveDownload(request: SaveDownloadRequest): Promise<string | null>
  // Deletes all but the newest rule violation evidence folders (Electron only, null on Overwolf)
  pruneViolationEvidence(): Promise<EvidencePruneResult | null>
  // Electron installs only; changes arrive as APP_UPDATE_STATUS_MESSAGE_ID
  getUpdateStatus(): Promise<AppUpdateStatus | null>
  // false while TFT is running
  installUpdate(): Promise<boolean>
  // https only
  openExternalUrl(url: string): void

  // Discord Rich Presence (Electron only); null clears it
  setRichPresence(presence: RichPresence | null): void
  // null on Overwolf; changes arrive as DISCORD_PRESENCE_STATUS_MESSAGE_ID
  getDiscordPresenceStatus(): Promise<DiscordPresenceStatus | null>
  setDiscordPresenceEnabled(enabled: boolean): Promise<DiscordPresenceStatus | null>
}

export interface RichPresence {
  details: string
  state: string | null
  // Epoch ms; Discord shows the elapsed time since then
  startedAt: number | null
  // Small status icon; null shows none
  runStatus: 'valid' | 'invalid' | null
}

export interface DiscordPresenceStatus {
  enabled: boolean
  // Connected to a running Discord client
  connected: boolean
}

export const DISCORD_PRESENCE_STATUS_MESSAGE_ID = 'DISCORD_PRESENCE_STATUS'

export type AppUpdateState = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

export interface AppUpdateStatus {
  state: AppUpdateState
  // Version being downloaded or ready to install
  version: string | null
  // Download progress 0-100 while downloading
  percent: number | null
  error: string | null
}

export const APP_UPDATE_STATUS_MESSAGE_ID = 'APP_UPDATE_STATUS'

// keeps file: and custom protocols away from the OS
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

// Either text generated in the renderer or a file shipped with the app (path relative to the app root)
export type SaveDownloadRequest =
  | { fileName: string; text: string }
  | { fileName: string; bundledPath: string }

export interface EvidencePruneResult {
  keptFolders: number
  deletedFolders: number
  freedBytes: number
}

export interface ClientApiResponse {
  status: number
  data: unknown
}

export interface CaptureGeometry {
  offsetX: number
  offsetY: number
  clientWidth: number
  clientHeight: number
}

export type FileEncoding = 'utf8' | 'base64'

export const BACKGROUND_WINDOW_ID = 'background'

export const NOT_RUNNING_GAME_STATE: GameState = { isRunning: false, width: 0, height: 0 }
