// Anchor search, per-resolution cache and blocker rects for the background
import defaultBlockerProfilesData from '../data/default-blocker-profiles.json'
import regionsData from '../data/vision-regions.json'
import { BACKGROUND_WINDOW_ID, type CaptureGeometry, type Platform } from '../platform'
import { VISION_REGION_NAMES, type VisionRect, type VisionRegionName, type VisionStatus } from '../types/vision'
import {
  ANCHOR_MIN_SCORE,
  ANCHORS,
  buildAlignment,
  findAnchor,
  mapRect,
  verifyAnchor,
  type AnchorMatch,
  type HudAlignment,
  type HudGroup,
} from './alignment'
import { toGray } from './analysis'
import { REFERENCE_PROFILE, type CalibrationStore } from './calibration'

// Optional client-area geometry for the test frame (simulates windowed mode offline)
const TEST_GEOMETRY_PATH = 'TFTArchipelago/vision-test-geometry.json'
// Anchor search is retried at this interval while a HUD group has no anchor-based transform
const ALIGNMENT_RETRY_MS = 3000

const REGION_GROUPS: Record<VisionRegionName, HudGroup> = {
  gold: 'bottom',
  level: 'bottom',
  xp: 'bottom',
  shop_reference: 'bottom',
  shop_slot_1: 'bottom',
  shop_slot_2: 'bottom',
  shop_slot_3: 'bottom',
  shop_slot_4: 'bottom',
  shop_slot_5: 'bottom',
  stage: 'top',
  augment_header: 'augment',
  augment_1: 'augment',
  augment_2: 'augment',
  augment_3: 'augment',
}

const BLOCKER_GROUPS: Record<string, HudGroup> = {
  shop_slot_4_blocker: 'bottom',
  shop_slot_5_blocker: 'bottom',
  reroll_button_blocker: 'bottom',
  xp_button_blocker: 'bottom',
  augment_slot_left_blocker: 'augment',
  augment_slot_right_blocker: 'augment',
  augment_reroll_1_blocker: 'augment',
  augment_reroll_2_blocker: 'augment',
  augment_reroll_3_blocker: 'augment',
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 0))
}

export class HudAligner {
  isAligning = false
  private current: HudAlignment | null = null
  // A cached alignment is re-checked once against live frames before it is trusted
  private isVerified = false
  private lastAttemptAt = 0
  private lastSentKey = ''
  private lastLoggedKey = ''
  private captureGeometry: CaptureGeometry | null = null

  constructor(
    private readonly platform: Platform,
    private readonly status: VisionStatus,
    private readonly calibration: CalibrationStore,
  ) {}

  // Game client area inside the captured frame; the whole frame in borderless/fullscreen
  private getClientRectInFrame(): VisionRect {
    const geometry = this.captureGeometry
    return geometry
      ? { x: geometry.offsetX, y: geometry.offsetY, w: geometry.clientWidth, h: geometry.clientHeight }
      : { x: 0, y: 0, w: this.status.frameWidth, h: this.status.frameHeight }
  }

  getAlignment(): HudAlignment {
    if (this.current?.profileKey === this.status.profileKey) return this.current
    // No anchors yet: identity on the reference profile, edge-pinned scaling elsewhere
    return buildAlignment(this.status.profileKey, this.getClientRectInFrame(), [])
  }

  getRegions(): Record<VisionRegionName, VisionRect> {
    const reference = (regionsData.profiles as Record<string, Record<VisionRegionName, VisionRect>>)[REFERENCE_PROFILE]
    const { groups } = this.getAlignment()
    return Object.fromEntries(
      VISION_REGION_NAMES.map(name => [name, mapRect(reference[name], groups[REGION_GROUPS[name]])]),
    ) as Record<VisionRegionName, VisionRect>
  }

  private getAlignedBlockerRects(): Record<string, VisionRect> {
    const reference = (defaultBlockerProfilesData.profiles as Record<string, Record<string, VisionRect>>)[REFERENCE_PROFILE] ?? {}
    const { groups } = this.getAlignment()
    return Object.fromEntries(
      Object.entries(reference)
        .filter(([name]) => BLOCKER_GROUPS[name])
        .map(([name, rect]) => [name, mapRect(rect, groups[BLOCKER_GROUPS[name]])]),
    )
  }

  handleProfileChanged(profileKey: string): void {
    this.current = this.calibration.getCachedAlignment(profileKey)
    this.isVerified = false
    // Frames right after a resolution change can still show the old layout; search a bit later
    this.lastAttemptAt = performance.now()
    this.lastSentKey = ''
    void this.refreshCaptureGeometry()
  }

  private async loadTestGeometry(): Promise<CaptureGeometry | null> {
    const content = await this.platform.readDocumentsFile(TEST_GEOMETRY_PATH)
    if (!content) return null
    try {
      return JSON.parse(content) as CaptureGeometry
    } catch {
      return null
    }
  }

  private async refreshCaptureGeometry(): Promise<void> {
    const { status } = this
    const geometry = status.source === 'window'
      ? await this.platform.getCaptureGeometry()
      : status.source === 'test-image' ? await this.loadTestGeometry() : null
    // Only trust offsets that fit the captured frame
    const fits = geometry !== null
      && geometry.offsetX >= 0 && geometry.offsetY >= 0
      && geometry.offsetX + geometry.clientWidth <= status.frameWidth + 1
      && geometry.offsetY + geometry.clientHeight <= status.frameHeight + 1
    this.captureGeometry = fits ? geometry : null
    this.lastSentKey = ''
    // Scale snapping and fallbacks depend on the client area; recompute from verified anchors
    this.isVerified = false
  }

