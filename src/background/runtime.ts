import { Client } from 'archipelago.js'
import { platform as detectedPlatform, type Platform } from '../platform'
import { deliverClientMatchResult, evaluateLiveBoard } from './archipelago/checks'
import { broadcastState } from './broadcast'
import { ClientMatchTracker } from './client-match'
import { logGep } from './log'
import { TftLogTracker } from './tft-log-tracker'

function requirePlatform(): Platform {
  if (!detectedPlatform) throw new Error('Background controller requires the Overwolf or Electron runtime')
  return detectedPlatform
}

export const platform = requirePlatform()
export const client = new Client()

// Electron: match start, placement and final board from the Riot client's local API
export const clientMatchTracker = platform.kind === 'electron'
  ? new ClientMatchTracker({
    get: apiPath => platform.clientApiGet(apiPath),
    readFile: relativePath => platform.readDocumentsFile(relativePath),
    writeFile: (relativePath, content) => platform.writeDocumentsFile(relativePath, content),
    log: (message, data) => logGep(message, data),
    canDeliverResults: () => client.authenticated,
    deliverResult: (pending, result) => deliverClientMatchResult(pending, result),
    onStatusChanged: () => {
      broadcastState()
      // The board file can arrive before the Riot client reports the running game
      evaluateLiveBoard('Riot client status')
    },
  })
  : null

// Electron: current round from the TFT client log
export const tftLogTracker = new TftLogTracker()
