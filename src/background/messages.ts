// Messages from the app's windows to the background controller
import type { DebugGameEvent } from '../types/debug'
import type { VisionGameState, VisionHudAlignment } from '../types/vision'
import { TFT_END_OF_GAME_MESSAGE_ID, TFT_LOG_EVENTS_MESSAGE_ID, type TftEndOfGameFile, type TftLogBatch } from '../platform/tft-log'
import { deriveState } from './app-state'
import { sendChecks } from './archipelago/checks'
import { connect, setPinnedChecks } from './archipelago/connection'
import { sendWindowMessage } from './broadcast'
import { spendFreeAugmentPickFromBlocker } from './rules/bonus-usage'
import { overrideViolation } from './rules/violations'
import { client, platform } from './runtime'
import { handleEndOfGameFile, handleTftLogBatch } from './session'
import { handleDebugGameEvent } from './sources/debug'
import { handleVisionGameState, handleVisionLayoutChanged } from './sources/vision'
import { windows } from './state'
import {
  moveBlocker,
  resetBlockerProfile,
  saveBlockerConfig,
  setBlockerCalibrationMode,
  setVisionHudAlignment,
} from './windows/blockers'

function handleMessage(id: string, content: Record<string, unknown>): void {
  switch (id) {
    case 'WINDOW_MOUNTED': {
      const windowId = content['windowId'] as string
      windows.connected.add(windowId)
      sendWindowMessage(windowId, { id: 'STATE_UPDATE', content: deriveState() })
      break
    }
    case 'CONNECT':
      connect({
        hostname: content['hostname'] as string,
        port: content['port'] as number,
        slotName: content['slotName'] as string,
        password: (content['password'] as string) ?? '',
      }).catch(error => console.error('Connect failed:', error))
      break
    case 'SEND_CHECKS':
      sendChecks(content['ids'] as number[])
      break
    case 'SET_PINNED_CHECKS':
      setPinnedChecks(content['checks'])
      break
    case 'SET_BLOCKER_CALIBRATION_MODE':
      setBlockerCalibrationMode(content['enabled'] === true)
      break
    case 'USE_FREE_AUGMENT_PICK':
      spendFreeAugmentPickFromBlocker()
      break
    case 'BLOCKER_MOVED':
      moveBlocker(content['blockerId'] as string, {
        x: content['x'] as number,
        y: content['y'] as number,
        w: content['w'] as number,
        h: content['h'] as number,
      })
      break
    case 'SAVE_BLOCKER_CONFIG':
      saveBlockerConfig()
      break
    case 'RESET_BLOCKER_CONFIG':
      resetBlockerProfile()
      break
    case 'GOAL':
      if (client.authenticated) client.goal()
      break
    case 'OVERRIDE_VIOLATION':
      void overrideViolation()
      break
    case TFT_LOG_EVENTS_MESSAGE_ID:
      handleTftLogBatch(content as unknown as TftLogBatch)
      break
    case TFT_END_OF_GAME_MESSAGE_ID:
      handleEndOfGameFile(content as unknown as TftEndOfGameFile)
      break
    case 'VISION_LAYOUT_CHANGED':
      handleVisionLayoutChanged()
      break
    case 'VISION_HUD_ALIGNMENT':
      setVisionHudAlignment(content as unknown as VisionHudAlignment)
      break
    case 'VISION_GAME_STATE':
      handleVisionGameState(content as unknown as VisionGameState)
      break
    case 'DEBUG_GAME_EVENT':
      handleDebugGameEvent(content as unknown as DebugGameEvent)
      break
  }
}

export function listenForWindowMessages(): void {
  platform.onMessage((message) => {
    const { id, content } = message as { id: string; content: Record<string, unknown> }
    handleMessage(id, content)
  })
}
