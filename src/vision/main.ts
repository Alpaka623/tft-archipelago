// Electron only: captures TFT, reads the HUD, sends state to the background
import { BACKGROUND_WINDOW_ID, platform as detectedPlatform, type Platform } from '../platform'
import {
  AUGMENT_CARD_REGIONS,
  SHOP_SLOT_REGIONS,
  VISION_REGION_NAMES,
  type VisionActionResult,
  type VisionCommand,
  type VisionDebugUpdate,
  type VisionGameState,
  type VisionRegionName,
  type VisionRegionResult,
  type VisionStatus,
  type VisionTextRegion,
} from '../types/vision'
import {
  differenceHash,
  hammingDistance,
  luminanceStats,
  recognizeText,
  toGray,
} from './analysis'
import { CalibrationStore, type ReferenceField } from './calibration'
import { FrameCapture, getFrameSize } from './capture'
import { HudAligner } from './hud-aligner'
import {
  TEXT_PATTERNS,
  createEmptyVisionState,
  createRegionState,
  createStableValues,
  extractTextGlyphs,
  isEmptyShopSlot,
  parseXp,
  readGold,
  readLevel,
  readStageSignature,
  updateStableFingerprint,
  updateStableValue,
  type RegionAnalysis,
  type StableRegionState,
} from './readings'
import { framePreviewDataUrl, regionPreviewDataUrl, writeFrameSamples } from './samples'

const DESKTOP_WINDOW_ID = 'desktop'
const SAMPLES_DIR = 'TFTArchipelago/samples'
const ANALYZE_INTERVAL_MS = 100
const DEBUG_UPDATE_INTERVAL_MS = 500
const SHOP_REFERENCE_MAX_DISTANCE = 12
// normal play measures 20-31, so this already matches while "Choose One" fades in
const AUGMENT_REFERENCE_MAX_DISTANCE = 16
// hysteresis, a busy board behind the header pushes the distance up a bit
const AUGMENT_REFERENCE_OPEN_MAX_DISTANCE = 18
// normal-play range = header is really gone
const AUGMENT_HEADER_GONE_MIN_DISTANCE = 20
// resend so the background recovers after reloads
const GAME_STATE_HEARTBEAT_MS = 2000
const MAX_TEMPLATES_PER_DIGIT = 6

function requirePlatform(): Platform {
  if (!detectedPlatform) throw new Error('Vision window requires the Electron runtime')
  return detectedPlatform
}

const platform = requirePlatform()
const frameCanvas = new OffscreenCanvas(1, 1)
const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true })!
const calibration = new CalibrationStore(platform)

const status: VisionStatus = {
  capturing: false,
  source: null,
  sourceId: null,
  frameWidth: 0,
  frameHeight: 0,
  profileKey: 'unknown',
  analyzedFps: 0,
  error: null,
}
const aligner = new HudAligner(platform, status, calibration)
let analyzeTimer: number | null = null
const capture = new FrameCapture(platform, status, {
  onStarted: () => {
    analyzeTimer = window.setInterval(analyzeLatestFrame, ANALYZE_INTERVAL_MS)
  },
  onStopped: () => {
    if (analyzeTimer !== null) window.clearInterval(analyzeTimer)
    analyzeTimer = null
    status.analyzedFps = 0
    resetReadings()
  },
})

let isDebugSubscribed = false
let lastDebugUpdateAt = 0
let analyzedFrameCount = 0
let fpsWindowStartedAt = performance.now()
let regionStates = createRegionStates()
let lastAnalyses: RegionAnalysis[] = []
let lastShopReferenceDistance: number | null = null
let lastAugmentReferenceDistance: number | null = null
let lastGoldGlyphCount = 0
let lastXpText: string | null = null
let lastXpGlyphCount = 0
let stableValues = createStableValues()
let visionState: VisionGameState = createEmptyVisionState()
// Region layout of the last analyzed frame; a change moves every region onto new content
let lastLayoutKey = ''
let lastSentVisionStateKey = ''
let lastVisionStateSentAt = 0

function createRegionStates(): Record<VisionRegionName, StableRegionState> {
  return Object.fromEntries(VISION_REGION_NAMES.map(name => [name, createRegionState()])) as Record<VisionRegionName, StableRegionState>
}

function resetReadings(): void {
  regionStates = createRegionStates()
  stableValues = createStableValues()
  visionState = createEmptyVisionState()
  lastSentVisionStateKey = ''
  lastLayoutKey = ''
}

function getProfileCalibration() {
  return calibration.getProfile(status.profileKey)
}

function getTextTemplates(region: VisionTextRegion) {
  return calibration.getTextTemplates(status.profileKey, region)
}

