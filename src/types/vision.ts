export const VISION_WINDOW_ID = 'vision'

export const VISION_REGION_NAMES = [
  'gold',
  'level',
  'xp',
  'stage',
  'shop_reference',
  'shop_slot_1',
  'shop_slot_2',
  'shop_slot_3',
  'shop_slot_4',
  'shop_slot_5',
  'augment_header',
  'augment_1',
  'augment_2',
  'augment_3',
] as const

export type VisionRegionName = typeof VISION_REGION_NAMES[number]

export const SHOP_SLOT_REGIONS: VisionRegionName[] = ['shop_slot_1', 'shop_slot_2', 'shop_slot_3', 'shop_slot_4', 'shop_slot_5']
export const AUGMENT_CARD_REGIONS: VisionRegionName[] = ['augment_1', 'augment_2', 'augment_3']

export interface VisionRect {
  x: number
  y: number
  w: number
  h: number
}

export interface VisionRegionResult {
  name: VisionRegionName
  rect: VisionRect
  fingerprint: string
  luminance: number
  contrast: number
  // Number of times the region's stable fingerprint changed since capture start
  changeCount: number
  previewDataUrl?: string
}

export interface VisionStatus {
  capturing: boolean
  source: 'window' | 'screen' | 'test-image' | null
  sourceId: string | null
  frameWidth: number
  frameHeight: number
  profileKey: string
  analyzedFps: number
  error: string | null
}

// Text regions that can be taught: gold digits and the XP counter ('4/6')
export type VisionTextRegion = 'gold' | 'xp'

export interface VisionXp {
  current: number
  max: number
}

export interface VisionGameState {
  shopVisible: boolean | null
  // Same shape as the GEP shop snapshot: stable per-slot ids, 'Sold' for empty slots, '' while unknown
  shopSnapshot: string[]
  // only after two identical reads in a row
  gold: number | null
  xp: VisionXp | null
  // "Lvl. N" in the HUD, read with the gold digit templates
  level: number | null
  // Stable glyph signature of the stage label; a change marks a new round
  stageFingerprint: string | null
  augmentScreenVisible: boolean | null
  // raw per-frame: header distance is in the normal-play range
  augmentHeaderGone: boolean | null
  // Stable fingerprints of the three augment cards while the augment screen is visible
  augmentCards: string[]
}

export interface VisionGroupTransform {
  scale: number
  offsetX: number
  offsetY: number
  score: number
  source: 'anchor' | 'derived' | 'fallback'
}

export interface VisionAlignmentInfo {
  isAligning: boolean
  groups: Record<'bottom' | 'top' | 'augment', VisionGroupTransform>
  matches: { name: string; score: number; scale: number }[]
}

// Blocker rects derived from the HUD alignment, sent to the background controller
export interface VisionHudAlignment {
  profileKey: string
  blockerRects: Record<string, VisionRect>
  // Blockers whose HUD group was located by a matched anchor (not estimated); these rects win
  // over calibrations, because windowed TFT can draw the HUD elsewhere at the same client size
  anchoredBlockers: string[]
}

export interface VisionDebugUpdate {
  status: VisionStatus
  regions: VisionRegionResult[]
  gameState: VisionGameState
  shopReferenceDistance: number | null
  augmentReferenceDistance: number | null
  goldGlyphCount: number
  xpText: string | null
  xpGlyphCount: number
  taughtGoldDigits: string[]
  taughtXpChars: string[]
  alignment: VisionAlignmentInfo
  framePreviewDataUrl?: string
}

export interface VisionActionResult {
  action: 'save_samples' | 'set_shop_reference' | 'set_augment_reference' | 'teach_text' | 'reset_calibration' | 'run_alignment'
  success: boolean
  message: string
}

export type VisionCommand =
  | { id: 'VISION_DEBUG_SUBSCRIBE'; content: { enabled: boolean } }
  | { id: 'VISION_SAVE_SAMPLES'; content: Record<string, never> }
  | { id: 'VISION_SET_SHOP_REFERENCE'; content: Record<string, never> }
  | { id: 'VISION_SET_AUGMENT_REFERENCE'; content: Record<string, never> }
  | { id: 'VISION_TEACH_TEXT'; content: { region: VisionTextRegion; value: string } }
  | { id: 'VISION_RESET_CALIBRATION'; content: Record<string, never> }
  | { id: 'VISION_RUN_ALIGNMENT'; content: Record<string, never> }
  // Rule violation evidence: saves the current frame and region crops into the folder
  | { id: 'VISION_SAVE_EVIDENCE'; content: { folder: string } }

export type VisionEvent =
  | { id: 'VISION_DEBUG_UPDATE'; content: VisionDebugUpdate }
  | { id: 'VISION_ACTION_RESULT'; content: VisionActionResult }
