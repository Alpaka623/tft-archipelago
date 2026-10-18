// Captures the TFT window as a stream of frames while the game runs, retrying until it succeeds
import type { Platform } from '../platform'
import type { VisionStatus } from '../types/vision'

// Minimal typings for the Insertable Streams API (Chromium), not in TS 5.6 lib.dom
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack })
  readable: ReadableStream<VideoFrame>
}

export type FrameSource = VideoFrame | ImageBitmap

const TEST_FRAME_PATH = 'TFTArchipelago/vision-test-frame.png'
const CAPTURE_RETRY_MS = 3000
const MAX_CAPTURE_FPS = 10

export interface FrameCaptureCallbacks {
  onStarted(): void
  onStopped(reason: string): void
}

export function getFrameSize(frame: FrameSource): { width: number; height: number } {
  return 'displayWidth' in frame
    ? { width: frame.displayWidth, height: frame.displayHeight }
    : { width: frame.width, height: frame.height }
}

export class FrameCapture {
  latestFrame: FrameSource | null = null
  private isGameRunning = false
  private isStarting = false
  private stream: MediaStream | null = null
  private testFrame: ImageBitmap | null = null
  private retryTimer: number | null = null

  constructor(
    private readonly platform: Platform,
    // Shared with the debug output; capture owns capturing, source, sourceId and error
    private readonly status: VisionStatus,
    private readonly callbacks: FrameCaptureCallbacks,
  ) {}

  setGameRunning(isRunning: boolean): void {
    this.isGameRunning = isRunning
    if (isRunning) {
      void this.start()
    } else if (this.status.capturing) {
      this.stop('game not running')
    }
  }

  private setLatestFrame(frame: FrameSource): void {
    this.closeLatestFrame()
    this.latestFrame = frame
  }

  private closeLatestFrame(): void {
    if (this.latestFrame && this.latestFrame !== this.testFrame && 'close' in this.latestFrame) this.latestFrame.close()
  }

  private async loadTestFrame(): Promise<ImageBitmap | null> {
    const base64 = await this.platform.readDocumentsFile(TEST_FRAME_PATH, 'base64')
    if (!base64) return null
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
    return createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  }

  private async readFrames(track: MediaStreamTrack): Promise<void> {
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done || !value) break
        this.setLatestFrame(value)
      }
    } catch (error) {
      console.warn('Vision frame reader stopped:', error)
    }
    if (this.stream) this.stop('capture track ended')
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || !this.isGameRunning) return
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      void this.start()
    }, CAPTURE_RETRY_MS)
  }

  private async start(): Promise<void> {
    if (this.status.capturing || this.isStarting || !this.isGameRunning) return
    this.isStarting = true

    try {
      const sourceId = await this.platform.getCaptureSourceId()
      if (!sourceId) throw new Error('TFT capture source not found')

      this.status.sourceId = sourceId
      // Fake-game mode captures the screen; a saved test frame replaces it for offline testing
      this.testFrame = sourceId.startsWith('screen:') ? await this.loadTestFrame() : null
      if (this.testFrame) {
        this.status.source = 'test-image'
        this.setLatestFrame(this.testFrame)
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxFrameRate: MAX_CAPTURE_FPS,
            },
          },
        } as unknown as MediaStreamConstraints)
        this.status.source = sourceId.startsWith('screen:') ? 'screen' : 'window'
        void this.readFrames(this.stream.getVideoTracks()[0])
      }

      this.status.capturing = true
      this.status.error = null
      this.callbacks.onStarted()
      console.log('Vision capture started', { sourceId, source: this.status.source })
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error)
      console.warn('Vision capture failed:', this.status.error)
      this.scheduleRetry()
    } finally {
      this.isStarting = false
    }
  }

  private stop(reason: string): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    this.closeLatestFrame()
    this.latestFrame = null
    this.testFrame = null
    this.status.capturing = false
    this.status.source = null
    this.status.sourceId = null
    this.callbacks.onStopped(reason)
    console.log('Vision capture stopped', { reason })
    this.scheduleRetry()
  }
}