function getReferenceFingerprint(field: ReferenceField): string | undefined {
  return calibration.getReferenceFingerprint(status.profileKey, field)
}

function sendVisionStateIfChanged(now: number): void {
  const key = JSON.stringify(visionState)
  if (key === lastSentVisionStateKey && now - lastVisionStateSentAt < GAME_STATE_HEARTBEAT_MS) return
  lastSentVisionStateKey = key
  lastVisionStateSentAt = now
  platform.sendMessage(BACKGROUND_WINDOW_ID, 'VISION_GAME_STATE', visionState)
}

function drawLatestFrame(): boolean {
  const frame = capture.latestFrame
  if (!frame) return false

  const { width, height } = getFrameSize(frame)
  if (width <= 0 || height <= 0) return false
  if (frameCanvas.width !== width || frameCanvas.height !== height) {
    frameCanvas.width = width
    frameCanvas.height = height
  }
  status.frameWidth = width
  status.frameHeight = height
  const profileKey = `${width}x${height}`
  if (profileKey !== status.profileKey) {
    status.profileKey = profileKey
    aligner.handleProfileChanged(profileKey)
  }
  frameContext.drawImage(frame, 0, 0)
  return true
}

function analyzeRegions(): Record<VisionRegionName, RegionAnalysis> {
  const regions = aligner.getRegions()
  const layoutKey = JSON.stringify(regions)
  if (layoutKey !== lastLayoutKey) {
    const hadLayout = lastLayoutKey !== ''
    lastLayoutKey = layoutKey
    if (hadLayout) {
      // Old fingerprints describe other screen areas; start fresh and let the background resync
      regionStates = createRegionStates()
      stableValues = createStableValues()
      platform.sendMessage(BACKGROUND_WINDOW_ID, 'VISION_LAYOUT_CHANGED', {})
      console.log('Vision layout changed', { profileKey: status.profileKey })
    }
  }

  lastAnalyses = VISION_REGION_NAMES.map((name) => {
    const rect = regions[name]
    const pixels = frameContext.getImageData(rect.x, rect.y, rect.w, rect.h)
    const gray = toGray(pixels)
    const stats = luminanceStats(gray)
    const fingerprint = differenceHash(gray)
    updateStableFingerprint(regionStates[name], fingerprint)
    return { name, rect, pixels, gray, fingerprint, luminance: stats.mean, contrast: stats.stdDev }
  })

  return Object.fromEntries(lastAnalyses.map(analysis => [analysis.name, analysis])) as Record<VisionRegionName, RegionAnalysis>
}

function readGameState(byName: Record<VisionRegionName, RegionAnalysis>): VisionGameState {
  const shopReference = getReferenceFingerprint('shopReferenceFingerprint')
  lastShopReferenceDistance = shopReference ? hammingDistance(byName.shop_reference.fingerprint, shopReference) : null
  const rawShopVisible = lastShopReferenceDistance === null ? null : lastShopReferenceDistance <= SHOP_REFERENCE_MAX_DISTANCE

  const augmentReference = getReferenceFingerprint('augmentReferenceFingerprint')
  lastAugmentReferenceDistance = augmentReference ? hammingDistance(byName.augment_header.fingerprint, augmentReference) : null
  const augmentMaxDistance = stableValues.augmentScreenVisible.value === true
    ? AUGMENT_REFERENCE_OPEN_MAX_DISTANCE
    : AUGMENT_REFERENCE_MAX_DISTANCE
  const rawAugmentVisible = lastAugmentReferenceDistance === null ? null : lastAugmentReferenceDistance <= augmentMaxDistance

  const shopSnapshot = SHOP_SLOT_REGIONS.map((name) => {
    if (isEmptyShopSlot(byName[name])) return 'Sold'
    const stable = regionStates[name].stableFingerprint
    return stable ? `card-${stable.slice(0, 8)}` : ''
  })

  const goldTemplates = getTextTemplates('gold')
  const goldGlyphs = extractTextGlyphs(byName.gold)
  lastGoldGlyphCount = goldGlyphs.length
  const rawGold = readGold(goldGlyphs, goldTemplates)

  const xpGlyphs = extractTextGlyphs(byName.xp)
  lastXpGlyphCount = xpGlyphs.length
  lastXpText = recognizeText(xpGlyphs, getTextTemplates('xp'))

  // augment screen always hides the shop, requiring both avoids false hits
  const rawAugmentScreenVisible = rawAugmentVisible === null ? null : rawAugmentVisible && rawShopVisible === false
  if (rawAugmentScreenVisible === true) {
    // no two-frame confirm on open, blockers need to be up fast
    stableValues.augmentScreenVisible.value = true
    stableValues.augmentScreenVisible.candidateKey = null
  }
  const augmentScreenVisible = updateStableValue(stableValues.augmentScreenVisible, rawAugmentScreenVisible)
  return {
    shopVisible: updateStableValue(stableValues.shopVisible, rawShopVisible),
    shopSnapshot,
    gold: updateStableValue(stableValues.gold, rawGold),
    xp: updateStableValue(stableValues.xp, parseXp(lastXpText)),
    level: updateStableValue(stableValues.level, readLevel(byName.level, goldTemplates)),
    stageFingerprint: updateStableValue(stableValues.stage, readStageSignature(byName.stage)),
    augmentScreenVisible,
    augmentHeaderGone: lastAugmentReferenceDistance === null ? null : lastAugmentReferenceDistance >= AUGMENT_HEADER_GONE_MIN_DISTANCE,
    augmentCards: augmentScreenVisible
      ? AUGMENT_CARD_REGIONS.map(name => regionStates[name].stableFingerprint ?? '')
      : [],
  }
}

