import fs from 'node:fs/promises'
import path from 'node:path'
import { parseTftLogLine, type TftEndOfGameFile, type TftLogBatch, type TftLogEvent } from '../src/platform/tft-log'

const LOG_FILE_NAME = 'TFT.log'
const END_OF_GAME_FILE_NAME = 'TFTEoGStats.json'
const POLL_INTERVAL_MS = 1000
// Reading a multi-megabyte log at once is fine, but cap a single read to stay responsive
const MAX_READ_BYTES = 8 * 1024 * 1024

interface WatcherCallbacks {
  onLogEvents(batch: TftLogBatch): void
  onEndOfGame(file: TftEndOfGameFile): void
}

// Tails the TFT client's own log and end-of-game file. Read-only; the client creates a new
// TFT.log for every game process and renames the previous one to TFT-backup-<date>.log.
export class TftLogWatcher {
  private timer: NodeJS.Timeout | null = null
  private offset = 0
  private fileIdentity = ''
  private partialLine = ''
  private hasReadInitialLog = false
  private endOfGameModifiedAt = 0
  private isPolling = false

  constructor(private readonly logDir: string, private readonly callbacks: WatcherCallbacks) {}

  start(): void {
    if (this.timer) return
    console.log('TFT log watcher started:', this.logDir)
    void this.poll()
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async poll(): Promise<void> {
    if (this.isPolling) return
    this.isPolling = true
    try {
      await this.readLog()
      await this.readEndOfGame()
    } catch (error) {
      console.warn('TFT log watcher poll failed:', error)
    } finally {
      this.isPolling = false
    }
  }

  private async readLog(): Promise<void> {
    const logPath = path.join(this.logDir, LOG_FILE_NAME)
    let stat
    try {
      stat = await fs.stat(logPath)
    } catch {
      this.hasReadInitialLog = true
      return
    }

    // A new game process starts a new file; the size check also catches a rewrite in place
    const identity = `${stat.ino}:${stat.birthtimeMs}`
    if (identity !== this.fileIdentity || stat.size < this.offset) {
      this.fileIdentity = identity
      this.offset = 0
      this.partialLine = ''
    }
    if (stat.size === this.offset) {
      this.hasReadInitialLog = true
      return
    }

    const length = Math.min(stat.size - this.offset, MAX_READ_BYTES)
    const handle = await fs.open(logPath, 'r')
    let text: string
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset)
      this.offset += bytesRead
      text = buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }

    const lines = (this.partialLine + text).split(/\r?\n/)
    this.partialLine = lines.pop() ?? ''
    const events = lines
      .map(parseTftLogLine)
      .filter((event): event is TftLogEvent => event !== null)

    const isReplay = !this.hasReadInitialLog
    this.hasReadInitialLog = true
    if (events.length > 0) this.callbacks.onLogEvents({ events, isReplay })
  }

  private async readEndOfGame(): Promise<void> {
    const filePath = path.join(this.logDir, END_OF_GAME_FILE_NAME)
    let stat
    try {
      stat = await fs.stat(filePath)
    } catch {
      return
    }
    if (stat.mtimeMs === this.endOfGameModifiedAt) return

    try {
      const stats: unknown = JSON.parse((await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''))
      this.endOfGameModifiedAt = stat.mtimeMs
      this.callbacks.onEndOfGame({ stats, modifiedAt: stat.mtimeMs })
    } catch {
      // The client may still be writing the file; the next poll tries again
    }
  }
}
