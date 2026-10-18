// Blocker windows: transparent click-catching windows over HUD elements the player has not unlocked
import defaultBlockerProfilesData from '../../data/default-blocker-profiles.json'
import type { AppState, WindowMessage } from '../../types/state'
import type { VisionHudAlignment } from '../../types/vision'
import { deriveState } from '../app-state'
import { sendToConnectedWindows, sendWindowMessage } from '../broadcast'
import { logGep } from '../log'
import { getUsableFreeAugmentPicks } from '../rules/bonus-usage'
import { platform } from '../runtime'
import { getPendingVisionAugmentRerolls } from '../sources/vision'
import { blockers, session, shop, type BlockerRect } from '../state'
import {
  BLOCKER_DEFS,
  clampBlockerRect,
  cloneBlockerProfile,
  getDefaultRect,
  getProfileKey,
  mergeBlockerConfigs,
  normalizeBlockerConfig,
  rectsAgree,
  serializeBlockerConfig,
  type BlockerConfigV3,
  type BlockerDef,
} from './blocker-config'
import {
  SHOP_BLOCKER_HIDE_DELAY_MS,
  computeBlockerStateKey,
  isBlockerActive,
  type BlockerContext,
} from './blocker-rules'
import { openOverlayControlsWindow } from './overlay'

const BLOCKER_CONFIG_PATH = 'TFTArchipelago/blocker-config.json'
const BLOCKER_NATIVE_MIN_SIZE = 1

const windowIds: Record<string, string | null> = Object.fromEntries(
  BLOCKER_DEFS.map(def => [def.windowName, null]),
)
const windowsOpening = new Set<string>()
let lastSyncedStateKey = ''

function getCurrentProfileKey(): string {
  return getProfileKey(session.gameWidth, session.gameHeight)
}

function getBundledBlockerConfig(): BlockerConfigV3 {
  return normalizeBlockerConfig(defaultBlockerProfilesData)
}

function readBlockerConfig(callback: (config: BlockerConfigV3) => void): void {
  const bundledConfig = getBundledBlockerConfig()

  void platform.readDocumentsFile(BLOCKER_CONFIG_PATH).then((content) => {
    if (!content) {
      callback(bundledConfig)
      return
    }

    try {
      callback(mergeBlockerConfigs(bundledConfig, normalizeBlockerConfig(JSON.parse(content))))
    } catch (error) {
      console.warn('Failed to parse blocker config:', error)
      callback(bundledConfig)
    }
  })
}

function writeBlockerConfig(config: BlockerConfigV3, callback: (success: boolean) => void): void {
  const payload = serializeBlockerConfig(config, getBundledBlockerConfig().profiles)
  void platform.writeDocumentsFile(BLOCKER_CONFIG_PATH, payload).then(callback)
}

function getActiveBlockerProfile(): Record<string, BlockerRect> {
  if (!blockers.profiles) return {}
  return blockers.profiles[getCurrentProfileKey()] ?? {}
}

function ensureActiveBlockerProfile(): Record<string, BlockerRect> {
  blockers.profiles ??= {}
  const profileKey = getCurrentProfileKey()
  blockers.profiles[profileKey] ??= {}
  return blockers.profiles[profileKey]
}

function broadcastToBlockerWindows(message: WindowMessage): void {
  for (const def of BLOCKER_DEFS) {
    const windowId = windowIds[def.windowName]
    if (windowId) sendWindowMessage(windowId, message)
  }
}

function sendCalibrationMode(windowId: string, enabled: boolean): void {
  sendWindowMessage(windowId, { id: 'BLOCKER_CALIBRATION_MODE_UPDATE', content: { enabled } })
}

function broadcastCalibrationModeToBlockers(enabled: boolean): void {
  broadcastToBlockerWindows({ id: 'BLOCKER_CALIBRATION_MODE_UPDATE', content: { enabled } })
}

// Priority: calibrated rect for this resolution (unless an anchored vision measurement disagrees),
// then the vision HUD alignment, then linear scaling
function getAbsoluteRect(def: BlockerDef, overrides: Record<string, BlockerRect>): BlockerRect {
  const alignment = blockers.visionAlignment?.profileKey === getCurrentProfileKey() ? blockers.visionAlignment : null
  const aligned = alignment?.blockerRects[def.windowName]
  const calibrated = overrides[def.windowName]
  // A measured HUD position beats a calibration that disagrees with it: calibrations are taken in one
  // window mode, and windowed TFT at 2560x1440 drew the bottom HUD 141 px right of the fullscreen
  // calibration. Small manual tweaks and calibration mode itself keep the calibrated rect.
  const isMeasured = aligned !== undefined && alignment?.anchoredBlockers?.includes(def.windowName) === true
  if (isMeasured && calibrated && !blockers.isCalibrationMode && !rectsAgree(calibrated, aligned)) return aligned
  return calibrated ?? aligned ?? getDefaultRect(def, session.gameWidth, session.gameHeight)
}

