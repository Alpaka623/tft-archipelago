import { describe, expect, it } from 'vitest'
import type { VisionDetectionFacts } from '../../types/vision'
import {
  CAPTURE_GRACE_MS,
  DETECTION_FACTS_STALE_MS,
  DETECTION_REASONS,
  DetectionHealthTracker,
  GOLD_UNREADABLE_MS,
  HUD_SEARCH_GRACE_MS,
  HUD_SEARCH_GRACE_NO_ROUND_MS,
  isSameDetectionHealth,
} from './health'

const WORKING: VisionDetectionFacts = { capturing: true, hudVerified: true, shopVisible: true, goldRead: true }
const HUD_MISSING: VisionDetectionFacts = { capturing: true, hudVerified: false, shopVisible: false, goldRead: false }

describe('DetectionHealthTracker', () => {
  it('reports ok while the HUD is confirmed and gold is read', () => {
    const tracker = new DetectionHealthTracker()

    expect(tracker.evaluate(WORKING, 0, 0, 2)).toEqual({ status: 'ok', reason: null })
  })

  it('searches for the HUD first and only reports limited after the grace time and two rounds', () => {
    const tracker = new DetectionHealthTracker()

    expect(tracker.evaluate(HUD_MISSING, 0, 0, 1).status).toBe('searching')
    expect(tracker.evaluate(HUD_MISSING, HUD_SEARCH_GRACE_MS, HUD_SEARCH_GRACE_MS, 2).status).toBe('searching')
    expect(tracker.evaluate(HUD_MISSING, HUD_SEARCH_GRACE_MS, HUD_SEARCH_GRACE_MS, 3))
      .toEqual({ status: 'degraded', reason: DETECTION_REASONS.hudNotFound })
  })

  it('does not report limited early in a long loading screen', () => {
    const tracker = new DetectionHealthTracker()
    tracker.evaluate(HUD_MISSING, 0, 0, 1)

    expect(tracker.evaluate(HUD_MISSING, 90_000, 90_000, 1).status).toBe('searching')
  })

  it('reports limited after the time cap even when the log round stays below the grace round', () => {
    const tracker = new DetectionHealthTracker()
    tracker.evaluate(HUD_MISSING, 0, 0, 1)

    expect(tracker.evaluate(HUD_MISSING, HUD_SEARCH_GRACE_NO_ROUND_MS, HUD_SEARCH_GRACE_NO_ROUND_MS, 1))
      .toEqual({ status: 'degraded', reason: DETECTION_REASONS.hudNotFound })
  })

  it('reports partial instead of limited when the HUD is unconfirmed but gold is read', () => {
    const tracker = new DetectionHealthTracker()
    const goldOnly = { ...HUD_MISSING, shopVisible: true, goldRead: true }
    tracker.evaluate(goldOnly, 0, 0, 1)

    expect(tracker.evaluate(goldOnly, HUD_SEARCH_GRACE_MS, HUD_SEARCH_GRACE_MS, 3))
      .toEqual({ status: 'partial', reason: DETECTION_REASONS.hudNotConfirmed })
    // Carousel or augment screen: no gold on screen, the verdict stands
    const shopHidden = { ...HUD_MISSING, shopVisible: false, goldRead: false }
    expect(tracker.evaluate(shopHidden, 90_000, 90_000, 4).status).toBe('partial')
  })

  it('turns partial into limited once gold stays unreadable with the shop open', () => {
    const tracker = new DetectionHealthTracker()
    const goldOnly = { ...HUD_MISSING, shopVisible: true, goldRead: true }
    const noGold = { ...HUD_MISSING, shopVisible: true, goldRead: false }
    tracker.evaluate(goldOnly, 0, 0, 3)
    expect(tracker.evaluate(noGold, 40_000, 40_000, 3).status).toBe('partial')

    expect(tracker.evaluate(noGold, 40_000 + GOLD_UNREADABLE_MS, 40_000 + GOLD_UNREADABLE_MS, 3))
      .toEqual({ status: 'degraded', reason: DETECTION_REASONS.hudNotFound })
  })

  it('does not carry the unconfirmed gold verdict into the next unconfirmed spell', () => {
    const tracker = new DetectionHealthTracker()
    tracker.evaluate({ ...HUD_MISSING, shopVisible: true, goldRead: true }, 0, 0, 3)
    tracker.evaluate(WORKING, 1000, 1000, 3)

    tracker.evaluate(HUD_MISSING, 2000, 2000, 3)
    expect(tracker.evaluate(HUD_MISSING, 2000 + HUD_SEARCH_GRACE_MS, 2000 + HUD_SEARCH_GRACE_MS, 3).status).toBe('degraded')
  })

  it('falls back to time alone without a log round', () => {
    const tracker = new DetectionHealthTracker()
    tracker.evaluate(HUD_MISSING, 0, 0, null)

    expect(tracker.evaluate(HUD_MISSING, HUD_SEARCH_GRACE_MS, HUD_SEARCH_GRACE_MS, null).status).toBe('searching')
    expect(tracker.evaluate(HUD_MISSING, HUD_SEARCH_GRACE_NO_ROUND_MS, HUD_SEARCH_GRACE_NO_ROUND_MS, null).status).toBe('degraded')
  })

  it('recovers to ok as soon as the HUD is found, and restarts the grace time on the next loss', () => {
    const tracker = new DetectionHealthTracker()
    tracker.evaluate(HUD_MISSING, 0, 0, 5)
    expect(tracker.evaluate(HUD_MISSING, HUD_SEARCH_GRACE_MS, HUD_SEARCH_GRACE_MS, 5).status).toBe('degraded')

    expect(tracker.evaluate(WORKING, 40_000, 40_000, 5).status).toBe('ok')
    // e.g. a resolution change mid-match: searching again, not limited right away
    expect(tracker.evaluate(HUD_MISSING, 41_000, 41_000, 5).status).toBe('searching')
  })

  it('reports limited when the capture does not start', () => {
    const tracker = new DetectionHealthTracker()
    const notCapturing = { ...WORKING, capturing: false }

    expect(tracker.evaluate(notCapturing, 0, 0, 1))
      .toEqual({ status: 'searching', reason: DETECTION_REASONS.startingCapture })
    expect(tracker.evaluate(notCapturing, CAPTURE_GRACE_MS, CAPTURE_GRACE_MS, 1))
      .toEqual({ status: 'degraded', reason: DETECTION_REASONS.notCapturing })
  })

  it('treats facts from a vision window that stopped reporting as not capturing', () => {
    const tracker = new DetectionHealthTracker()
    tracker.evaluate(WORKING, 0, 0, 2)

    const later = DETECTION_FACTS_STALE_MS + 1
    expect(tracker.evaluate(WORKING, 0, later, 2).status).toBe('searching')
    expect(tracker.evaluate(WORKING, 0, later + CAPTURE_GRACE_MS, 2).status).toBe('degraded')
  })

  it('reports limited when gold stays unreadable while the shop is open', () => {
    const tracker = new DetectionHealthTracker()
    const noGold = { ...WORKING, goldRead: false }

    expect(tracker.evaluate(noGold, 0, 0, 3).status).toBe('ok')
    expect(tracker.evaluate(noGold, GOLD_UNREADABLE_MS, GOLD_UNREADABLE_MS, 3))
      .toEqual({ status: 'degraded', reason: DETECTION_REASONS.goldUnreadable })
  })

  it('ignores missing gold while the shop is hidden', () => {
    const tracker = new DetectionHealthTracker()
    const shopHidden = { ...WORKING, shopVisible: false, goldRead: false }

    tracker.evaluate(shopHidden, 0, 0, 3)
    expect(tracker.evaluate(shopHidden, 60_000, 60_000, 3).status).toBe('ok')
  })

  it('starts from scratch after a reset', () => {
    const tracker = new DetectionHealthTracker()
    tracker.evaluate(HUD_MISSING, 0, 0, 5)
    tracker.reset()

    expect(tracker.evaluate(HUD_MISSING, HUD_SEARCH_GRACE_MS, HUD_SEARCH_GRACE_MS, 5).status).toBe('searching')
  })
})

describe('isSameDetectionHealth', () => {
  it('compares status and reason, including null', () => {
    expect(isSameDetectionHealth(null, null)).toBe(true)
    expect(isSameDetectionHealth({ status: 'ok', reason: null }, null)).toBe(false)
    expect(isSameDetectionHealth({ status: 'ok', reason: null }, { status: 'ok', reason: null })).toBe(true)
  })
})
