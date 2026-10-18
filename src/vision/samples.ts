// Frame previews for the desktop debug tab and frame samples saved to Documents
import type { Platform } from '../platform'
import type { VisionRect } from '../types/vision'
import type { RegionAnalysis } from './readings'

const FRAME_PREVIEW_WIDTH = 640
const REGION_PREVIEW_MAX_WIDTH = 160

export function regionPreviewDataUrl(frame: OffscreenCanvas, rect: VisionRect): string {
  const scale = Math.min(1, REGION_PREVIEW_MAX_WIDTH / rect.w)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.w * scale))
  canvas.height = Math.max(1, Math.round(rect.h * scale))
  canvas.getContext('2d')!.drawImage(frame, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

// Downscaled frame with every region outlined
export function framePreviewDataUrl(frame: OffscreenCanvas, analyses: RegionAnalysis[]): string {
  const scale = FRAME_PREVIEW_WIDTH / frame.width
  const canvas = document.createElement('canvas')
  canvas.width = FRAME_PREVIEW_WIDTH
  canvas.height = Math.round(frame.height * scale)
  const context = canvas.getContext('2d')!
  context.drawImage(frame, 0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#22d3ee'
  context.lineWidth = 1
  for (const analysis of analyses) {
    const { x, y, w, h } = analysis.rect
    context.strokeRect(x * scale + 0.5, y * scale + 0.5, w * scale, h * scale)
  }
  return canvas.toDataURL('image/jpeg', 0.7)
}

async function canvasToBase64Png(canvas: OffscreenCanvas): Promise<string> {
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

// Full frame, every region crop and the current readings (info.json)
export async function writeFrameSamples(
  platform: Platform,
  folder: string,
  frame: OffscreenCanvas,
  analyses: RegionAnalysis[],
  info: Record<string, unknown>,
): Promise<boolean> {
  const writes: Promise<boolean>[] = [
    platform.writeDocumentsFile(`${folder}/frame.png`, await canvasToBase64Png(frame), 'base64'),
  ]

  for (const analysis of analyses) {
    const { x, y, w, h } = analysis.rect
    const crop = new OffscreenCanvas(w, h)
    crop.getContext('2d')!.drawImage(frame, x, y, w, h, 0, 0, w, h)
    writes.push(platform.writeDocumentsFile(`${folder}/${analysis.name}.png`, await canvasToBase64Png(crop), 'base64'))
  }

  const regions = analyses.map(({ name, rect, fingerprint, luminance, contrast }) => ({
    name, rect, fingerprint, luminance: Math.round(luminance), contrast: Math.round(contrast),
  }))
  writes.push(platform.writeDocumentsFile(`${folder}/info.json`, `${JSON.stringify({ ...info, regions }, null, 2)}\n`))

  return (await Promise.all(writes)).every(Boolean)
}