function areShopBlockersShown(state: AppState): boolean {
  return state.isShopVisible || (shop.hiddenAt !== null && Date.now() - shop.hiddenAt < SHOP_BLOCKER_HIDE_DELAY_MS)
}

function getBlockerContext(state: AppState): BlockerContext {
  return {
    shopBlockersShown: areShopBlockersShown(state),
    pendingAugmentRerolls: getPendingVisionAugmentRerolls(),
  }
}

function buildBlockerOfferMessage(state: AppState): WindowMessage {
  return { id: 'BLOCKER_OFFER_UPDATE', content: { freeAugmentPicks: getUsableFreeAugmentPicks(state) } }
}

function positionBlockerWindow(windowId: string, windowName: string, rect: BlockerRect): void {
  void platform.setWindowBounds(windowId, rect).then((success) => {
    if (!success) {
      console.warn(`Failed to resize or position blocker window ${windowName}`)
    }

    logGep('Blocker window bounds synced', {
      windowName,
      windowId,
      ...rect,
      success,
    })
  })
}

function setBlockerWindowMinSize(windowId: string, windowName: string, callback: () => void): void {
  void platform.setWindowMinSize(windowId, BLOCKER_NATIVE_MIN_SIZE, BLOCKER_NATIVE_MIN_SIZE).then((success) => {
    if (!success) {
      console.warn(`Failed to set blocker window minimum size ${windowName}`)
    }
    callback()
  })
}

function shouldShowBlockerWindowNow(windowName: string): boolean {
  if (blockers.isCalibrationMode) return true
  const state = deriveState()
  return isBlockerActive(windowName, state, getBlockerContext(state))
}

function showBlockerWindow(windowName: string, rect: BlockerRect): void {
  if (windowsOpening.has(windowName)) return

  const existingWindowId = windowIds[windowName]
  if (existingWindowId) {
    setBlockerWindowMinSize(existingWindowId, windowName, () => {
      if (!shouldShowBlockerWindowNow(windowName)) {
        hideBlockerWindow(windowName)
        return
      }

      positionBlockerWindow(existingWindowId, windowName, rect)
      void platform.restoreWindow(existingWindowId)
      platform.bringToFront(existingWindowId, false)
    })
    return
  }

  windowsOpening.add(windowName)
  void platform.obtainWindow(windowName).then((windowId) => {
    windowsOpening.delete(windowName)

    if (!windowId) {
      console.warn(`Failed to obtain blocker window ${windowName}`)
      return
    }

    windowIds[windowName] = windowId
    platform.setClickThrough(windowId, false)
    setBlockerWindowMinSize(windowId, windowName, () => {
      if (!shouldShowBlockerWindowNow(windowName)) {
        hideBlockerWindow(windowName)
        return
      }

      positionBlockerWindow(windowId, windowName, rect)
      void platform.restoreWindow(windowId).then((restored) => {
        if (!restored) {
          console.warn(`Failed to restore blocker window ${windowName}`)
        }
        if (!shouldShowBlockerWindowNow(windowName)) {
          hideBlockerWindow(windowName)
          return
        }

        platform.bringToFront(windowId, false)
        sendWindowMessage(windowId, buildBlockerOfferMessage(deriveState()))
        if (blockers.isCalibrationMode) sendCalibrationMode(windowId, true)
      })
    })
  })
}

function hideBlockerWindow(windowName: string): void {
  const windowId = windowIds[windowName]
  if (!windowId) return

  void platform.hideWindow(windowId).then((hidden) => {
    if (!hidden) {
      console.warn(`Failed to hide blocker window ${windowName}`)
    }
  })
}

export function resyncAllBlockerPositions(reason: string): void {
  const overrides = getActiveBlockerProfile()
  for (const def of BLOCKER_DEFS) {
    const windowId = windowIds[def.windowName]
    if (windowId) {
      positionBlockerWindow(windowId, def.windowName, getAbsoluteRect(def, overrides))
    }
  }
  logGep('All blocker positions resynced', { reason })
}

function syncAllBlockerWindowsWithLoadedRects(reason: string): void {
  const overrides = getActiveBlockerProfile()
  if (blockers.isCalibrationMode) {
    for (const def of BLOCKER_DEFS) {
      showBlockerWindow(def.windowName, getAbsoluteRect(def, overrides))
    }
    logGep('All blocker windows shown for calibration', { reason, profileKey: getCurrentProfileKey() })
    broadcastCalibrationModeToBlockers(true)
    return
  }

  const state = deriveState()
  const context = getBlockerContext(state)
  for (const def of BLOCKER_DEFS) {
    if (isBlockerActive(def.windowName, state, context)) {
      showBlockerWindow(def.windowName, getAbsoluteRect(def, overrides))
    } else {
      hideBlockerWindow(def.windowName)
    }
  }
  logGep('All blocker windows synced', { reason, profileKey: getCurrentProfileKey() })
}

