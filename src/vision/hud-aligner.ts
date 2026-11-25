// Anchor search, per-resolution cache and blocker rects for the background
import defaultBlockerProfilesData from '../data/default-blocker-profiles.json'
import regionsData from '../data/vision-regions.json'
import { BACKGROUND_WINDOW_ID, type CaptureGeometry, type Platform } from '../platform'
import { VISION_REGION_NAMES, type VisionRect, type VisionRegionName, type VisionStatus } from '../types/vision'
import {
  ANCHOR_MIN_SCORE,
  ANCHORS,
  HUD_GROUPS,
  buildAlignment,
  findAnchor,
  mapRect,
  markAlignmentCached,
  promoteTrustedGroups,
  verifyAnchor,
  type AnchorMatch,
  type HudAlignment,
  type HudGroup,
} from './alignment'
import { toGray } from './analysis'
import { REFERENCE_PROFILE, type CalibrationStore } from './calibration'

// Optional client-area geometry for the test frame (simulates windowed mode offline)
const TEST_GEOMETRY_PATH = 'TFTArchipelago/vision-test-geometry.json'
// Anchor search is retried at this interval while a HUD group is not confirmed in this match
const ALIGNMENT_RETRY_MS = 3000
// Retries search the primary anchor around the expected scale; every Nth one covers the full range
const FULL_SCALE_SEARCH_EVERY = 4

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

// Scores are left out: they only describe how well an anchor matched, not where the HUD is
function haveSameTransforms(left: HudAlignment, right: HudAlignment): boolean {
  return left.profileKey === right.profileKey && HUD_GROUPS.every((group) => {
    const a = left.groups[group]
    const b = right.groups[group]
    return a.scale === b.scale && a.offsetX === b.offsetX && a.offsetY === b.offsetY && a.source === b.source
  })
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 0))
}

export class HudAligner {
  isAligning = false
  private current: HudAlignment | null = null
  // Groups confirmed by an anchor since the last match start, resolution or geometry change. A saved
  // alignment is only a starting point: the HUD can sit elsewhere in another game mode or window state.
  private readonly trustedGroups = new Set<HudGroup>()
  private bottomSearchAttempts = 0
  // Bumped on every trust reset; a search that started before one discards its result
  private trustGeneration = 0
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

  // The bottom group (shop, gold, XP, level) was located by an anchor in this match
  isHudVerified(): boolean {
    return this.trustedGroups.has('bottom') && this.current?.profileKey === this.status.profileKey
  }

  private resetTrust(): void {
    this.trustedGroups.clear()
    this.bottomSearchAttempts = 0
    this.trustGeneration++
    if (this.current) this.current = markAlignmentCached(this.current)
  }

  handleProfileChanged(profileKey: string): void {
    this.current = this.calibration.getCachedAlignment(profileKey)
    this.resetTrust()
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
    this.resetTrust()
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
    // Measured blockers override the player's calibration, so only groups confirmed in this match count: an
    // anchor match before the bottom group is confirmed can come from a transitional frame
    const anchoredBlockers = Object.keys(blockerRects).filter((name) => {
      const group = BLOCKER_GROUPS[name]
      return groups[group]?.source === 'anchor' && this.trustedGroups.has(group)
    })
    const key = JSON.stringify([profileKey, blockerRects, anchoredBlockers])
    if (key === this.lastSentKey) return
    this.lastSentKey = key
    this.platform.sendMessage(BACKGROUND_WINDOW_ID, 'VISION_HUD_ALIGNMENT', { profileKey, blockerRects, anchoredBlockers })
  }

  private needsAlignment(shopVisible: boolean | null): boolean {
    // Once there's an augment reference the transform works. Retrying would run a full-frame search
    // right as the augment screen opens and stall the blockers for ~3 s.
    const hasAugmentReference = Boolean(this.calibration.getProfile(this.status.profileKey).augmentReferenceFingerprint)
    const needsAugmentAnchor = !this.trustedGroups.has('augment') && !hasAugmentReference
    return !this.trustedGroups.has('bottom') || !this.trustedGroups.has('top') || (needsAugmentAnchor && shopVisible === false)
  }

  // Confirm the alignment again on the next live match frames (e.g. after leaving the client menu)
  markUnverified(): void {
    this.resetTrust()
    this.lastAttemptAt = 0
    this.lastSentKey = ''
  }

  maybeRealign(frame: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, shopVisible: boolean | null, now: number): void {
    if (this.needsAlignment(shopVisible) && now - this.lastAttemptAt >= ALIGNMENT_RETRY_MS) void this.run(frame, shopVisible)
  }

