// Finds HUD anchors via multi-scale NCC and derives scale + offset per HUD group.
// Reference coordinates are pixels of the 2560x1440 HUD.
import anchorsData from '../data/hud-anchors.json'
import type { GrayImage } from './analysis'

export type HudGroup = 'bottom' | 'top' | 'augment'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface AnchorTemplate extends Rect {
  name: string
  group: HudGroup
  gray: Uint8Array
}

export interface AnchorMatch {
  name: string
  group: HudGroup
  // Top-left corner in frame pixels and the template scale that matched best
  x: number
  y: number
  scale: number
  score: number
}

export interface GroupTransform {
  scale: number
  offsetX: number
  offsetY: number
  score: number
  source: 'anchor' | 'derived' | 'fallback'
}

export interface HudAlignment {
  profileKey: string
  groups: Record<HudGroup, GroupTransform>
  matches: AnchorMatch[]
}

// true matches 0.95-1.0, best false match 0.67 (buy_xp on the augment screen)
export const ANCHOR_MIN_SCORE = 0.85
const MIN_SCALE = 0.4
const MAX_SCALE = 1.6
const COARSE_SCALE_STEP = 0.04
const FINE_SCALE_STEP = 0.005
// Downscale so the template is roughly this wide during the coarse search
const COARSE_TEMPLATE_WIDTH = 28
// Never search small templates at full resolution in the coarse pass (cost grows with frame area)
const MIN_COARSE_FACTOR = 2
// Anchors searched after the primary one only look around its scale
const HINT_SCALE_RANGE = 0.08
const HINT_SCALE_STEP = 0.02
// Two bottom anchors must agree on the scale within this ratio to refine it from their distance
const BOTTOM_SCALE_AGREEMENT = 0.05
// HUD scales with client height (checked 720-1440 px and 16:10). Matching on the small labels is
// 2-4 % off, so anything within 5 % snaps to height/1440.
const HEIGHT_SCALE_SNAP = 0.05
// Secondary anchors must agree with the bottom group (same HUD scaling and horizontal centering)
const GROUP_SCALE_TOLERANCE = 0.1
const GROUP_OFFSET_TOLERANCE = 0.05

const [REFERENCE_WIDTH, REFERENCE_HEIGHT] = anchorsData.referenceProfile.split('x').map(Number)

// Search windows as fractions of the frame (x0, y0, x1, y1), generous for other aspect ratios
const SEARCH_WINDOWS: Record<string, [number, number, number, number]> = {
  buy_xp: [0, 0.6, 0.5, 1],
  reroll_label: [0, 0.6, 0.5, 1],
  stage_icon: [0.3, 0, 0.7, 0.08],
  choose_one: [0.15, 0.05, 0.85, 0.5],
}

function decodeGray(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}

export const ANCHORS: AnchorTemplate[] = Object.entries(anchorsData.anchors).map(([name, anchor]) => ({
  name,
  group: anchor.group as HudGroup,
  x: anchor.x,
  y: anchor.y,
  w: anchor.w,
  h: anchor.h,
  gray: decodeGray(anchor.gray),
}))

export const REFERENCE_ANCHOR_RECTS = Object.fromEntries(ANCHORS.map(anchor => [anchor.name, anchor])) as Record<string, AnchorTemplate>

interface Plane {
  values: Float32Array
  width: number
  height: number
}

function resample(source: Plane, rect: Rect, width: number, height: number): Plane {
  const values = new Float32Array(width * height)
  for (let ty = 0; ty < height; ty++) {
    const y0 = rect.y + (ty * rect.h) / height
    const y1 = rect.y + ((ty + 1) * rect.h) / height
    for (let tx = 0; tx < width; tx++) {
      const x0 = rect.x + (tx * rect.w) / width
      const x1 = rect.x + ((tx + 1) * rect.w) / width
      let sum = 0
      let count = 0
      for (let y = Math.floor(y0); y < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); y++) {
        for (let x = Math.floor(x0); x < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); x++) {
          if (x < 0 || y < 0 || x >= source.width || y >= source.height) continue
          sum += source.values[y * source.width + x]
          count++
        }
      }
      values[ty * width + tx] = count ? sum / count : 0
    }
  }
  return { values, width, height }
}

interface PreparedTemplate {
  values: Float32Array
  width: number
  height: number
  mean: number
  norm: number
}

function prepareTemplate(plane: Plane): PreparedTemplate | null {
  let sum = 0
  for (const value of plane.values) sum += value
  const mean = sum / plane.values.length
  let norm = 0
  const values = new Float32Array(plane.values.length)
  for (let index = 0; index < values.length; index++) {
    values[index] = plane.values[index] - mean
    norm += values[index] ** 2
  }
  return norm > 0 ? { values, width: plane.width, height: plane.height, mean, norm: Math.sqrt(norm) } : null
}

