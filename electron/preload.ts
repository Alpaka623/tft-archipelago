import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  BRIDGE_GAME_STATE_CHANNEL,
  BRIDGE_INVOKE_CHANNEL,
  BRIDGE_MESSAGE_CHANNEL,
  type BridgeRequest,
  type BridgeResponses,
  type ElectronBridge,
} from '../src/platform/bridge'
import type { GameStateChange, PlatformMessage } from '../src/platform/types'

// Messages can arrive before React registers its listener; hold them until then
const messageHandlers = new Set<(message: PlatformMessage) => void>()
const pendingMessages: PlatformMessage[] = []

ipcRenderer.on(BRIDGE_MESSAGE_CHANNEL, (_event: IpcRendererEvent, message: PlatformMessage) => {
  if (messageHandlers.size === 0) {
    pendingMessages.push(message)
    return
  }
  for (const handler of messageHandlers) handler(message)
})

const bridge: ElectronBridge = {
  invoke<T extends BridgeRequest>(request: T) {
    return ipcRenderer.invoke(BRIDGE_INVOKE_CHANNEL, request) as Promise<BridgeResponses[T['type']]>
  },

  onMessage(handler) {
    messageHandlers.add(handler)
    for (const message of pendingMessages.splice(0)) handler(message)
    return () => {
      messageHandlers.delete(handler)
    }
  },

  onGameStateChanged(handler) {
    const listener = (_event: IpcRendererEvent, change: GameStateChange) => handler(change)
    ipcRenderer.on(BRIDGE_GAME_STATE_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(BRIDGE_GAME_STATE_CHANNEL, listener)
    }
  },
}

contextBridge.exposeInMainWorld('tftPlatform', bridge)