export function syncAllBlockerWindows(reason: string): void {
  if (blockers.profiles === null) {
    readBlockerConfig((config) => {
      blockers.profiles = config.profiles
      syncAllBlockerWindowsWithLoadedRects(reason)
    })
    return
  }
  syncAllBlockerWindowsWithLoadedRects(reason)
}

// Called with every state broadcast; only touches the windows when a blocker could change
export function syncBlockersWithState(state: AppState): void {
  const stateKey = computeBlockerStateKey(state, getBlockerContext(state))
  if (stateKey === lastSyncedStateKey) return

  lastSyncedStateKey = stateKey
  syncAllBlockerWindows('blocker state changed')
  broadcastToBlockerWindows(buildBlockerOfferMessage(state))
}

function ensureBlockerProfilesLoaded(reason: string): void {
  if (blockers.profiles !== null) return

  readBlockerConfig((config) => {
    blockers.profiles = config.profiles
    logGep('Blocker profiles preloaded', {
      reason,
      profileCount: Object.keys(config.profiles).length,
    })
  })
}

// Creating a window takes a moment; created hidden in advance, a blocker can appear instantly
function prewarmBlockerWindow(windowName: string, reason: string): void {
  if (windowIds[windowName] || windowsOpening.has(windowName)) return

  windowsOpening.add(windowName)
  void platform.obtainWindow(windowName).then((windowId) => {
    windowsOpening.delete(windowName)

    if (!windowId) {
      console.warn(`Failed to prewarm blocker window ${windowName}`)
      return
    }

    windowIds[windowName] = windowId
    platform.setClickThrough(windowId, false)
    setBlockerWindowMinSize(windowId, windowName, () => {
      if (shouldShowBlockerWindowNow(windowName)) {
        syncAllBlockerWindows(`prewarmed blocker became active: ${windowName}`)
        return
      }

      hideBlockerWindow(windowName)
    })
  })

  logGep('Blocker window prewarm requested', { windowName, reason })
}

export function prewarmBlockerWindows(reason: string): void {
  ensureBlockerProfilesLoaded(reason)
  for (const def of BLOCKER_DEFS) {
    prewarmBlockerWindow(def.windowName, reason)
  }
}

export function setBlockerCalibrationMode(enabled: boolean): void {
  blockers.isCalibrationMode = enabled
  for (const def of BLOCKER_DEFS) {
    const windowId = windowIds[def.windowName]
    if (windowId) platform.setWindowFocusable(windowId, enabled)
  }
  sendToConnectedWindows({ id: 'BLOCKER_CALIBRATION_MODE_UPDATE', content: { enabled } })
  if (!enabled) broadcastCalibrationModeToBlockers(false)
  syncAllBlockerWindows(enabled ? 'blocker calibration enabled' : 'blocker calibration disabled')
  openOverlayControlsWindow('blocker calibration mode changed')
}

export function moveBlocker(blockerId: string, rect: BlockerRect): void {
  const activeProfile = ensureActiveBlockerProfile()
  activeProfile[blockerId] = clampBlockerRect(rect)
  logGep('Blocker moved', {
    blockerId,
    profileKey: getCurrentProfileKey(),
    ...activeProfile[blockerId],
  })
}

export function saveBlockerConfig(): void {
  writeBlockerConfig({ version: 3, profiles: blockers.profiles ?? {} }, (success) => {
    sendToConnectedWindows({ id: 'BLOCKER_CONFIG_SAVE_RESULT', content: { success, isReset: false } })
    logGep('Blocker config saved', { success, profileKey: getCurrentProfileKey() })
  })
}

export function resetBlockerProfile(): void {
  blockers.profiles ??= {}
  const profileKey = getCurrentProfileKey()
  const bundledProfile = getBundledBlockerConfig().profiles[profileKey]
  if (bundledProfile) {
    blockers.profiles[profileKey] = cloneBlockerProfile(bundledProfile)
  } else {
    delete blockers.profiles[profileKey]
  }
  writeBlockerConfig({ version: 3, profiles: blockers.profiles }, (success) => {
    sendToConnectedWindows({ id: 'BLOCKER_CONFIG_SAVE_RESULT', content: { success, isReset: true } })
    logGep('Blocker profile reset to bundled defaults', { success, profileKey })
  })
  resyncAllBlockerPositions('reset to defaults')
  broadcastCalibrationModeToBlockers(true)
}

export function setVisionHudAlignment(alignment: VisionHudAlignment): void {
  blockers.visionAlignment = alignment
  logGep('Vision HUD alignment received', {
    profileKey: alignment.profileKey,
    anchoredBlockers: alignment.anchoredBlockers ?? [],
  })
  resyncAllBlockerPositions('vision HUD alignment')
}
