import { describe, expect, it } from 'vitest'
import { extractGlyphs, type GrayImage } from './analysis'

// Rows of '#' (text) and '.' (background) as a whiteness image
function imageOf(rows: string[]): GrayImage {
  const width = rows[0].length
  const values = new Float32Array(width * rows.length)
  rows.forEach((row, y) => [...row].forEach((pixel, x) => { values[y * width + x] = pixel === '#' ? 200 : 20 }))
  return { values, width, height: rows.length }
}

// "2/10" as drawn at 1920x1080: the "1" is a single pixel column
const XP_2_OF_10 = [
  '..........................',
  '.###.......#..#...###.....',
  '#...#......#..#..#...#....',
  '....#.....#...#..#...#....',
  '...#......#...#..#...#....',
  '..#......#....#..#...#....',
  '.#.......#....#..#...#....',
  '#####...#.....#...###.....',
  '..........................',
]

describe('extractGlyphs', () => {
  it('keeps a full-height glyph that is only one pixel wide', () => {
    expect(extractGlyphs(imageOf(XP_2_OF_10), 110)).toHaveLength(4)
  })

  it('drops a short one-pixel speck that a wider glyph of the same height would keep', () => {
    const rows = [
      '..........',
      '.###......',
      '#...#.....',
      '#...#..#..',
      '#...#..#..',
      '#...#..#..',
      '.###......',
      '..........',
    ]
    expect(extractGlyphs(imageOf(rows), 110)).toHaveLength(1)
    // The same mark two pixels wide stays a glyph, as before
    expect(extractGlyphs(imageOf(rows.map(row => row.slice(0, 7) + row[7] + row.slice(7, 9))), 110)).toHaveLength(2)
  })

  it('finds no glyphs in a region with only single-pixel specks', () => {
    expect(extractGlyphs(imageOf(['....#....', '.........', '.#.....#.']), 110)).toEqual([])
  })
})