function correlationAt(frame: Plane, template: PreparedTemplate, left: number, top: number): number {
  let sum = 0
  let sumSquares = 0
  let cross = 0
  const count = template.width * template.height
  for (let y = 0; y < template.height; y++) {
    const rowOffset = (top + y) * frame.width + left
    const templateOffset = y * template.width
    for (let x = 0; x < template.width; x++) {
      const value = frame.values[rowOffset + x]
      sum += value
      sumSquares += value * value
      cross += value * template.values[templateOffset + x]
    }
  }
  const variance = sumSquares - (sum * sum) / count
  if (variance <= 1e-6) return 0
  // Template is zero-mean, so the frame mean drops out of the cross term
  return cross / (Math.sqrt(variance) * template.norm)
}

interface SearchResult {
  x: number
  y: number
  scale: number
  score: number
}

function searchPlane(
  frame: Plane,
  templatePlane: Plane,
  templateRect: Rect,
  factor: number,
  scales: number[],
  window: Rect,
): SearchResult {
  let best: SearchResult = { x: 0, y: 0, scale: 1, score: -1 }
  for (const scale of scales) {
    const width = Math.max(4, Math.round((templateRect.w * scale) / factor))
    const height = Math.max(4, Math.round((templateRect.h * scale) / factor))
    const template = prepareTemplate(resample(templatePlane, { x: 0, y: 0, w: templateRect.w, h: templateRect.h }, width, height))
    if (!template) continue

    const x0 = Math.max(0, Math.floor(window.x / factor))
    const y0 = Math.max(0, Math.floor(window.y / factor))
    const x1 = Math.min(frame.width - width, Math.ceil((window.x + window.w) / factor))
    const y1 = Math.min(frame.height - height, Math.ceil((window.y + window.h) / factor))
    for (let top = y0; top <= y1; top++) {
      for (let left = x0; left <= x1; left++) {
        const score = correlationAt(frame, template, left, top)
        if (score > best.score) best = { x: left * factor, y: top * factor, scale, score }
      }
    }
  }
  return best
}

function scaleRange(from: number, to: number, step: number): number[] {
  const scales: number[] = []
  for (let scale = from; scale <= to + 1e-9; scale += step) scales.push(Math.round(scale * 1000) / 1000)
  return scales
}

export function findAnchor(frameGray: GrayImage, anchor: AnchorTemplate, scaleHint: number | null = null): AnchorMatch {
  const frame: Plane = frameGray
  const templatePlane: Plane = { values: Float32Array.from(anchor.gray), width: anchor.w, height: anchor.h }
  const [fx0, fy0, fx1, fy1] = SEARCH_WINDOWS[anchor.name] ?? [0, 0, 1, 1]
  const window: Rect = {
    x: Math.round(fx0 * frame.width),
    y: Math.round(fy0 * frame.height),
    w: Math.round((fx1 - fx0) * frame.width),
    h: Math.round((fy1 - fy0) * frame.height),
  }

  const factor = Math.max(MIN_COARSE_FACTOR, Math.round(anchor.w / COARSE_TEMPLATE_WIDTH))
  const coarseFrame = resample(frame, { x: 0, y: 0, w: frame.width, h: frame.height }, Math.floor(frame.width / factor), Math.floor(frame.height / factor))
  const coarseScales = scaleHint === null
    ? scaleRange(MIN_SCALE, MAX_SCALE, COARSE_SCALE_STEP)
    : scaleRange(Math.max(MIN_SCALE, scaleHint - HINT_SCALE_RANGE), Math.min(MAX_SCALE, scaleHint + HINT_SCALE_RANGE), HINT_SCALE_STEP)
  const coarse = searchPlane(coarseFrame, templatePlane, anchor, factor, coarseScales, window)

  // refine at full res around the coarse hit
  const margin = factor * 3
  const fineWindow: Rect = { x: coarse.x - margin, y: coarse.y - margin, w: margin * 2, h: margin * 2 }
  const fine = searchPlane(
    frame,
    templatePlane,
    anchor,
    1,
    scaleRange(Math.max(MIN_SCALE, coarse.scale - COARSE_SCALE_STEP), Math.min(MAX_SCALE, coarse.scale + COARSE_SCALE_STEP), FINE_SCALE_STEP),
    fineWindow,
  )

  const result = fine.score >= coarse.score ? fine : coarse
  return { name: anchor.name, group: anchor.group, ...result }
}

// Correlation of an anchor at a known position and scale; used to re-check cached matches
export function verifyAnchor(frameGray: GrayImage, match: AnchorMatch): number {
  const anchor = REFERENCE_ANCHOR_RECTS[match.name]
  const width = Math.max(4, Math.round(anchor.w * match.scale))
  const height = Math.max(4, Math.round(anchor.h * match.scale))
  if (match.x < 0 || match.y < 0 || match.x + width > frameGray.width || match.y + height > frameGray.height) return 0
  const template = prepareTemplate(resample({ values: Float32Array.from(anchor.gray), width: anchor.w, height: anchor.h }, { x: 0, y: 0, w: anchor.w, h: anchor.h }, width, height))
  return template ? correlationAt(frameGray, template, Math.round(match.x), Math.round(match.y)) : 0
}

