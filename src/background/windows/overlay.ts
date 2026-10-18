// Desktop window, in-game overlay and the overlay's satellite windows (controls, pinned checks)
import type { GameState } from '../../platform'
import { logGep } from '../log'
import { platform } from '../runtime'
import { session, slot, windows } from '../state'
import { syncAllBlockerWindows } from './blockers'

const OVERLAY_WINDOW_NAME = 'overlay'
const OVERLAY_CONTROLS_WINDOW_NAME = 'overlay_controls'
const OVERLAY_PINNED_WINDOW_NAME = 'overlay_pinned'
const DESKTOP_WINDOW_NAME = 'desktop'

let isOpeningOverlay = false
let hasOpenedOverlayForCurrentSession = false
let isPinnedChecksWindowShown = false

export function isUsableResolution(gameState: GameState): boolean {
  return gameState.isRunning
    && Number.isFinite(gameState.width)
    && Number.isFinite(gameState.height)
    && gameState.width > 0
    && gameState.height > 0
}

export function updateGameResolution(gameState: GameState): void {
  if (!isUsableResolution(gameState)) return
  session.gameWidth = gameState.width
  session.gameHeight = gameState.height
}

export function applyOverlayBounds(windowId: string, gameState: GameState, reason: string): void {
  if (!isUsableResolution(gameState)) {
    console.warn('Unable to resize overlay because game resolution is unavailable:', gameState)
    return
  }

  const rect = {
    x: 0,
    y: 0,
    w: Math.round(gameState.width),
    h: Math.round(gameState.height),
  }

  void platform.setWindowBounds(windowId, rect).then((success) => {
    if (!success) {
      console.warn('Failed to resize or position overlay window:', { windowId, ...rect })
    }

    logGep('Overlay window bounds synced', {
      reason,
      windowId,
      left: rect.x,
      top: rect.y,
      width: rect.w,
      height: rect.h,
      success,
    })
  })
}

export function openOverlayControlsWindow(reason: string): void {
  void platform.obtainWindow(OVERLAY_CONTROLS_WINDOW_NAME).then((windowId) => {
    if (!windowId) {
      console.warn('Failed to obtain overlay controls window')
      return
    }

    platform.setClickThrough(windowId, false)
    void platform.restoreWindow(windowId).then((restored) => {
      if (!restored) {
        console.warn('Failed to restore overlay controls window')
        return
      }

      platform.bringToFront(windowId, false)
      logGep('Overlay controls window opened', { reason, windowId })
    })
  })
}

// The pinned checks widget has its own draggable window and is only shown while checks are pinned
export function syncPinnedChecksWindow(reason: string, force = false): void {
  const shouldShow = windows.overlayId !== null && slot.pinnedChecks.length > 0
  if (!force && shouldShow === isPinnedChecksWindowShown) return
  isPinnedChecksWindowShown = shouldShow

  void platform.obtainWindow(OVERLAY_PINNED_WINDOW_NAME).then((windowId) => {
    if (!windowId) {
      console.warn('Failed to obtain pinned checks window')
      return
    }

    if (!shouldShow) {
      void platform.hideWindow(windowId)
      return
    }

    platform.setClickThrough(windowId, false)
    void platform.restoreWindow(windowId).then((restored) => {
      if (!restored) {
        console.warn('Failed to restore pinned checks window')
        return
      }

      platform.bringToFront(windowId, false)
      logGep('Pinned checks window opened', { reason, windowId })
    })
  })
}

export function openDesktopWindow(reason: string): void {
  console.log(`Opening desktop window: ${reason}`)

  void platform.obtainWindow(DESKTOP_WINDOW_NAME).then((windowId) => {
    if (!windowId) {
      console.warn('Failed to obtain desktop window')
      return
    }

    void platform.restoreWindow(windowId).then((restored) => {
      if (!restored) {
        console.warn('Failed to restore desktop window')
        return
      }

      platform.bringToFront(windowId, true)
    })
  })
}

function openOverlayWindow(reason: string): void {
  if (isOpeningOverlay) return

  isOpeningOverlay = true
  console.log(`Opening overlay window: ${reason}`)

  void platform.obtainWindow(OVERLAY_WINDOW_NAME).then((windowId) => {
    if (!windowId) {
      isOpeningOverlay = false
      hasOpenedOverlayForCurrentSession = false
      console.warn('Failed to obtain overlay window')
      return
    }

    void platform.restoreWindow(windowId).then((restored) => {
      isOpeningOverlay = false
      if (!restored) {
        hasOpenedOverlayForCurrentSession = false
        windows.overlayId = null
        console.warn('Failed to restore overlay window')
        return
      }

      windows.overlayId = windowId
      platform.setClickThrough(windowId, true)
      logGep('Overlay input pass-through enabled', { windowId })

      void platform.getRunningGame().then((gameState) => {
        if (gameState.isRunning) {
          updateGameResolution(gameState)
          applyOverlayBounds(windowId, gameState, `${reason}; overlay restored`)
        }
        openOverlayControlsWindow(`${reason}; overlay restored`)
        syncPinnedChecksWindow(`${reason}; overlay restored`, true)
        syncAllBlockerWindows(`${reason}; overlay restored`)
      })
    })
  })
}

export function openOverlayOncePerSession(reason: string): void {
  if (hasOpenedOverlayForCurrentSession) return
  hasOpenedOverlayForCurrentSession = true
  openOverlayWindow(reason)
}

export function forgetOverlayForEndedSession(): void {
  hasOpenedOverlayForCurrentSession = false
  windows.overlayId = null
}
