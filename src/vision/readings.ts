// Region pixels -> HUD values, debounced over frames. Pure, no capture loop in here.
import type { VisionGameState, VisionRect, VisionRegionName, VisionTextRegion, VisionXp } from '../types/vision'
import {
  extractGlyphs,
  extractGlyphWords,
  hammingDistance,
  recognizeText,
  toWhiteness,
  type DigitTemplates,
  type GlyphGrid,
  type GrayImage,
} from './analysis'

// Fingerprints within this Hamming distance count as the same image
const SAME_IMAGE_MAX_DISTANCE = 10
// A new fingerprint must persist this many analyzed frames before it becomes stable
const STABLE_FRAME_COUNT = 2
// Empty (sold) shop slots measure luminance ~9 / contrast ~6; a dimmed dark card measured 39 / 23
// and read as sold during an XP buy, so the thresholds stay well below that
const EMPTY_SLOT_MAX_LUMINANCE = 25
const EMPTY_SLOT_MAX_CONTRAST = 15
// dHash of empty shop slots (measured, Set 18 at 2560x1440). Empty slots briefly glow while the
// shop refills, which defeats the luminance check but keeps this fingerprint
const EMPTY_SLOT_FINGERPRINTS = ['1f5b4f4f17174f0f', '175b4f4f17174f0f', '171b4f0f07170f0f']
const EMPTY_SLOT_MAX_DISTANCE = 12
const MAX_LEVEL = 10
// HUD text is cream white; the coin icon next to the gold is saturated gold (see toWhiteness)
const TEXT_MIN_WHITENESS = 150

export const TEXT_PATTERNS: Record<VisionTextRegion, RegExp> = {
  gold: /^\d+$/,
  xp: /^\d+\/\d+$/,
}

export interface RegionAnalysis {
  name: VisionRegionName
  rect: VisionRect
  pixels: ImageData
  gray: GrayImage
  fingerprint: string
  luminance: number
  contrast: number
}

export interface StableValue<T> {
  value: T | null
  candidateKey: string | null
}

export interface StableRegionState {
  stableFingerprint: string | null
  candidateFingerprint: string | null
  candidateFrames: number
  changeCount: number
}

function emptyStableValue<T>(): StableValue<T> {
  return { value: null, candidateKey: null }
}

export function createStableValues() {
  return {
    shopVisible: emptyStableValue<boolean>(),
    augmentScreenVisible: emptyStableValue<boolean>(),
    gold: emptyStableValue<number>(),
    xp: emptyStableValue<VisionXp>(),
    level: emptyStableValue<number>(),
    stage: emptyStableValue<string>(),
  }
}

export function createEmptyVisionState(): VisionGameState {
  return {
    shopVisible: null,
    shopSnapshot: [],
    gold: null,
    xp: null,
    level: null,
    stageFingerprint: null,
    augmentScreenVisible: null,
    augmentHeaderGone: null,
    augmentCards: [],
  }
}

export function createRegionState(): StableRegionState {
  return { stableFingerprint: null, candidateFingerprint: null, candidateFrames: 0, changeCount: 0 }
}

// null resets right away
export function updateStableValue<T>(state: StableValue<T>, next: T | null): T | null {
  if (next === null) {
    state.value = null
    state.candidateKey = null
    return null
  }

  const key = JSON.stringify(next)
  if (state.value !== null && JSON.stringify(state.value) === key) {
    state.candidateKey = null
  } else if (state.candidateKey === key) {
    state.value = next
    state.candidateKey = null
  } else {
    state.candidateKey = key
  }
  return state.value
}

export function updateStableFingerprint(state: StableRegionState, fingerprint: string): void {
  if (state.stableFingerprint && hammingDistance(fingerprint, state.stableFingerprint) <= SAME_IMAGE_MAX_DISTANCE) {
    state.candidateFingerprint = null
    state.candidateFrames = 0
    return
  }

  if (state.candidateFingerprint && hammingDistance(fingerprint, state.candidateFingerprint) <= SAME_IMAGE_MAX_DISTANCE) {
    state.candidateFrames++
  } else {
    state.candidateFingerprint = fingerprint
    state.candidateFrames = 1
  }

  if (state.candidateFrames >= STABLE_FRAME_COUNT) {
    if (state.stableFingerprint) state.changeCount++
    state.stableFingerprint = state.candidateFingerprint
    state.candidateFingerprint = null
    state.candidateFrames = 0
  }
}

export function isEmptyShopSlot(analysis: Pick<RegionAnalysis, 'luminance' | 'contrast' | 'fingerprint'>): boolean {
  if (analysis.luminance <= EMPTY_SLOT_MAX_LUMINANCE && analysis.contrast <= EMPTY_SLOT_MAX_CONTRAST) return true
  return EMPTY_SLOT_FINGERPRINTS.some(reference => hammingDistance(analysis.fingerprint, reference) <= EMPTY_SLOT_MAX_DISTANCE)
}

export function extractTextGlyphs(analysis: RegionAnalysis): GlyphGrid[] {
  return extractGlyphs(toWhiteness(analysis.pixels), TEXT_MIN_WHITENESS)
}

// Exact glyph signature of the stage label (e.g. "2-5"). The 64-bit dHash differs by only
// ~2 bits between "1-2" and "1-5", so a single changed digit needs glyph-level comparison.
export function readStageSignature(stage: RegionAnalysis): string | null {
  const glyphs = extractTextGlyphs(stage)
  return glyphs.length > 0 ? glyphs.map(glyph => glyph.join('')).join('|') : null
}

// "Lvl. 6": the last word holds the digits; the HUD digits share the gold font closely enough
// that the taught gold templates read them (checked on the saved 2560x1440 samples)
export function readLevel(level: RegionAnalysis, goldTemplates: DigitTemplates): number | null {
  const words = extractGlyphWords(toWhiteness(level.pixels), TEXT_MIN_WHITENESS)
  if (words.length < 2) return null
  const text = recognizeText(words[words.length - 1], goldTemplates)
  const value = text !== null && /^\d{1,2}$/.test(text) ? Number(text) : null
  return value !== null && value >= 1 && value <= MAX_LEVEL ? value : null
}

export function readGold(glyphs: GlyphGrid[], goldTemplates: DigitTemplates): number | null {
  const text = recognizeText(glyphs, goldTemplates)
  return text !== null && TEXT_PATTERNS.gold.test(text) ? Number(text) : null
}

export function parseXp(text: string | null): VisionXp | null {
  const match = text?.match(/^(\d+)\/(\d+)$/)
  if (!match) return null
  const xp = { current: Number(match[1]), max: Number(match[2]) }
  return xp.max > 0 && xp.current <= xp.max ? xp : null
}
