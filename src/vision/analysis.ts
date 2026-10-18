// Pure image analysis helpers for the vision pipeline. No DOM access here.

export interface PixelData {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface GrayImage {
  values: Float32Array
  width: number
  height: number
}

export interface LuminanceStats {
  mean: number
  stdDev: number
}

// Binary glyph normalized to a fixed grid, row-major, 1 = foreground
export type GlyphGrid = number[]

export const GLYPH_GRID_WIDTH = 10
export const GLYPH_GRID_HEIGHT = 14

const MIN_GLYPH_WIDTH = 2
const MIN_GLYPH_HEIGHT_RATIO = 0.4
const DIGIT_MATCH_MIN_SCORE = 0.8

export function toGray(pixels: PixelData): GrayImage {
  const values = new Float32Array(pixels.width * pixels.height)
  for (let index = 0; index < values.length; index++) {
    const offset = index * 4
    values[index] = 0.299 * pixels.data[offset] + 0.587 * pixels.data[offset + 1] + 0.114 * pixels.data[offset + 2]
  }
  return { values, width: pixels.width, height: pixels.height }
}

// Minimum of R/G/B: high only for white or cream text, low for saturated colors such
// as the gold coin icon (measured: digits ~210, coin ~110, HUD background <= 79)
export function toWhiteness(pixels: PixelData): GrayImage {
  const values = new Float32Array(pixels.width * pixels.height)
  for (let index = 0; index < values.length; index++) {
    const offset = index * 4
    values[index] = Math.min(pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2])
  }
  return { values, width: pixels.width, height: pixels.height }
}

export function luminanceStats(gray: GrayImage): LuminanceStats {
  let sum = 0
  for (const value of gray.values) sum += value
  const mean = sum / Math.max(1, gray.values.length)

  let variance = 0
  for (const value of gray.values) variance += (value - mean) ** 2
  return { mean, stdDev: Math.sqrt(variance / Math.max(1, gray.values.length)) }
}

// Area-average downscale, robust against single-pixel noise
function downscale(gray: GrayImage, targetWidth: number, targetHeight: number): Float32Array {
  const result = new Float32Array(targetWidth * targetHeight)
  for (let ty = 0; ty < targetHeight; ty++) {
    const y0 = Math.floor((ty * gray.height) / targetHeight)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * gray.height) / targetHeight))
    for (let tx = 0; tx < targetWidth; tx++) {
      const x0 = Math.floor((tx * gray.width) / targetWidth)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * gray.width) / targetWidth))
      let sum = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) sum += gray.values[y * gray.width + x]
      }
      result[ty * targetWidth + tx] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return result
}

// 64-bit difference hash as 16 hex characters: similar images give similar hashes
export function differenceHash(gray: GrayImage): string {
  const small = downscale(gray, 9, 8)
  let hex = ''
  for (let row = 0; row < 8; row++) {
    let byte = 0
    for (let column = 0; column < 8; column++) {
      byte = (byte << 1) | (small[row * 9 + column] > small[row * 9 + column + 1] ? 1 : 0)
    }
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

export function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) return 64
  let distance = 0
  for (let index = 0; index < left.length; index += 2) {
    let diff = parseInt(left.slice(index, index + 2), 16) ^ parseInt(right.slice(index, index + 2), 16)
    while (diff) {
      distance += diff & 1
      diff >>= 1
    }
  }
  return distance
}

interface GlyphBounds {
  x0: number
  x1: number
  y0: number
  y1: number
}

// Light text on a dark HUD background: threshold halfway between mean and max
function binarize(gray: GrayImage, minThreshold: number): Uint8Array {
  let max = 0
  let sum = 0
  for (const value of gray.values) {
    sum += value
    if (value > max) max = value
  }
  const mean = sum / Math.max(1, gray.values.length)
  const threshold = Math.max(minThreshold, mean + (max - mean) * 0.5)
  return Uint8Array.from(gray.values, value => (value >= threshold ? 1 : 0))
}

