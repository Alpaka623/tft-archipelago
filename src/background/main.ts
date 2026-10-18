// Background controller: the hidden window that owns the Archipelago connection, reads the game
// and runs the rule engine. Every other window only displays the state it broadcasts.
import { registerArchipelagoListeners } from './archipelago/connection'
import { listenForWindowMessages } from './messages'
import { pruneViolationEvidence } from './rules/violations'
import { clientMatchTracker, platform } from './runtime'
import { trackTftSession } from './session'
import { startGepSource } from './sources/gep'
import { prewarmBlockerWindows } from './windows/blockers'
import { openDesktopWindow } from './windows/overlay'

console.log('background: module loaded')

registerArchipelagoListeners()
openDesktopWindow('background startup')
pruneViolationEvidence('background startup')
prewarmBlockerWindows('background startup')
clientMatchTracker?.start()
trackTftSession()
if (platform.kind === 'overwolf') startGepSource()
listenForWindowMessages()