function updateAnalyzedFps(now: number): void {
  analyzedFrameCount++
  if (now - fpsWindowStartedAt < 1000) return
  status.analyzedFps = Math.round((analyzedFrameCount * 1000) / (now - fpsWindowStartedAt))
  analyzedFrameCount = 0
  fpsWindowStartedAt = now
}

function analyzeLatestFrame(): void {
  if (!drawLatestFrame()) return

  visionState = readGameState(analyzeRegions())

  const now = performance.now()
  updateAnalyzedFps(now)
  sendVisionStateIfChanged(now)
  aligner.sendToBackground()
  aligner.maybeRealign(frameContext, visionState.shopVisible, now)

  if (isDebugSubscribed && now - lastDebugUpdateAt >= DEBUG_UPDATE_INTERVAL_MS) {
    lastDebugUpdateAt = now
    sendDebugUpdate(true)
  }
}

function sendDebugUpdate(includePreviews: boolean): void {
  const hasFrame = status.capturing && lastAnalyses.length > 0
  const regions: VisionRegionResult[] = lastAnalyses.map(analysis => ({
    name: analysis.name,
    rect: analysis.rect,
    fingerprint: analysis.fingerprint,
    luminance: Math.round(analysis.luminance),
    contrast: Math.round(analysis.contrast),
    changeCount: regionStates[analysis.name].changeCount,
    previewDataUrl: includePreviews && hasFrame ? regionPreviewDataUrl(frameCanvas, analysis.rect) : undefined,
  }))
  const alignment = aligner.getAlignment()

  const update: VisionDebugUpdate = {
    status,
    regions,
    gameState: visionState,
    shopReferenceDistance: lastShopReferenceDistance,
    augmentReferenceDistance: lastAugmentReferenceDistance,
    goldGlyphCount: lastGoldGlyphCount,
    xpText: lastXpText,
    xpGlyphCount: lastXpGlyphCount,
    taughtGoldDigits: Object.keys(getTextTemplates('gold')).sort(),
    taughtXpChars: Object.keys(getTextTemplates('xp')).sort(),
    alignment: {
      isAligning: aligner.isAligning,
      groups: alignment.groups,
      matches: alignment.matches.map(({ name, score, scale }) => ({ name, score: Math.round(score * 1000) / 1000, scale })),
    },
    framePreviewDataUrl: includePreviews && hasFrame ? framePreviewDataUrl(frameCanvas, lastAnalyses) : undefined,
  }
  platform.sendMessage(DESKTOP_WINDOW_ID, 'VISION_DEBUG_UPDATE', update)
}

function sendActionResult(result: VisionActionResult): void {
  platform.sendMessage(DESKTOP_WINDOW_ID, 'VISION_ACTION_RESULT', result)
}

function writeCurrentFrameSamples(folder: string): Promise<boolean> {
  return writeFrameSamples(platform, folder, frameCanvas, lastAnalyses, {
    profileKey: status.profileKey,
    source: status.source,
    gameState: visionState,
    shopReferenceDistance: lastShopReferenceDistance,
    augmentReferenceDistance: lastAugmentReferenceDistance,
    goldGlyphCount: lastGoldGlyphCount,
    xpText: lastXpText,
    xpGlyphCount: lastXpGlyphCount,
  })
}

async function saveSamples(): Promise<VisionActionResult> {
  if (!status.capturing || lastAnalyses.length === 0) {
    return { action: 'save_samples', success: false, message: 'No frame captured yet' }
  }

  const folder = `${SAMPLES_DIR}/${new Date().toISOString().replace(/[:.]/g, '-')}`
  const success = await writeCurrentFrameSamples(folder)
  return { action: 'save_samples', success, message: success ? `Saved to Documents/${folder}` : 'Some sample files failed to write' }
}