function findGlyphBounds(mask: Uint8Array, width: number, height: number): GlyphBounds[] {
  const columnHasInk = Array.from({ length: width }, (_, x) => {
    for (let y = 0; y < height; y++) if (mask[y * width + x]) return true
    return false
  })

  const glyphs: GlyphBounds[] = []
  for (let x = 0; x < width; x++) {
    if (!columnHasInk[x]) continue
    const x0 = x
    while (x < width && columnHasInk[x]) x++
    const x1 = x - 1

    let y0 = height
    let y1 = -1
    for (let y = 0; y < height; y++) {
      for (let column = x0; column <= x1; column++) {
        if (mask[y * width + column]) {
          y0 = Math.min(y0, y)
          y1 = Math.max(y1, y)
        }
      }
    }
    if (x1 - x0 + 1 >= MIN_GLYPH_WIDTH && y1 >= y0) glyphs.push({ x0, x1, y0, y1 })
  }

  // Drop specks: real digits share roughly the height of the tallest glyph
  const tallest = Math.max(0, ...glyphs.map(glyph => glyph.y1 - glyph.y0 + 1))
  return glyphs.filter(glyph => glyph.y1 - glyph.y0 + 1 >= tallest * MIN_GLYPH_HEIGHT_RATIO)
}

function toGrid(mask: Uint8Array, width: number, bounds: GlyphBounds): GlyphGrid {
  const glyphWidth = bounds.x1 - bounds.x0 + 1
  const glyphHeight = bounds.y1 - bounds.y0 + 1
  const grid: GlyphGrid = []
  for (let gy = 0; gy < GLYPH_GRID_HEIGHT; gy++) {
    for (let gx = 0; gx < GLYPH_GRID_WIDTH; gx++) {
      const x = bounds.x0 + Math.min(glyphWidth - 1, Math.floor(((gx + 0.5) * glyphWidth) / GLYPH_GRID_WIDTH))
      const y = bounds.y0 + Math.min(glyphHeight - 1, Math.floor(((gy + 0.5) * glyphHeight) / GLYPH_GRID_HEIGHT))
      grid.push(mask[y * width + x])
    }
  }
  return grid
}

export function extractGlyphs(gray: GrayImage, minThreshold = 110): GlyphGrid[] {
  const mask = binarize(gray, minThreshold)
  return findGlyphBounds(mask, gray.width, gray.height).map(bounds => toGrid(mask, gray.width, bounds))
}

// Glyphs grouped into words: a gap wider than the ratio of the tallest glyph starts a new word.
// "Lvl. 3" → ["Lvl", "3"] (the dot is dropped as a speck), "5-1" → ["5", "1"] (the dash too).
export function extractGlyphWords(gray: GrayImage, minThreshold = 110, minGapRatio = 0.35): GlyphGrid[][] {
  const mask = binarize(gray, minThreshold)
  const bounds = findGlyphBounds(mask, gray.width, gray.height)
  const tallest = Math.max(0, ...bounds.map(glyph => glyph.y1 - glyph.y0 + 1))
  const words: GlyphGrid[][] = []
  let previous: GlyphBounds | null = null
  for (const glyph of bounds) {
    if (!previous || glyph.x0 - previous.x1 - 1 > tallest * minGapRatio) words.push([])
    words[words.length - 1].push(toGrid(mask, gray.width, glyph))
    previous = glyph
  }
  return words
}

function gridSimilarity(left: GlyphGrid, right: GlyphGrid): number {
  let equal = 0
  for (let index = 0; index < left.length; index++) if (left[index] === right[index]) equal++
  return equal / left.length
}

// Taught glyph templates keyed by character (digits, '/')
export type DigitTemplates = Record<string, GlyphGrid[]>

// Returns the recognized text, or null when any glyph has no confident match
export function recognizeText(glyphs: GlyphGrid[], templates: DigitTemplates): string | null {
  if (glyphs.length === 0) return null

  let digits = ''
  for (const glyph of glyphs) {
    let bestDigit: string | null = null
    let bestScore = 0
    for (const [digit, samples] of Object.entries(templates)) {
      for (const sample of samples) {
        const score = gridSimilarity(glyph, sample)
        if (score > bestScore) {
          bestScore = score
          bestDigit = digit
        }
      }
    }
    if (!bestDigit || bestScore < DIGIT_MATCH_MIN_SCORE) return null
    digits += bestDigit
  }
  return digits
}
