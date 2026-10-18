// Saved position and scale of the draggable in-game widgets.
// Positions are game-client pixels, like every other in-game window rect.
import { platform } from '../platform'

export interface WidgetLayout {
  x: number
  y: number
  scale: number
}

interface WidgetLayoutFile {
  version: 1
  widgets: Record<string, WidgetLayout>
}

const WIDGET_LAYOUT_PATH = 'TFTArchipelago/overlay-layout.json'

export const MIN_WIDGET_SCALE = 0.75
export const MAX_WIDGET_SCALE = 2

export function clampWidgetScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_WIDGET_SCALE), MAX_WIDGET_SCALE)
}

function isWidgetLayout(value: unknown): value is WidgetLayout {
  if (!value || typeof value !== 'object') return false
  const { x, y, scale } = value as Record<string, unknown>
  return [x, y, scale].every(field => typeof field === 'number' && Number.isFinite(field))
}

async function readLayoutFile(): Promise<WidgetLayoutFile> {
  const empty: WidgetLayoutFile = { version: 1, widgets: {} }
  const text = await platform?.readDocumentsFile(WIDGET_LAYOUT_PATH)
  if (!text) return empty

  try {
    const parsed = JSON.parse(text) as Partial<WidgetLayoutFile>
    const widgets = Object.fromEntries(
      Object.entries(parsed.widgets ?? {}).filter(([, layout]) => isWidgetLayout(layout)),
    )
    return { version: 1, widgets }
  } catch {
    console.warn('Ignoring unreadable overlay layout file')
    return empty
  }
}

export async function loadWidgetLayout(widgetName: string): Promise<WidgetLayout | null> {
  const file = await readLayoutFile()
  return file.widgets[widgetName] ?? null
}

// Read-modify-write: each widget window only touches its own entry
export async function saveWidgetLayout(widgetName: string, layout: WidgetLayout): Promise<void> {
  if (!platform) return
  const file = await readLayoutFile()
  file.widgets[widgetName] = {
    x: Math.round(layout.x),
    y: Math.round(layout.y),
    scale: Math.round(clampWidgetScale(layout.scale) * 100) / 100,
  }
  const saved = await platform.writeDocumentsFile(WIDGET_LAYOUT_PATH, JSON.stringify(file, null, 2))
  if (!saved) console.warn(`Failed to save overlay layout for ${widgetName}`)
}