function transformFromMatch(match: AnchorMatch, scale: number): GroupTransform {
  const anchor = REFERENCE_ANCHOR_RECTS[match.name]
  return {
    scale,
    offsetX: match.x - anchor.x * scale,
    offsetY: match.y - anchor.y * scale,
    score: match.score,
    source: 'anchor',
  }
}

// Fallback for a group without a found anchor: uniform scale from the client height,
// horizontally centered, vertically pinned to the group's edge of the client area
function fallbackTransform(group: HudGroup, client: Rect, scale: number, source: GroupTransform['source']): GroupTransform {
  const offsetX = client.x + (client.w - REFERENCE_WIDTH * scale) / 2
  const offsetY = group === 'bottom'
    ? client.y + client.h - REFERENCE_HEIGHT * scale
    : group === 'top'
      ? client.y
      : client.y + (client.h - REFERENCE_HEIGHT * scale) / 2
  return { scale, offsetX, offsetY, score: 0, source }
}

export function buildAlignment(profileKey: string, client: Rect, matches: AnchorMatch[], previous?: HudAlignment | null): HudAlignment {
  const found = (name: string) => matches.find(match => match.name === name && match.score >= ANCHOR_MIN_SCORE) ?? null
  const width = client.w
  // The HUD scales with the client height, not with the captured window frame
  const fallbackScale = client.h / REFERENCE_HEIGHT
  const snap = (scale: number) => (Math.abs(scale / fallbackScale - 1) <= HEIGHT_SCALE_SNAP ? fallbackScale : scale)

  let bottom: GroupTransform
  const buyXp = found('buy_xp')
  if (buyXp) {
    let scale = buyXp.scale
    const rerollLabel = found('reroll_label')
    if (rerollLabel) {
      const distanceScale = (rerollLabel.y - buyXp.y) / (REFERENCE_ANCHOR_RECTS.reroll_label.y - REFERENCE_ANCHOR_RECTS.buy_xp.y)
      if (Math.abs(distanceScale / scale - 1) <= BOTTOM_SCALE_AGREEMENT) scale = distanceScale
    }
    bottom = transformFromMatch(buyXp, snap(scale))
  } else {
    bottom = previous?.groups.bottom.source === 'anchor' ? previous.groups.bottom : fallbackTransform('bottom', client, fallbackScale, 'fallback')
  }

  // The stage icon is too small for a precise scale; it only pins the position
  // Reject secondary matches that contradict an anchored bottom group (e.g. a match on a
  // transitional frame right after a resolution change)
  const agreesWithBottom = (match: AnchorMatch | null, scale: number): AnchorMatch | null => {
    if (!match || bottom.source !== 'anchor') return match
    const offsetX = match.x - REFERENCE_ANCHOR_RECTS[match.name].x * scale
    const scaleAgrees = Math.abs(match.scale - bottom.scale) <= GROUP_SCALE_TOLERANCE
    const offsetAgrees = Math.abs(offsetX - bottom.offsetX) <= GROUP_OFFSET_TOLERANCE * width
    return scaleAgrees && offsetAgrees ? match : null
  }

  const transformAgreesWithBottom = (transform: GroupTransform): boolean => (
    bottom.source !== 'anchor'
    || (Math.abs(transform.scale - bottom.scale) <= GROUP_SCALE_TOLERANCE
      && Math.abs(transform.offsetX - bottom.offsetX) <= GROUP_OFFSET_TOLERANCE * width)
  )

  const stageIcon = agreesWithBottom(found('stage_icon'), bottom.scale)
  const top = stageIcon
    ? transformFromMatch(stageIcon, bottom.source === 'anchor' ? bottom.scale : snap(stageIcon.scale))
    : previous?.groups.top.source === 'anchor' && transformAgreesWithBottom(previous.groups.top)
      ? previous.groups.top
      : fallbackTransform('top', client, bottom.scale, 'fallback')

  const chooseOneMatch = found('choose_one')
  const chooseOne = agreesWithBottom(chooseOneMatch, chooseOneMatch ? snap(chooseOneMatch.scale) : bottom.scale)
  const augment = chooseOne
    ? transformFromMatch(chooseOne, snap(chooseOne.scale))
    : previous?.groups.augment.source === 'anchor' && transformAgreesWithBottom(previous.groups.augment)
      ? previous.groups.augment
      : fallbackTransform('augment', client, bottom.scale, 'derived')

  return { profileKey, groups: { bottom, top, augment }, matches }
}

export function mapRect(rect: Rect, transform: GroupTransform): Rect {
  return {
    x: Math.round(transform.offsetX + rect.x * transform.scale),
    y: Math.round(transform.offsetY + rect.y * transform.scale),
    w: Math.max(1, Math.round(rect.w * transform.scale)),
    h: Math.max(1, Math.round(rect.h * transform.scale)),
  }
}

export function isReferenceProfile(profileKey: string): boolean {
  return profileKey === anchorsData.referenceProfile
}
