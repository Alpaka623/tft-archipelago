// Blocker definitions and the on-disk calibration format. Pure functions only, so the format
// handling can be tested without a runtime.
import { isRecord, readNumberFromRaw } from '../raw'
import type { BlockerProfiles, BlockerRect } from '../state'

export interface BlockerDef {
  windowName: string
  // Position at the 1920x1080 reference resolution
  refX: number
  refY: number
  refW: number
  refH: number
}

export interface BlockerConfigV3 {
  version: 3
  profiles: BlockerProfiles
}

export const BLOCKER_DEFS: BlockerDef[] = [
  { windowName: 'shop_slot_4_blocker',        refX: 724,  refY: 619, refW: 127, refH: 95  },
  { windowName: 'shop_slot_5_blocker',        refX: 858,  refY: 618, refW: 127, refH: 95  },
  { windowName: 'reroll_button_blocker',      refX: 457,  refY: 957, refW: 88,  refH: 86  },
  { windowName: 'xp_button_blocker',          refX: 1461, refY: 957, refW: 88,  refH: 86  },
  { windowName: 'augment_slot_left_blocker',  refX: 370,  refY: 280, refW: 380, refH: 500 },
  { windowName: 'augment_slot_right_blocker', refX: 1170, refY: 280, refW: 380, refH: 500 },
  { windowName: 'augment_reroll_1_blocker',   refX: 585,  refY: 770, refW: 36,  refH: 36  },
  { windowName: 'augment_reroll_2_blocker',   refX: 950,  refY: 770, refW: 36,  refH: 36  },
  { windowName: 'augment_reroll_3_blocker',   refX: 1315, refY: 770, refW: 36,  refH: 36  },
]

const REFERENCE_WIDTH = 1920
const REFERENCE_HEIGHT = 1080

export function getProfileKey(width: number, height: number): string {
  if (width > 0 && height > 0) return `${Math.round(width)}x${Math.round(height)}`
  return 'unknown'
}

function getReferenceRect(def: BlockerDef): BlockerRect {
  return { x: def.refX, y: def.refY, w: def.refW, h: def.refH }
}

// Scales a reference rect to a resolution; wider than 16:9 centers the HUD horizontally
export function scaleReferenceRect(rect: BlockerRect, width: number, height: number): BlockerRect {
  const scaleX = width / REFERENCE_WIDTH
  const scaleY = height / REFERENCE_HEIGHT
  const ultrawideOffsetX = Math.max(0, (width - height * (16 / 9)) / 2)
  return {
    x: Math.round(rect.x * scaleX + ultrawideOffsetX),
    y: Math.round(rect.y * scaleY),
    w: Math.round(rect.w * scaleX),
    h: Math.round(rect.h * scaleY),
  }
}

export function getDefaultRect(def: BlockerDef, width: number, height: number): BlockerRect {
  if (width <= 0 || height <= 0) return getReferenceRect(def)
  return scaleReferenceRect(getReferenceRect(def), width, height)
}

function normalizeBlockerRect(value: unknown, fallback: BlockerRect): BlockerRect {
  if (!isRecord(value)) return { ...fallback }

  const x = readNumberFromRaw(value['x'])
  const y = readNumberFromRaw(value['y'])
  const w = readNumberFromRaw(value['w'])
  const h = readNumberFromRaw(value['h'])

  if (x === null || y === null || w === null || h === null) {
    return { ...fallback }
  }

  return clampBlockerRect({ x, y, w, h })
}

export function clampBlockerRect(rect: BlockerRect): BlockerRect {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    w: Math.max(1, Math.round(rect.w)),
    h: Math.max(1, Math.round(rect.h)),
  }
}

function normalizeBlockerProfile(value: unknown): Record<string, BlockerRect> {
  if (!isRecord(value)) return {}

  const rects: Record<string, BlockerRect> = {}
  for (const def of BLOCKER_DEFS) {
    const raw = value[def.windowName]
    if (!raw) continue
    rects[def.windowName] = normalizeBlockerRect(raw, getReferenceRect(def))
  }

  return rects
}

