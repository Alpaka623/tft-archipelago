// Finds the TFT game window through read-only Win32 window queries (no hooks,
// no injection, no memory access). All rects are physical screen pixels.
import path from 'node:path'
import koffi from 'koffi'
import type { CandidateWindowInfo } from '../src/platform/types'

export interface PhysicalRect {
  x: number
  y: number
  width: number
  height: number
}

export interface GameWindowSnapshot {
  isRunning: boolean
  isMinimized: boolean
  // Client area of the game window, excluding borders/title bar
  clientRect: PhysicalRect | null
  // Foreground window info used for overlay visibility decisions
  foregroundIsGame: boolean
  foregroundIsOwnProcess: boolean
  foregroundRect: PhysicalRect | null
}

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const SM_CXSCREEN = 0
const SM_CYSCREEN = 1
const SM_SWAPBUTTON = 23
const VK_LBUTTON = 0x01
const VK_RBUTTON = 0x02
const KEY_DOWN_BIT = 0x8000
const PROCESS_NAME_CACHE_RESET_MS = 60_000
const MAX_TITLE_LENGTH = 512

const user32 = koffi.load('user32.dll')
const kernel32 = koffi.load('kernel32.dll')

const HANDLE = koffi.pointer('HANDLE', koffi.opaque())
koffi.alias('HWND', HANDLE)
koffi.alias('DWORD', 'uint32_t')
koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
koffi.struct('POINT', { x: 'long', y: 'long' })
const GUITHREADINFO = koffi.struct('GUITHREADINFO', {
  cbSize: 'DWORD',
  flags: 'DWORD',
  hwndActive: 'HWND',
  hwndFocus: 'HWND',
  hwndCapture: 'HWND',
  hwndMenuOwner: 'HWND',
  hwndMoveSize: 'HWND',
  hwndCaret: 'HWND',
  rcCaret: 'RECT',
})

const FindWindowExW = user32.func('HWND __stdcall FindWindowExW(HWND hWndParent, HWND hWndChildAfter, const char16_t *lpszClass, const char16_t *lpszWindow)')
const IsWindow = user32.func('bool __stdcall IsWindow(HWND hWnd)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hWnd)')
const IsIconic = user32.func('bool __stdcall IsIconic(HWND hWnd)')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(HWND hWnd, _Out_ uint8_t *lpString, int nMaxCount)')
const GetWindowThreadProcessId = user32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)')
const GetClientRect = user32.func('bool __stdcall GetClientRect(HWND hWnd, _Out_ RECT *lpRect)')
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(HWND hWnd, _Out_ RECT *lpRect)')
const ClientToScreen = user32.func('bool __stdcall ClientToScreen(HWND hWnd, _Inout_ POINT *lpPoint)')
const GetForegroundWindow = user32.func('HWND __stdcall GetForegroundWindow()')
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)')
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ POINT *lpPoint)')
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)')
const GetGUIThreadInfo = user32.func('bool __stdcall GetGUIThreadInfo(DWORD idThread, _Inout_ GUITHREADINFO *pgui)')
const dwmapi = koffi.load('dwmapi.dll')
const DwmGetWindowAttribute = dwmapi.func('int __stdcall DwmGetWindowAttribute(HWND hwnd, DWORD dwAttribute, _Out_ RECT *pvAttribute, DWORD cbAttribute)')
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const RECT_SIZE = 16
const OpenProcess = kernel32.func('HANDLE __stdcall OpenProcess(DWORD dwDesiredAccess, bool bInheritHandle, DWORD dwProcessId)')
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(HANDLE hProcess, DWORD dwFlags, _Out_ uint8_t *lpExeName, _Inout_ DWORD *lpdwSize)')
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(HANDLE hObject)')

type Hwnd = unknown

interface Win32Rect { left: number; top: number; right: number; bottom: number }

let processNameCache = new Map<number, string>()
let processNameCacheCreatedAt = Date.now()

function isSameWindow(left: Hwnd | null, right: Hwnd | null): boolean {
  if (!left || !right) return false
  return koffi.address(left) === koffi.address(right)
}

function getWindowProcessId(hwnd: Hwnd): number | null {
  const out = [0]
  const threadId = GetWindowThreadProcessId(hwnd, out) as number
  return threadId ? out[0] : null
}

function getProcessName(pid: number): string {
  if (Date.now() - processNameCacheCreatedAt > PROCESS_NAME_CACHE_RESET_MS) {
    processNameCache = new Map()
    processNameCacheCreatedAt = Date.now()
  }

  const cached = processNameCache.get(pid)
  if (cached !== undefined) return cached

  let name = ''
  const processHandle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
  if (processHandle) {
    const buffer = Buffer.alloc(1024 * 2)
    const size = [1024]
    if (QueryFullProcessImageNameW(processHandle, 0, buffer, size)) {
      name = path.win32.basename(buffer.toString('utf16le', 0, size[0] * 2))
    }
    CloseHandle(processHandle)
  }

  processNameCache.set(pid, name)
  return name
}

function getWindowTitle(hwnd: Hwnd): string {
  const buffer = Buffer.alloc(MAX_TITLE_LENGTH * 2)
  const length = GetWindowTextW(hwnd, buffer, MAX_TITLE_LENGTH) as number
  return length > 0 ? buffer.toString('utf16le', 0, length * 2) : ''
}

function toPhysicalRect(rect: Win32Rect): PhysicalRect {
  return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }
}

function getWindowRect(hwnd: Hwnd): PhysicalRect | null {
  const rect: Win32Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  return GetWindowRect(hwnd, rect) ? toPhysicalRect(rect) : null
}

