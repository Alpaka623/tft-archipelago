import type { WindowMessage } from '../types/state'
import { deriveState } from './app-state'
import { platform } from './runtime'
import { windows } from './state'
import { syncBlockersWithState } from './windows/blockers'
import { syncPinnedChecksWindow } from './windows/overlay'

export function sendWindowMessage(windowId: string, message: WindowMessage): void {
  platform.sendMessage(windowId, message.id, message.content)
}

export function sendToConnectedWindows(message: WindowMessage): void {
  for (const windowId of windows.connected) {
    sendWindowMessage(windowId, message)
  }
}

export function broadcastState(): void {
  const state = deriveState()
  sendToConnectedWindows({ id: 'STATE_UPDATE', content: state })
  syncPinnedChecksWindow('state broadcast')
  syncBlockersWithState(state)
}
