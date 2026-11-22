// Per-resolution vision calibration: reference fingerprints, taught glyphs and the cached HUD
// alignment. Bundled defaults (measured in game) are overridden per profile by the local file.
import calibrationDefaultsData from '../data/vision-calibration-defaults.json'
import regionsData from '../data/vision-regions.json'
import type { Platform } from '../platform'
import type { VisionTextRegion } from '../types/vision'
import { ANCHOR_MIN_SCORE, type HudAlignment } from './alignment'
import type { DigitTemplates } from './analysis'

const CALIBRATION_PATH = 'TFTArchipelago/vision-calibration.json'

export const REFERENCE_PROFILE = regionsData.referenceProfile

export interface ProfileCalibration {
  shopReferenceFingerprint?: string
  augmentReferenceFingerprint?: string
  goldDigits?: DigitTemplates
  xpGlyphs?: DigitTemplates
  // Cached HUD alignment for this resolution
  alignment?: HudAlignment
}

export interface VisionCalibration {
  version: 1
  profiles: Record<string, ProfileCalibration>
}

export type ReferenceField = 'shopReferenceFingerprint' | 'augmentReferenceFingerprint'

export function getBundledCalibration(): VisionCalibration {
  return structuredClone(calibrationDefaultsData as VisionCalibration)
}

// Merge bundled and user-saved glyph templates per character so upgrading the app never drops
// newly bundled glyphs behind an older saved calibration file
export function mergeDigitTemplates(
  bundled: DigitTemplates | undefined,
  saved: DigitTemplates | undefined,
): DigitTemplates | undefined {
  if (!bundled && !saved) return undefined
  const merged: DigitTemplates = {}
  const keys = new Set([...Object.keys(bundled ?? {}), ...Object.keys(saved ?? {})])
  for (const key of keys) {
    const seen = new Set<string>()
    const unique: DigitTemplates[string] = []
    for (const glyph of [...(bundled?.[key] ?? []), ...(saved?.[key] ?? [])]) {
      const signature = glyph.join('')
      if (seen.has(signature)) continue
      seen.add(signature)
      unique.push(glyph)
    }
    if (unique.length > 0) merged[key] = unique
  }
  return merged
}

export class CalibrationStore {
  private readonly calibration = getBundledCalibration()

  constructor(private readonly platform: Platform) {}

  getProfile(profileKey: string): ProfileCalibration {
    this.calibration.profiles[profileKey] ??= {}
    return this.calibration.profiles[profileKey]
  }

  getCachedAlignment(profileKey: string): HudAlignment | null {
    const alignment = this.calibration.profiles[profileKey]?.alignment ?? null
    // Drop anchor-less alignments that older versions could save while TFT sat in the client menu
    if (!alignment || !alignment.matches.some(match => match.score >= ANCHOR_MIN_SCORE)) return null
    return alignment
  }

  // Glyph grids are size-normalized, so the reference profile's templates work at other resolutions
  getTextTemplates(profileKey: string, region: VisionTextRegion): DigitTemplates {
    const pick = (profile: ProfileCalibration | undefined) => (region === 'gold' ? profile?.goldDigits : profile?.xpGlyphs) ?? {}
    return { ...pick(this.calibration.profiles[REFERENCE_PROFILE]), ...pick(this.getProfile(profileKey)) }
  }

  getReferenceFingerprint(profileKey: string, field: ReferenceField): string | undefined {
    return this.getProfile(profileKey)[field] ?? this.calibration.profiles[REFERENCE_PROFILE]?.[field]
  }

  // Returns true when bundled defaults exist for the profile
  resetProfile(profileKey: string): boolean {
    const bundledProfile = getBundledCalibration().profiles[profileKey]
    if (bundledProfile) {
      this.calibration.profiles[profileKey] = bundledProfile
    } else {
      delete this.calibration.profiles[profileKey]
    }
    return bundledProfile !== undefined
  }

  async load(): Promise<void> {
    const content = await this.platform.readDocumentsFile(CALIBRATION_PATH)
    if (!content) return
    try {
      const parsed = JSON.parse(content) as VisionCalibration
      if (parsed.version !== 1 || typeof parsed.profiles !== 'object') return
      for (const [profileKey, profile] of Object.entries(parsed.profiles)) {
        const bundled = this.calibration.profiles[profileKey]
        this.calibration.profiles[profileKey] = {
          ...bundled,
          ...profile,
          goldDigits: mergeDigitTemplates(bundled?.goldDigits, profile.goldDigits),
          xpGlyphs: mergeDigitTemplates(bundled?.xpGlyphs, profile.xpGlyphs),
        }
      }
    } catch (error) {
      console.warn('Failed to parse vision calibration:', error)
    }
  }

  save(): Promise<boolean> {
    // Created in memory before the first frame arrives; never meaningful on disk
    delete this.calibration.profiles['unknown']
    return this.platform.writeDocumentsFile(CALIBRATION_PATH, `${JSON.stringify(this.calibration, null, 2)}\n`)
  }
}