function getClientScreenRect(hwnd: Hwnd): PhysicalRect | null {
  const rect: Win32Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  if (!GetClientRect(hwnd, rect)) return null

  const origin = { x: 0, y: 0 }
  if (!ClientToScreen(hwnd, origin)) return null

  return { x: origin.x, y: origin.y, width: rect.right - rect.left, height: rect.bottom - rect.top }
}

function* visibleTopLevelWindows(): Generator<Hwnd> {
  for (let hwnd: Hwnd | null = null; ;) {
    hwnd = FindWindowExW(null, hwnd, null, null) as Hwnd | null
    if (!hwnd) return
    if (IsWindowVisible(hwnd)) yield hwnd
  }
}

// Exact physical primary monitor rect (Electron's DIP round trip can be off by one pixel)
// Visible window bounds as captured by Windows Graphics Capture (excludes invisible resize borders)
function getVisibleFrameRect(hwnd: Hwnd): PhysicalRect | null {
  const rect: Win32Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  return DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, RECT_SIZE) === 0 ? toPhysicalRect(rect) : null
}

export interface CaptureGeometry {
  // Client area origin inside the captured window frame, and the client size
  offsetX: number
  offsetY: number
  clientWidth: number
  clientHeight: number
}

export function getPrimaryMonitorRect(): PhysicalRect {
  return { x: 0, y: 0, width: GetSystemMetrics(SM_CXSCREEN) as number, height: GetSystemMetrics(SM_CYSCREEN) as number }
}

// Cursor position in physical screen pixels (read-only, used by in-game widget drags)
export function getCursorPhysicalPoint(): { x: number; y: number } {
  const point = { x: 0, y: 0 }
  GetCursorPos(point)
  return point
}

// GetAsyncKeyState reads physical buttons, so honor the swapped-buttons setting
export function isPrimaryMouseButtonDown(): boolean {
  const vKey = GetSystemMetrics(SM_SWAPBUTTON) ? VK_RBUTTON : VK_LBUTTON
  return ((GetAsyncKeyState(vKey) as number) & KEY_DOWN_BIT) !== 0
}

export class GameMonitor {
  private gameWindow: Hwnd | null = null
  private normalizedProcessNames: Set<string>

  constructor(processNames: string[]) {
    this.normalizedProcessNames = new Set(processNames.map(name => name.trim().toLowerCase()).filter(Boolean))
  }

  private isGameProcessName(processName: string): boolean {
    return this.normalizedProcessNames.has(processName.toLowerCase())
  }

  private isGameWindow(hwnd: Hwnd): boolean {
    const pid = getWindowProcessId(hwnd)
    if (pid === null) return false
    return this.isGameProcessName(getProcessName(pid))
  }

  private findGameWindow(): Hwnd | null {
    if (this.gameWindow && IsWindow(this.gameWindow) && IsWindowVisible(this.gameWindow)) {
      return this.gameWindow
    }

    this.gameWindow = null
    let best: { hwnd: Hwnd; area: number } | null = null
    for (const hwnd of visibleTopLevelWindows()) {
      if (!this.isGameWindow(hwnd)) continue
      // A game process can own helper windows; the largest one is the render window
      const rect = getWindowRect(hwnd)
      const area = rect ? rect.width * rect.height : 0
      if (!best || area > best.area) best = { hwnd, area }
    }

    this.gameWindow = best?.hwnd ?? null
    return this.gameWindow
  }

  snapshot(): GameWindowSnapshot {
    const gameWindow = this.findGameWindow()
    const foreground = GetForegroundWindow() as Hwnd | null
    const foregroundPid = foreground ? getWindowProcessId(foreground) : null

    return {
      isRunning: gameWindow !== null,
      isMinimized: gameWindow ? Boolean(IsIconic(gameWindow)) : false,
      clientRect: gameWindow ? getClientScreenRect(gameWindow) : null,
      foregroundIsGame: isSameWindow(foreground, gameWindow),
      foregroundIsOwnProcess: foregroundPid === process.pid,
      foregroundRect: foreground ? getWindowRect(foreground) : null,
    }
  }

  // TFT keeps the mouse captured while it is in the foreground, so Windows routes every click to
  // it, even over overlay windows (see click-forwarder.ts)
  isGameHoldingMouseCapture(): boolean {
    if (!this.gameWindow) return false
    const threadId = GetWindowThreadProcessId(this.gameWindow, [0]) as number
    if (!threadId) return false
    const info = { cbSize: koffi.sizeof(GUITHREADINFO) } as { cbSize: number; hwndCapture?: Hwnd | null }
    return Boolean(GetGUIThreadInfo(threadId, info)) && Boolean(info.hwndCapture)
  }

  // Raw HWND value, used to match the desktopCapturer source id 'window:<hwnd>:0'
  // Maps window-capture frame coordinates to game client coordinates (title bar and borders in
  // windowed mode; zero offset in borderless/fullscreen)
  getCaptureGeometry(): CaptureGeometry | null {
    if (!this.gameWindow) return null
    const client = getClientScreenRect(this.gameWindow)
    if (!client) return null
    const frame = getVisibleFrameRect(this.gameWindow) ?? client
    return { offsetX: client.x - frame.x, offsetY: client.y - frame.y, clientWidth: client.width, clientHeight: client.height }
  }

  getGameWindowHandle(): bigint | null {
    return this.gameWindow ? koffi.address(this.gameWindow) : null
  }

  listCandidateWindows(): CandidateWindowInfo[] {
    const result: CandidateWindowInfo[] = []
    for (const hwnd of visibleTopLevelWindows()) {
      const title = getWindowTitle(hwnd)
      if (!title) continue

      const pid = getWindowProcessId(hwnd)
      const processName = pid === null ? '' : getProcessName(pid)
      const rect = getWindowRect(hwnd)
      result.push({
        title,
        processName,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
        isGame: this.isGameProcessName(processName),
      })
    }
    return result
  }
}
