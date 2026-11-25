import { describe, expect, it } from 'vitest'
import {
  REFERENCE_ANCHOR_RECTS,
  buildAlignment,
  markAlignmentCached,
  promoteTrustedGroups,
  type AnchorMatch,
  type HudAlignment,
  type HudGroup,
} from './alignment'
import { PLAYER_REPORT_1080P_ALIGNMENT, PLAYER_REPORT_1080P_RUN_MATCHES } from './fixtures/alignment-1080p'

const CLIENT_1080P = { x: 0, y: 0, w: 1920, h: 1080 }

// A match for `name` placed as if the HUD were drawn at scale 0.75 and shifted right by `shiftX`
function matchAt(name: string, shiftX: number, score = 0.95): AnchorMatch {
  const anchor = REFERENCE_ANCHOR_RECTS[name]
  return {
    name,
    group: anchor.group,
    x: anchor.x * 0.75 + shiftX,
    y: anchor.y * 0.75,
    scale: 0.75,
    score,
  }
}

describe('buildAlignment', () => {
  it('keeps a saved bottom group only as cached when no bottom anchor is found in this match', () => {
    const alignment = buildAlignment('1920x1080', CLIENT_1080P, PLAYER_REPORT_1080P_RUN_MATCHES, PLAYER_REPORT_1080P_ALIGNMENT)

    expect(alignment.groups.bottom.source).toBe('cached')
    expect(alignment.groups.bottom.offsetX).toBe(0.5)
  })

  it('lets a fresh stage icon through when the bottom group is only cached', () => {
    const alignment = buildAlignment('1920x1080', CLIENT_1080P, PLAYER_REPORT_1080P_RUN_MATCHES, PLAYER_REPORT_1080P_ALIGNMENT)
    const stage = PLAYER_REPORT_1080P_RUN_MATCHES.find(match => match.name === 'stage_icon')!

    expect(alignment.groups.top.source).toBe('anchor')
    expect(alignment.groups.top.offsetX).toBeCloseTo(stage.x - REFERENCE_ANCHOR_RECTS.stage_icon.x * 0.75, 5)
  })

  it('carries groups trusted in this match as anchors', () => {
    const trusted = new Set<HudGroup>(['bottom'])
    const alignment = buildAlignment('1920x1080', CLIENT_1080P, [], PLAYER_REPORT_1080P_ALIGNMENT, trusted)

    expect(alignment.groups.bottom.source).toBe('anchor')
  })

  it('uses a fresh bottom anchor at the shifted position over the saved one', () => {
    const matches = [matchAt('buy_xp', 100), matchAt('reroll_label', 100)]
    const alignment = buildAlignment('1920x1080', CLIENT_1080P, matches, PLAYER_REPORT_1080P_ALIGNMENT)

    expect(alignment.groups.bottom.source).toBe('anchor')
    expect(alignment.groups.bottom.offsetX).toBeCloseTo(100, 5)
  })

  it('drops a carried top group that contradicts a fresh bottom anchor', () => {
    const staleTop: HudAlignment = {
      ...PLAYER_REPORT_1080P_ALIGNMENT,
      groups: { ...PLAYER_REPORT_1080P_ALIGNMENT.groups, top: { scale: 1, offsetX: 228, offsetY: 0, score: 0.97, source: 'anchor' } },
      matches: [],
    }
    const alignment = buildAlignment('1920x1080', CLIENT_1080P, [matchAt('buy_xp', 0)], staleTop)

    expect(alignment.groups.top.source).toBe('fallback')
  })
})

describe('promoteTrustedGroups', () => {
  it('trusts nothing while the bottom group is only cached', () => {
    const trusted = new Set<HudGroup>()
    const alignment = promoteTrustedGroups(
      buildAlignment('1920x1080', CLIENT_1080P, PLAYER_REPORT_1080P_RUN_MATCHES, PLAYER_REPORT_1080P_ALIGNMENT, trusted),
      trusted,
    )

    expect(trusted.size).toBe(0)
    expect(alignment.groups.bottom.source).toBe('cached')
  })

  it('trusts the bottom group and agreeing carried groups once a bottom anchor is found', () => {
    const trusted = new Set<HudGroup>()
    const alignment = promoteTrustedGroups(
      buildAlignment('1920x1080', CLIENT_1080P, [matchAt('buy_xp', 0.5)], PLAYER_REPORT_1080P_ALIGNMENT, trusted),
      trusted,
    )

    expect([...trusted].sort()).toEqual(['augment', 'bottom', 'top'])
    expect(alignment.groups.augment.source).toBe('anchor')
  })

  it('does not trust a carried top group that the stage icon on screen contradicts', () => {
    // The player's file: the bottom anchor is found 100 px right, her stage icon (0.953) sits further
    // right than the bottom group allows, the saved top group would still agree with the bottom group
    const stage = PLAYER_REPORT_1080P_RUN_MATCHES.find(match => match.name === 'stage_icon')!
    const trusted = new Set<HudGroup>()
    const alignment = promoteTrustedGroups(
      buildAlignment('1920x1080', CLIENT_1080P, [matchAt('buy_xp', 100), stage], markAlignmentCached(PLAYER_REPORT_1080P_ALIGNMENT), trusted),
      trusted,
    )

    expect(trusted.has('bottom')).toBe(true)
    expect(trusted.has('top')).toBe(false)
    expect(alignment.groups.top.source).toBe('fallback')
  })

  it('does not trust a carried augment group that the augment header on screen contradicts', () => {
    const trusted = new Set<HudGroup>()
    const alignment = promoteTrustedGroups(
      buildAlignment('1920x1080', CLIENT_1080P, [matchAt('buy_xp', 0.5), matchAt('choose_one', 300)], markAlignmentCached(PLAYER_REPORT_1080P_ALIGNMENT), trusted),
      trusted,
    )

    expect(trusted.has('augment')).toBe(false)
    expect(alignment.groups.augment.source).toBe('derived')
  })

  it('keeps a group confirmed earlier in this match when a later match contradicts it', () => {
    const stage = PLAYER_REPORT_1080P_RUN_MATCHES.find(match => match.name === 'stage_icon')!
    const trusted = new Set<HudGroup>(['bottom', 'top'])
    const confirmed = promoteTrustedGroups(PLAYER_REPORT_1080P_ALIGNMENT, trusted)
    const alignment = buildAlignment('1920x1080', CLIENT_1080P, [matchAt('buy_xp', 100), stage], confirmed, trusted)

    expect(alignment.groups.top).toMatchObject({ source: 'anchor', offsetX: 56 })
  })
})

describe('markAlignmentCached', () => {
  it('turns anchors into cached groups and keeps estimates as they are', () => {
    const alignment = buildAlignment('1920x1080', CLIENT_1080P, [matchAt('buy_xp', 0)])
    const cached = markAlignmentCached(alignment)

    expect(cached.groups.bottom.source).toBe('cached')
    expect(cached.groups.top.source).toBe('fallback')
    expect(cached.groups.augment.source).toBe('derived')
  })
})
