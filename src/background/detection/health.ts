// Electron: turns the vision window's raw facts into a detection status for the player. Pure, no state
// outside the tracker, so it can be tested without the rest of the background controller.
import type { DetectionHealth } from '../../types/state'
import type { VisionDetectionFacts } from '../../types/vision'

// The vision window reports every second; older facts mean it stopped (crash or reload)
export const DETECTION_FACTS_STALE_MS = 10_000
// Capture usually starts within a few seconds of the game window appearing
export const CAPTURE_GRACE_MS = 15_000
// Loading screen, carousel and augment screens hide the shop; give the HUD search this long at least
export const HUD_SEARCH_GRACE_MS = 30_000
// ...and until two rounds were played with the HUD on screen (TFT log round count)
export const HUD_SEARCH_GRACE_ROUND = 3
// Without a log round, or with one that does not advance, fall back to time alone
export const HUD_SEARCH_GRACE_NO_ROUND_MS = 120_000
// The gold number is on screen whenever the shop is
export const GOLD_UNREADABLE_MS = 20_000

export const DETECTION_REASONS = {
  startingCapture: 'Starting screen capture',
  notCapturing: 'The TFT window is not being captured. Shop purchases, XP buys and rerolls may not be counted.',
  locatingHud: 'Locating the TFT HUD',
  hudNotFound: 'The TFT HUD was not found. Shop purchases, XP buys and rerolls may not be counted.',
  hudNotConfirmed: 'The TFT HUD was not confirmed, but gold is read. Some shop purchases, XP buys or rerolls may not be counted.',
  goldUnreadable: 'Gold is not readable. XP buys and gold checks may be missed.',
} as const

export class DetectionHealthTracker {
  private notCapturingSince: number | null = null
  private unverifiedSince: number | null = null
  private goldMissingSince: number | null = null
  // Gold was read while the HUD is unconfirmed (e.g. buy_xp never matches, but the saved or fallback
  // alignment is right); cleared once gold stays unreadable with the shop open
  private isGoldReadUnconfirmed = false

  reset(): void {
    this.notCapturingSince = null
    this.unverifiedSince = null
    this.goldMissingSince = null
    this.isGoldReadUnconfirmed = false
  }

  // While the shop is hidden (carousel, augments) gold is not on screen either; the last verdict stands
  private trackGoldWhileUnconfirmed(facts: VisionDetectionFacts, now: number): void {
    if (facts.goldRead) {
      this.isGoldReadUnconfirmed = true
      this.goldMissingSince = null
    } else if (facts.shopVisible === true) {
      this.goldMissingSince ??= now
      if (now - this.goldMissingSince >= GOLD_UNREADABLE_MS) this.isGoldReadUnconfirmed = false
    } else {
      this.goldMissingSince = null
    }
  }

  evaluate(facts: VisionDetectionFacts | null, factsAt: number, now: number, liveRound: number | null): DetectionHealth {
    const isCapturing = facts !== null && facts.capturing && now - factsAt <= DETECTION_FACTS_STALE_MS
    if (!isCapturing) {
      this.unverifiedSince = null
      this.goldMissingSince = null
      this.isGoldReadUnconfirmed = false
      this.notCapturingSince ??= now
      return now - this.notCapturingSince >= CAPTURE_GRACE_MS
        ? { status: 'degraded', reason: DETECTION_REASONS.notCapturing }
        : { status: 'searching', reason: DETECTION_REASONS.startingCapture }
    }
    this.notCapturingSince = null

    if (!facts.hudVerified) {
      if (this.unverifiedSince === null) {
        this.unverifiedSince = now
        this.goldMissingSince = null
      }
      this.trackGoldWhileUnconfirmed(facts, now)
      const searchingFor = now - this.unverifiedSince
      // The time cap also applies with a log round: a round count stuck below 3 (round end not
      // detected in the log) must not keep the status on searching for the whole match
      const isGraceOver = searchingFor >= HUD_SEARCH_GRACE_NO_ROUND_MS
        || (searchingFor >= HUD_SEARCH_GRACE_MS && liveRound !== null && liveRound >= HUD_SEARCH_GRACE_ROUND)
      if (!isGraceOver) return { status: 'searching', reason: DETECTION_REASONS.locatingHud }
      return this.isGoldReadUnconfirmed
        ? { status: 'partial', reason: DETECTION_REASONS.hudNotConfirmed }
        : { status: 'degraded', reason: DETECTION_REASONS.hudNotFound }
    }
    if (this.unverifiedSince !== null) {
      // The gold timer from the unconfirmed spell does not carry over into the confirmed one
      this.unverifiedSince = null
      this.goldMissingSince = null
      this.isGoldReadUnconfirmed = false
    }

    if (facts.shopVisible === true && !facts.goldRead) {
      this.goldMissingSince ??= now
      if (now - this.goldMissingSince >= GOLD_UNREADABLE_MS) return { status: 'degraded', reason: DETECTION_REASONS.goldUnreadable }
    } else {
      this.goldMissingSince = null
    }
    return { status: 'ok', reason: null }
  }
}

export function isSameDetectionHealth(left: DetectionHealth | null, right: DetectionHealth | null): boolean {
  return left?.status === right?.status && left?.reason === right?.reason
}
