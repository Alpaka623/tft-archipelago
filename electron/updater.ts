import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateStatus } from '../src/platform/types'

// Auto-update from GitHub releases. Updates download in the background and
// install when the app quits, or earlier through installUpdate() while TFT is closed,
// so a running match is never interrupted.

const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
// Replaces the GitHub feed for testing a packaged build against a local folder server
const FEED_URL_OVERRIDE = process.env['TFT_ARCHIPELAGO_UPDATE_URL'] ?? ''

export interface UpdaterOptions {
  onStatus: (status: AppUpdateStatus) => void
  isGameRunning: () => boolean
}

export class AppUpdater {
  private status: AppUpdateStatus = { state: 'idle', version: null, percent: null, error: null }

  constructor(private readonly options: UpdaterOptions) {}

  start(): void {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = console
    if (FEED_URL_OVERRIDE) autoUpdater.setFeedURL({ provider: 'generic', url: FEED_URL_OVERRIDE })

    autoUpdater.on('checking-for-update', () => {
      // A finished download stays ready; later checks only find the same version
      if (this.status.state !== 'ready') this.setStatus({ state: 'checking', version: null, percent: null, error: null })
    })
    autoUpdater.on('update-not-available', () => {
      if (this.status.state !== 'ready') this.setStatus({ state: 'idle', version: null, percent: null, error: null })
    })
    autoUpdater.on('update-available', (info) => {
      this.setStatus({ state: 'downloading', version: info.version, percent: 0, error: null })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.setStatus({ ...this.status, state: 'downloading', percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.setStatus({ state: 'ready', version: info.version, percent: 100, error: null })
    })
    autoUpdater.on('error', (error) => {
      console.warn('Auto-update failed:', error)
      if (this.status.state !== 'ready') {
        this.setStatus({ state: 'error', version: this.status.version, percent: null, error: error.message })
      }
    })

    setTimeout(() => this.check(), FIRST_CHECK_DELAY_MS)
    setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  getStatus(): AppUpdateStatus {
    return { ...this.status }
  }

  install(): boolean {
    if (this.status.state !== 'ready' || this.options.isGameRunning()) return false
    console.log(`Installing update ${this.status.version} (current ${app.getVersion()})`)
    // Silent install, then start the new version
    autoUpdater.quitAndInstall(true, true)
    return true
  }

  private check(): void {
    if (this.status.state === 'ready' || this.status.state === 'downloading') return
    autoUpdater.checkForUpdates().catch(() => {
      // Reported through the 'error' event
    })
  }

  private setStatus(status: AppUpdateStatus): void {
    this.status = status
    this.options.onStatus(this.getStatus())
  }
}
