import { describe, expect, it } from 'vitest'
import {
  BLOCKER_DEFS,
  getDefaultRect,
  getProfileKey,
  mergeBlockerConfigs,
  normalizeBlockerConfig,
  rectsAgree,
  serializeBlockerConfig,
} from './blocker-config'

const shopSlot4 = BLOCKER_DEFS.find(def => def.windowName === 'shop_slot_4_blocker')!

describe('getProfileKey', () => {
  it('rounds the resolution and falls back to unknown', () => {
    expect(getProfileKey(2560.4, 1440)).toBe('2560x1440')
    expect(getProfileKey(0, 1440)).toBe('unknown')
  })
})

describe('getDefaultRect', () => {
  it('keeps the reference rect at 1920x1080 and without a resolution', () => {
    const reference = { x: shopSlot4.refX, y: shopSlot4.refY, w: shopSlot4.refW, h: shopSlot4.refH }
    expect(getDefaultRect(shopSlot4, 1920, 1080)).toEqual(reference)
    expect(getDefaultRect(shopSlot4, 0, 0)).toEqual(reference)
  })

  it('scales linearly and centers the HUD on ultrawide screens', () => {
    expect(getDefaultRect(shopSlot4, 3840, 2160)).toEqual({ x: 1448, y: 1238, w: 254, h: 190 })
    // 2560x1080 is 21:9; the 16:9 HUD starts 320 px from the left
    expect(getDefaultRect(shopSlot4, 2560, 1080).x).toBe(Math.round(shopSlot4.refX * (2560 / 1920) + 320))
  })
})

describe('normalizeBlockerConfig', () => {
  it('reads version 3 profiles and drops unknown blockers and broken rects', () => {
    const config = normalizeBlockerConfig({
      version: 3,
      profiles: {
        '2560x1440': {
          shop_slot_4_blocker: { x: 10.6, y: -5, w: 0, h: '20' },
          xp_button_blocker: { x: 'oops' },
          unknown_blocker: { x: 1, y: 1, w: 1, h: 1 },
        },
        broken: 'not a profile',
      },
    })

    expect(config.profiles).toEqual({
      '2560x1440': {
        shop_slot_4_blocker: { x: 11, y: 0, w: 1, h: 20 },
        xp_button_blocker: { x: 1461, y: 957, w: 88, h: 86 },
      },
    })
  })

  it('migrates a version 2 reference profile to both supported resolutions', () => {
    const config = normalizeBlockerConfig({
      version: 2,
      blockers: { shop_slot_4_blocker: { x: 100, y: 100, w: 100, h: 100 } },
    })

    expect(config.profiles['2560x1440']?.shop_slot_4_blocker).toEqual({ x: 133, y: 133, w: 133, h: 133 })
    expect(config.profiles['3840x2160']?.shop_slot_4_blocker).toEqual({ x: 200, y: 200, w: 200, h: 200 })
  })

  it('returns an empty config for anything else', () => {
    expect(normalizeBlockerConfig(null)).toEqual({ version: 3, profiles: {} })
    expect(normalizeBlockerConfig({ version: 1 })).toEqual({ version: 3, profiles: {} })
  })
})

describe('mergeBlockerConfigs', () => {
  it('lets the player file override single rects of the bundled profile', () => {
    const bundled = { version: 3 as const, profiles: { a: { one: { x: 1, y: 1, w: 1, h: 1 }, two: { x: 2, y: 2, w: 2, h: 2 } } } }
    const player = { version: 3 as const, profiles: { a: { two: { x: 9, y: 9, w: 9, h: 9 } } } }

    const merged = mergeBlockerConfigs(bundled, player)

    expect(merged.profiles['a']).toEqual({ one: { x: 1, y: 1, w: 1, h: 1 }, two: { x: 9, y: 9, w: 9, h: 9 } })
    merged.profiles['a']!['one']!.x = 5
    expect(bundled.profiles.a.one.x).toBe(1)
  })
})

describe('serializeBlockerConfig', () => {
  it('only writes rects that differ from the bundled defaults', () => {
    const bundled = { a: { one: { x: 1, y: 1, w: 1, h: 1 } } }
    const config = {
      version: 3 as const,
      profiles: {
        a: { one: { x: 1.2, y: 1, w: 1, h: 1 }, two: { x: 2, y: 2, w: 2, h: 2 } },
        b: { one: { x: 1, y: 1, w: 1, h: 1 } },
      },
    }

    expect(JSON.parse(serializeBlockerConfig(config, bundled))).toEqual({
      version: 3,
      profiles: {
        a: { two: { x: 2, y: 2, w: 2, h: 2 } },
        b: { one: { x: 1, y: 1, w: 1, h: 1 } },
      },
    })
  })
})

describe('rectsAgree', () => {
  const measured = { x: 100, y: 100, w: 100, h: 40 }

  it('accepts centers within a quarter of the rect size', () => {
    expect(rectsAgree({ x: 125, y: 110, w: 100, h: 40 }, measured)).toBe(true)
    expect(rectsAgree({ x: 126, y: 100, w: 100, h: 40 }, measured)).toBe(false)
    expect(rectsAgree({ x: 100, y: 111, w: 100, h: 40 }, measured)).toBe(false)
  })
})