  // Forgets the cached alignment and searches all anchors again (only with an analyzed frame)
  async rerun(
    frame: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    shopVisible: boolean | null,
    hasAnalyzedFrame: boolean,
  ): Promise<boolean> {
    this.current = null
    this.resetTrust()
    delete this.calibration.getProfile(this.status.profileKey).alignment
    if (hasAnalyzedFrame) await this.run(frame, shopVisible, true)
    return this.current !== null
  }

  // Retries continue while the top group is unconfirmed; without this check every one of them rewrote
  // vision-calibration.json (every 3 s, and the write is not atomic)
  private saveIfChanged(profileKey: string, alignment: HudAlignment): void {
    const profile = this.calibration.getProfile(profileKey)
    if (profile.alignment && haveSameTransforms(profile.alignment, alignment)) return
    profile.alignment = alignment
    void this.calibration.save()
  }

  private async run(
    frame: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    shopVisible: boolean | null,
    force = false,
  ): Promise<void> {
    if (this.isAligning) return
    const previous = force ? null : (this.current?.profileKey === this.status.profileKey ? this.current : null)
    if (!force && !this.needsAlignment(shopVisible)) return

    this.isAligning = true
    this.lastAttemptAt = performance.now()
    try {
      const startedAt = performance.now()
      const { profileKey, frameWidth, frameHeight } = this.status
      const generation = this.trustGeneration
      const frameGray = toGray(frame.getImageData(0, 0, frameWidth, frameHeight))
      // Cached matches only count if the anchor is still at that spot in the current frame
      const matches: AnchorMatch[] = previous
        ? previous.matches.filter(match => match.score >= ANCHOR_MIN_SCORE && verifyAnchor(frameGray, match) >= ANCHOR_MIN_SCORE)
        : []
      const has = (name: string) => matches.some(match => match.name === name)
      const anchor = (name: string) => ANCHORS.find(candidate => candidate.name === name)!

      // Primary anchor: retries search around the expected scale (cheap), every Nth one the full range
      // (skipped once the bottom group is confirmed in this match, e.g. while the augment screen hides the shop)
      const expectedScale = previous?.groups.bottom.scale ?? null
      const isBottomTrusted = this.trustedGroups.has('bottom')
      const isFullSearch = !isBottomTrusted && (expectedScale === null || this.bottomSearchAttempts % FULL_SCALE_SEARCH_EVERY === 0)
      if (!has('buy_xp') && !isBottomTrusted) {
        this.bottomSearchAttempts++
        matches.push(findAnchor(frameGray, anchor('buy_xp'), isFullSearch ? null : expectedScale))
      }
      const primary = matches.find(match => match.name === 'buy_xp' && match.score >= ANCHOR_MIN_SCORE)
      // The other anchors follow the same rule: full range only on full-search attempts. A full-range search
      // stalls frame reading for seconds, and without a bottom anchor they would otherwise run every retry.
      const hint = primary?.scale ?? (isFullSearch ? null : expectedScale)
      for (const name of ['reroll_label', 'stage_icon', 'choose_one']) {
        if (has(name)) continue
        // The reroll label only refines the scale of a fresh buy_xp match
        if (name === 'reroll_label' && !primary) continue
        // The augment header is only on screen while the shop is hidden, and it is the most expensive search
        // (~0.8 s even around a scale hint); retries for the bottom or top group would otherwise pay for it
        if (name === 'choose_one' && !force && (this.trustedGroups.has('augment') || shopVisible === true)) continue
        await yieldToEventLoop()
        if (this.status.profileKey !== profileKey || this.trustGeneration !== generation) return
        matches.push(findAnchor(frameGray, anchor(name), hint))
      }
      // The trust this run started from was reset while it waited (match start, capture stop, geometry
      // change): a match from the old frame must not confirm anything for what comes next
      if (this.trustGeneration !== generation) return

      const alignment = promoteTrustedGroups(
        buildAlignment(profileKey, this.getClientRectInFrame(), matches, previous, this.trustedGroups),
        this.trustedGroups,
      )
      const isConfirmed = this.trustedGroups.has('bottom')
      this.current = alignment
      // Only an alignment whose bottom group is confirmed in this match is worth keeping; a run where just
      // the stage icon matched used to save a stale bottom group and stop all further searches
      if (isConfirmed && matches.some(match => match.score >= ANCHOR_MIN_SCORE)) this.saveIfChanged(profileKey, alignment)
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