// Rule violation evidence: the frame closest to the detection
async function saveViolationEvidence(folder: string): Promise<void> {
  if (!status.capturing || lastAnalyses.length === 0) {
    console.warn('Vision: no frame for violation evidence', { folder })
    return
  }
  const success = await writeCurrentFrameSamples(folder)
  console.log('Vision: violation evidence saved', { folder, success })
}

async function setReference(
  field: ReferenceField,
  regionName: VisionRegionName,
  action: 'set_shop_reference' | 'set_augment_reference',
  label: string,
): Promise<VisionActionResult> {
  const analysis = lastAnalyses.find(candidate => candidate.name === regionName)
  if (!analysis) return { action, success: false, message: 'No frame captured yet' }

  getProfileCalibration()[field] = analysis.fingerprint
  const success = await calibration.save()
  return { action, success, message: success ? `${label} set for ${status.profileKey}` : 'Failed to save calibration' }
}

async function teachText(region: VisionTextRegion, value: string): Promise<VisionActionResult> {
  const analysis = lastAnalyses.find(candidate => candidate.name === region)
  if (!analysis) return { action: 'teach_text', success: false, message: 'No frame captured yet' }
  if (!TEXT_PATTERNS[region].test(value)) {
    return { action: 'teach_text', success: false, message: region === 'gold' ? 'Enter the gold shown in game' : 'Enter the XP shown in game, e.g. 4/6' }
  }

  const glyphs = extractTextGlyphs(analysis)
  if (glyphs.length !== value.length) {
    return { action: 'teach_text', success: false, message: `Found ${glyphs.length} glyphs for ${value.length} characters` }
  }

  const profileCalibration = getProfileCalibration()
  const templates = region === 'gold'
    ? (profileCalibration.goldDigits ??= {})
    : (profileCalibration.xpGlyphs ??= {})
  glyphs.forEach((glyph, index) => {
    const char = value[index]
    templates[char] = [...(templates[char] ?? []), glyph].slice(-MAX_TEMPLATES_PER_DIGIT)
  })
  const success = await calibration.save()
  return { action: 'teach_text', success, message: success ? `Learned ${region} "${value}" for ${status.profileKey}` : 'Failed to save calibration' }
}

async function resetCalibration(): Promise<VisionActionResult> {
  const hasBundledProfile = calibration.resetProfile(status.profileKey)
  const success = await calibration.save()
  const message = hasBundledProfile ? `Calibration reset to bundled defaults for ${status.profileKey}` : `Calibration cleared for ${status.profileKey}`
  return { action: 'reset_calibration', success, message: success ? message : 'Failed to save calibration' }
}

async function rerunAlignment(): Promise<VisionActionResult> {
  const success = await aligner.rerun(frameContext, visionState.shopVisible, lastAnalyses.length > 0)
  return {
    action: 'run_alignment',
    success,
    message: success ? `HUD alignment updated for ${status.profileKey}` : 'No frame captured yet',
  }
}

async function handleCommand(command: VisionCommand): Promise<void> {
  switch (command.id) {
    case 'VISION_DEBUG_SUBSCRIBE':
      isDebugSubscribed = command.content.enabled
      if (isDebugSubscribed) sendDebugUpdate(true)
      return
    case 'VISION_SAVE_SAMPLES':
      sendActionResult(await saveSamples())
      return
    case 'VISION_SET_SHOP_REFERENCE':
      sendActionResult(await setReference('shopReferenceFingerprint', 'shop_reference', 'set_shop_reference', 'Shop reference'))
      return
    case 'VISION_SET_AUGMENT_REFERENCE':
      sendActionResult(await setReference('augmentReferenceFingerprint', 'augment_header', 'set_augment_reference', 'Augment screen reference'))
      return
    case 'VISION_TEACH_TEXT':
      sendActionResult(await teachText(command.content.region, command.content.value.trim()))
      return
    case 'VISION_RESET_CALIBRATION':
      sendActionResult(await resetCalibration())
      return
    case 'VISION_RUN_ALIGNMENT':
      sendActionResult(await rerunAlignment())
      return
    case 'VISION_SAVE_EVIDENCE':
      await saveViolationEvidence(command.content.folder)
      return
  }
}

platform.onMessage((message) => {
  void handleCommand(message as VisionCommand)
})
platform.onGameStateChanged(({ state }) => capture.setGameRunning(state.isRunning))

void calibration.load().then(async () => {
  capture.setGameRunning((await platform.getRunningGame()).isRunning)
})

console.log('vision: module loaded')
