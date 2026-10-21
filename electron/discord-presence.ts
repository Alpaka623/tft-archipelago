import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { DiscordPresenceStatus, RichPresence } from '../src/platform/types'

// Discord Rich Presence through the local Discord client's IPC pipe. Each frame is
// opcode (int32 LE), payload length (int32 LE) and a JSON payload.

const CLIENT_ID = '1562494453414105128'
const PIPE_COUNT = 10
const RECONNECT_INTERVAL_MS = 30_000
// Discord accepts 5 activity updates per 20 seconds
const MIN_UPDATE_INTERVAL_MS = 4_000
const WEBSITE_URL = 'https://alpaka623.github.io/tft-archipelago/'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4
const HEADER_SIZE = 8

// Asset keys uploaded in the Discord Developer Portal; they cannot be renamed there
const LARGE_IMAGE_KEY = 'logo'
const RUN_STATUS_IMAGE_KEYS = { valid: 'run_valid', invalid: 'run_invalid' } as const
const RUN_STATUS_TEXTS = { valid: 'Run valid', invalid: 'Run invalidated' } as const

function encodeFrame(opcode: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(HEADER_SIZE)
  header.writeInt32LE(opcode, 0)
  header.writeInt32LE(json.length, 4)
  return Buffer.concat([header, json])
}

function pipePath(index: number): string {
  return `\\\\?\\pipe\\discord-ipc-${index}`
}

function connectPipe(index: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(pipePath(index))
    socket.once('connect', () => {
      socket.removeAllListeners('error')
      resolve(socket)
    })
    socket.once('error', () => resolve(null))
  })
}

// Discord rejects fields shorter than 2 or longer than 128 characters
function clampText(text: string): string {
  const trimmed = text.length > 128 ? `${text.slice(0, 127)}…` : text
  return trimmed.length < 2 ? `${trimmed}  ` : trimmed
}

function toActivity(presence: RichPresence): Record<string, unknown> {
  return {
    details: clampText(presence.details),
    ...(presence.state ? { state: clampText(presence.state) } : {}),
    ...(presence.startedAt ? { timestamps: { start: presence.startedAt } } : {}),
    assets: {
      large_image: LARGE_IMAGE_KEY,
      large_text: 'TFT Archipelago',
      ...(presence.runStatus
        ? { small_image: RUN_STATUS_IMAGE_KEYS[presence.runStatus], small_text: RUN_STATUS_TEXTS[presence.runStatus] }
        : {}),
    },
    buttons: [{ label: 'Get TFT Archipelago', url: WEBSITE_URL }],
  }
}

export class DiscordPresence {
  private enabled: boolean
  private socket: net.Socket | null = null
  private isConnecting = false
  private isReady = false
  private receiveBuffer = Buffer.alloc(0)
  private reconnectTimer: NodeJS.Timeout | null = null
  private updateTimer: NodeJS.Timeout | null = null
  private lastUpdateAt = 0
  private nonce = 0
  private presence: RichPresence | null = null
  // JSON of the activity Discord shows now; null = nothing sent on this connection
  private sentActivityKey: string | null = null

  constructor(private readonly settingsPath: string, private readonly onStatus: (status: DiscordPresenceStatus) => void) {
    this.enabled = this.readEnabled()
  }

  start(): void {
    if (this.enabled) void this.connect()
  }

  getStatus(): DiscordPresenceStatus {
    return { enabled: this.enabled, connected: this.isReady }
  }

  setPresence(presence: RichPresence | null): void {
    this.presence = presence
    this.scheduleUpdate()
  }

  setEnabled(enabled: boolean): DiscordPresenceStatus {
    if (enabled === this.enabled) return this.getStatus()
    this.enabled = enabled
    this.writeEnabled()
    if (enabled) {
      void this.connect()
    } else {
      // Closing the pipe clears the activity in Discord
      this.disconnect()
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.emitStatus()
    return this.getStatus()
  }

  private readEnabled(): boolean {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Record<string, unknown>
      return raw['enabled'] !== false
    } catch {
      return true
    }
  }

  private writeEnabled(): void {
    try {
      fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true })
      fs.writeFileSync(this.settingsPath, `${JSON.stringify({ enabled: this.enabled }, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.warn('Failed to save the Discord presence setting:', error)
    }
  }

  private emitStatus(): void {
    this.onStatus(this.getStatus())
  }

  private async connect(): Promise<void> {
    if (this.socket || this.isConnecting || !this.enabled) return
    this.isConnecting = true
    let socket: net.Socket | null = null
    for (let index = 0; index < PIPE_COUNT && !socket; index++) {
      socket = await connectPipe(index)
    }
    this.isConnecting = false

    if (!socket || !this.enabled) {
      socket?.destroy()
      this.scheduleReconnect()
      return
    }

    this.socket = socket
    this.receiveBuffer = Buffer.alloc(0)
    socket.on('data', data => this.handleData(data))
    socket.on('error', error => console.warn('Discord IPC error:', error.message))
    socket.on('close', () => this.handleClose(socket))
    socket.write(encodeFrame(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID }))
  }

  private disconnect(): void {
    const socket = this.socket
    if (!socket) return
    this.socket = null
    socket.destroy()
    this.handleClose(socket)
  }

  private handleClose(socket: net.Socket): void {
    if (this.socket === socket) this.socket = null
    const wasReady = this.isReady
    this.isReady = false
    this.sentActivityKey = null
    if (wasReady) {
      console.log('Discord presence disconnected')
      this.emitStatus()
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (!this.enabled || this.reconnectTimer || this.socket) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, RECONNECT_INTERVAL_MS)
  }

  private handleData(data: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, data])
    while (this.receiveBuffer.length >= HEADER_SIZE) {
      const opcode = this.receiveBuffer.readInt32LE(0)
      const length = this.receiveBuffer.readInt32LE(4)
      if (this.receiveBuffer.length < HEADER_SIZE + length) return
      const body = this.receiveBuffer.subarray(HEADER_SIZE, HEADER_SIZE + length).toString('utf8')
      this.receiveBuffer = this.receiveBuffer.subarray(HEADER_SIZE + length)
      this.handleFrame(opcode, body)
    }
  }

  private handleFrame(opcode: number, body: string): void {
    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(body) as Record<string, unknown>
    } catch {
      // Keep the empty payload
    }

    switch (opcode) {
      case OP_FRAME:
        if (payload['evt'] === 'READY') {
          this.isReady = true
          console.log('Discord presence connected')
          this.emitStatus()
          this.scheduleUpdate()
        } else if (payload['evt'] === 'ERROR') {
          console.warn('Discord presence error:', payload['data'])
        }
        break
      case OP_PING:
        this.socket?.write(encodeFrame(OP_PONG, payload))
        break
      case OP_CLOSE:
        // Discord closes the pipe on handshake errors, e.g. an unknown client id
        console.warn('Discord closed the presence connection:', payload['message'] ?? payload)
        this.disconnect()
        break
    }
  }

  private scheduleUpdate(): void {
    if (!this.isReady || this.updateTimer) return
    const delay = Math.max(0, this.lastUpdateAt + MIN_UPDATE_INTERVAL_MS - Date.now())
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null
      this.sendActivity()
    }, delay)
  }

  private sendActivity(): void {
    if (!this.socket || !this.isReady) return
    const activity = this.presence ? toActivity(this.presence) : null
    const key = JSON.stringify(activity)
    if (key === this.sentActivityKey) return

    this.socket.write(encodeFrame(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: String(++this.nonce),
    }))
    this.sentActivityKey = key
    this.lastUpdateAt = Date.now()
  }
}
