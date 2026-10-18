// Evidence for rule violations and the override for false positives
import type { ViolationOverride } from '../../types/state'
import { VISION_WINDOW_ID } from '../../types/vision'
import { deriveState, getErrorMessage } from '../app-state'
import { broadcastState, sendToConnectedWindows } from '../broadcast'
import { logGep } from '../log'
import { client, platform } from '../runtime'
import { getLatestVisionGameState } from '../sources/vision'
import { augments, economy, round, run, session, shop } from '../state'

const VIOLATIONS_DIR = 'TFTArchipelago/violations'

let isOverridingViolation = false

function buildViolationRecord(override: ViolationOverride | null): Record<string, unknown> {
  const state = deriveState()
  return {
    reason: run.violationReason,
    stage: run.violationStage,
    platform: platform.kind,
    gameResolution: `${session.gameWidth}x${session.gameHeight}`,
    limits: {
      shopRerolls: state.allowedRerolls,
      augmentRerolls: state.allowedAugmentRerolls,
      xpBuysPerRound: state.allowedXpBuysPerRound,
      lockedShopSlots: state.lockedShopSlots,
      leftAugmentUnlocked: state.leftAugmentUnlocked,
      rightAugmentUnlocked: state.rightAugmentUnlocked,
    },
    counters: {
      shopRerolls: shop.rerollsUsed,
      augmentRerolls: augments.rerollsUsed,
      xpBuysThisRound: economy.xpBuysThisRound,
    },
    gold: economy.gold,
    xp: economy.xp,
    isInPlanningPhase: round.isInPlanningPhase,
    isShopVisible: shop.isVisible,
    isAugmentPhaseActive: augments.isPhaseActive,
    shopBaseline: shop.baseline,
    latestShopSnapshot: shop.latest,
    augmentBaseline: augments.baseline,
    latestAugmentSnapshot: augments.latest,
    latestVisionGameState: getLatestVisionGameState(),
    override,
  }
}

function writeViolationRecord(override: ViolationOverride | null): Promise<void> {
  if (!run.evidenceFolder) return Promise.resolve()
  const folder = run.evidenceFolder
  return platform.writeDocumentsFile(`${folder}/violation.json`, `${JSON.stringify(buildViolationRecord(override), null, 2)}\n`)
    .then(success => logGep('Violation record written', { folder, success, overridden: override !== null }))
}

// Keeps only the newest evidence folders; the new folder is always the newest
export function pruneViolationEvidence(reason: string): void {
  void platform.pruneViolationEvidence().then((result) => {
    if (result && result.deletedFolders > 0) {
      logGep('Violation evidence pruned', { reason, ...result, freedMb: Math.round(result.freedBytes / 1e5) / 10 })
    }
  }).catch(error => console.warn('Failed to prune violation evidence:', error))
}

// Every violation keeps its state and, on Electron, the current frame; an override marks it as a false positive
export function saveViolationEvidence(): void {
  run.evidenceFolder = `${VIOLATIONS_DIR}/${new Date().toISOString().replace(/[:.]/g, '-')}`
  void writeViolationRecord(null).then(() => pruneViolationEvidence('new violation'))
  if (platform.kind === 'electron') {
    platform.sendMessage(VISION_WINDOW_ID, 'VISION_SAVE_EVIDENCE', { folder: run.evidenceFolder })
  }
}

function sendOverrideResult(success: boolean, message: string): void {
  sendToConnectedWindows({ id: 'VIOLATION_OVERRIDE_RESULT', content: { success, message } })
}

// Restores the run after a false positive. Only while connected: the override is announced in the
// multiworld chat first, so other players always see it.
export async function overrideViolation(): Promise<void> {
  if (run.isValid || !run.violationReason) {
    sendOverrideResult(false, 'There is no rule violation to override.')
    return
  }
  if (!client.authenticated) {
    sendOverrideResult(false, 'Connect to Archipelago first. Overrides are announced to the multiworld.')
    return
  }
  if (isOverridingViolation) return

  isOverridingViolation = true
  const reason = run.violationReason
  const stage = run.violationStage
  const announcement = `[TFT] Overrode a rule violation as a false positive: ${reason}${stage ? ` (stage ${stage})` : ''}`
  try {
    await client.messages.say(announcement)
  } catch (error) {
    console.error('Violation override announcement failed:', error)
    sendOverrideResult(false, `Could not post to the multiworld chat: ${getErrorMessage(error)}`)
    return
  } finally {
    isOverridingViolation = false
  }

  // The match may have ended or a new violation replaced this one while the message was sent
  if (run.isValid || run.violationReason !== reason) {
    sendOverrideResult(false, 'The violation changed while the override was sent. Try again.')
    return
  }

  const override: ViolationOverride = { reason, stage, overriddenAt: Date.now() }
  run.overrides = [...run.overrides, override]
  void writeViolationRecord(override)

  // Discount the falsely counted actions so the same counters do not invalidate the run again
  const state = deriveState()
  shop.rerollsUsed = Math.min(shop.rerollsUsed, state.allowedRerolls)
  augments.rerollsUsed = Math.min(augments.rerollsUsed, state.allowedAugmentRerolls)
  economy.xpBuysThisRound = Math.min(economy.xpBuysThisRound, state.allowedXpBuysPerRound)

  run.isValid = true
  run.violationReason = null
  run.violationStage = null
  run.evidenceFolder = null
  logGep('Rule violation overridden', override)
  sendOverrideResult(true, 'Override posted to the multiworld chat. The run is valid again.')
  broadcastState()
}