  // Blockers live in game client coordinates, keyed by the client size the background uses
  sendToBackground(): void {
    const geometry = this.captureGeometry
    const offsetX = geometry?.offsetX ?? 0
    const offsetY = geometry?.offsetY ?? 0
    const profileKey = geometry ? `${geometry.clientWidth}x${geometry.clientHeight}` : this.status.profileKey
    const blockerRects = Object.fromEntries(
      Object.entries(this.getAlignedBlockerRects()).map(([name, rect]) => [name, { ...rect, x: rect.x - offsetX, y: rect.y - offsetY }]),
    )
    const { groups } = this.getAlignment()
    const anchoredBlockers = Object.keys(blockerRects).filter(name => groups[BLOCKER_GROUPS[name]]?.source === 'anchor')
    const key = JSON.stringify([profileKey, blockerRects, anchoredBlockers])
    if (key === this.lastSentKey) return
    this.lastSentKey = key
    this.platform.sendMessage(BACKGROUND_WINDOW_ID, 'VISION_HUD_ALIGNMENT', { profileKey, blockerRects, anchoredBlockers })
  }

  private needsAlignment(alignment: HudAlignment, shopVisible: boolean | null): boolean {
    const { bottom, top, augment } = alignment.groups
    // Once there's an augment reference the transform works. Retrying would run a full-frame search
    // right as the augment screen opens and stall the blockers for ~3 s.
    const hasAugmentReference = Boolean(this.calibration.getProfile(this.status.profileKey).augmentReferenceFingerprint)
    const needsAugmentAnchor = augment.source !== 'anchor' && !hasAugmentReference
    return bottom.source !== 'anchor' || top.source !== 'anchor' || (needsAugmentAnchor && shopVisible === false)
  }

  maybeRealign(frame: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, shopVisible: boolean | null, now: number): void {
    const needsWork = !this.isVerified || this.needsAlignment(this.getAlignment(), shopVisible)
    if (needsWork && now - this.lastAttemptAt >= ALIGNMENT_RETRY_MS) void this.run(frame, shopVisible)
  }

  // Forgets the cached alignment and searches all anchors again (only with an analyzed frame)
  async rerun(
    frame: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    shopVisible: boolean | null,
    hasAnalyzedFrame: boolean,
  ): Promise<boolean> {
    this.current = null
    delete this.calibration.getProfile(this.status.profileKey).alignment
    if (hasAnalyzedFrame) await this.run(frame, shopVisible, true)
    return this.current !== null
  }

  private async run(
    frame: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    shopVisible: boolean | null,
    force = false,
  ): Promise<void> {
    if (this.isAligning) return
    const previous = force ? null : (this.current?.profileKey === this.status.profileKey ? this.current : null)
    if (previous && this.isVerified && !this.needsAlignment(previous, shopVisible)) return

    this.isAligning = true
    this.lastAttemptAt = performance.now()
    try {
      const startedAt = performance.now()
      const { profileKey, frameWidth, frameHeight } = this.status
      const frameGray = toGray(frame.getImageData(0, 0, frameWidth, frameHeight))
      // Cached matches only count if the anchor is still at that spot in the current frame
      const matches: AnchorMatch[] = previous
        ? previous.matches.filter(match => match.score >= ANCHOR_MIN_SCORE && verifyAnchor(frameGray, match) >= ANCHOR_MIN_SCORE)
        : []
      const has = (name: string) => matches.some(match => match.name === name)
      const anchor = (name: string) => ANCHORS.find(candidate => candidate.name === name)!

      // Primary anchor over the full scale range; the others search around its scale
      if (!has('buy_xp')) matches.push(findAnchor(frameGray, anchor('buy_xp')))
      const primary = matches.find(match => match.name === 'buy_xp' && match.score >= ANCHOR_MIN_SCORE)
      const hint = primary?.scale ?? null
      for (const name of ['reroll_label', 'stage_icon', 'choose_one']) {
        if (has(name)) continue
        await yieldToEventLoop()
        if (this.status.profileKey !== profileKey) return
        matches.push(findAnchor(frameGray, anchor(name), hint))
      }

      const alignment = buildAlignment(profileKey, this.getClientRectInFrame(), matches, previous)
      this.current = alignment
      this.isVerified = true
      this.calibration.getProfile(profileKey).alignment = alignment
      void this.calibration.save()
      this.sendToBackground()
      const alignmentKey = JSON.stringify([profileKey, alignment.groups])
      if (alignmentKey === this.lastLoggedKey) return
      this.lastLoggedKey = alignmentKey
      console.log('HUD alignment', JSON.stringify({
        profileKey,
        durationMs: Math.round(performance.now() - startedAt),
        groups: alignment.groups,
        matches: matches.map(({ name, score, scale, x, y }) => ({ name, score: Math.round(score * 1000) / 1000, scale, x, y })),
      }))
    } finally {
      this.isAligning = false
    }
  }
}
