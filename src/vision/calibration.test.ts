import { describe, expect, it } from 'vitest'
import type { Platform } from '../platform'
import { CalibrationStore, mergeDigitTemplates, REFERENCE_PROFILE } from './calibration'

describe('mergeDigitTemplates', () => {
  it('preserves newly bundled glyphs alongside older saved glyphs without duplicates', () => {
    const merged = mergeDigitTemplates(
      { '0': [[1, 0]], '1': [[1, 1]], '4': [[0, 1], [1, 0, 1]], '5': [[0, 0, 1]] },
      { '0': [[1, 0]], '4': [[0, 1], [1, 1, 0]], '7': [[1, 1, 1]] },
    )

    expect(merged).toEqual({
      '0': [[1, 0]],
      '1': [[1, 1]],
      '4': [[0, 1], [1, 0, 1], [1, 1, 0]],
      '5': [[0, 0, 1]],
      '7': [[1, 1, 1]],
    })
  })
})

describe('CalibrationStore.load', () => {
  it('merges bundled XP glyphs when an older saved file only stored a subset', async () => {
    const customFour = [1, 0, 1, 0]
    const saved = JSON.stringify({
      version: 1,
      profiles: {
        [REFERENCE_PROFILE]: {
          xpGlyphs: {
            '/': [[0, 1]],
            '0': [[1, 0]],
            '4': [customFour],
            '6': [[1, 1]],
          },
        },
      },
    })
    const platform = {
      readDocumentsFile: async () => saved,
      writeDocumentsFile: async () => true,
    } as unknown as Platform

    const store = new CalibrationStore(platform)
    await store.load()
    const templates = store.getTextTemplates(REFERENCE_PROFILE, 'xp')

    expect(Object.keys(templates).sort()).toEqual(['/', '0', '1', '2', '3', '4', '5', '6', '8'])
    expect(templates['4']).toContainEqual(customFour)
  })

  it('ignores cached alignments with no matched anchors', async () => {
    const saved = JSON.stringify({
      version: 1,
      profiles: {
        [REFERENCE_PROFILE]: {
          alignment: {
            profileKey: REFERENCE_PROFILE,
            groups: {
              bottom: { scale: 1, offsetX: 0, offsetY: 0, score: 0, source: 'fallback' },
              top: { scale: 1, offsetX: 0, offsetY: 0, score: 0, source: 'fallback' },
              augment: { scale: 1, offsetX: 0, offsetY: 0, score: 0, source: 'derived' },
            },
            matches: [{ name: 'buy_xp', group: 'bottom', x: 0, y: 0, scale: 1, score: 0.2 }],
          },
        },
      },
    })
    const platform = {
      readDocumentsFile: async () => saved,
      writeDocumentsFile: async () => true,
    } as unknown as Platform

    const store = new CalibrationStore(platform)
    await store.load()

    expect(store.getCachedAlignment(REFERENCE_PROFILE)).toBeNull()
  })
})