function scaleProfile(rects: Record<string, BlockerRect>, width: number, height: number): Record<string, BlockerRect> {
  return Object.fromEntries(
    Object.entries(rects).map(([key, rect]) => [key, scaleReferenceRect(rect, width, height)]),
  )
}

// Version 2 stored a single profile at the reference resolution
function migrateV2BlockerConfig(blockers: unknown): BlockerConfigV3 {
  const referenceRects = normalizeBlockerProfile(blockers)
  const profiles: BlockerProfiles = {}

  if (Object.keys(referenceRects).length > 0) {
    profiles['2560x1440'] = scaleProfile(referenceRects, 2560, 1440)
    profiles['3840x2160'] = scaleProfile(referenceRects, 3840, 2160)
  }

  return { version: 3, profiles }
}

export function normalizeBlockerConfig(value: unknown): BlockerConfigV3 {
  if (!isRecord(value)) return { version: 3, profiles: {} }

  if (value['version'] === 3 && isRecord(value['profiles'])) {
    const profiles: BlockerProfiles = {}
    for (const [profileKey, rawProfile] of Object.entries(value['profiles'])) {
      if (!isRecord(rawProfile)) continue
      profiles[profileKey] = normalizeBlockerProfile(rawProfile)
    }
    return { version: 3, profiles }
  }

  if (value['version'] === 2 && isRecord(value['blockers'])) {
    return migrateV2BlockerConfig(value['blockers'])
  }

  return { version: 3, profiles: {} }
}

export function cloneBlockerProfile(profile: Record<string, BlockerRect>): Record<string, BlockerRect> {
  return Object.fromEntries(
    Object.entries(profile).map(([key, rect]) => [key, { ...rect }]),
  )
}

export function mergeBlockerConfigs(base: BlockerConfigV3, override: BlockerConfigV3): BlockerConfigV3 {
  const profiles: BlockerProfiles = {}

  for (const [profileKey, profile] of Object.entries(base.profiles)) {
    profiles[profileKey] = cloneBlockerProfile(profile)
  }

  for (const [profileKey, profile] of Object.entries(override.profiles)) {
    profiles[profileKey] = {
      ...(profiles[profileKey] ?? {}),
      ...cloneBlockerProfile(profile),
    }
  }

  return { version: 3, profiles }
}

function roundBlockerRect(rect: BlockerRect): BlockerRect {
  return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }
}

// Only rects that differ from the bundled defaults are written, so later default updates
// (and the vision HUD alignment) are not frozen into the player's file
export function serializeBlockerConfig(config: BlockerConfigV3, bundled: BlockerProfiles): string {
  const profiles = Object.fromEntries(
    Object.entries(config.profiles)
      .map(([profileKey, rects]) => [
        profileKey,
        Object.fromEntries(
          Object.entries(rects)
            .map(([key, rect]) => [key, roundBlockerRect(rect)] as const)
            .filter(([key, rect]) => {
              const defaultRect = bundled[profileKey]?.[key]
              return !defaultRect || JSON.stringify(roundBlockerRect(defaultRect)) !== JSON.stringify(rect)
            }),
        ),
      ] as const)
      .filter(([, rects]) => Object.keys(rects).length > 0),
  )
  return JSON.stringify({ version: 3, profiles }, null, 2)
}

const CALIBRATION_AGREEMENT = 0.25

// Centers within a quarter of the rect size count as the same HUD element
export function rectsAgree(left: BlockerRect, right: BlockerRect): boolean {
  const dx = Math.abs((left.x + left.w / 2) - (right.x + right.w / 2))
  const dy = Math.abs((left.y + left.h / 2) - (right.y + right.h / 2))
  return dx <= right.w * CALIBRATION_AGREEMENT && dy <= right.h * CALIBRATION_AGREEMENT
}
