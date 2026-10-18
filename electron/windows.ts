// Electron counterpart of the window declarations in public/manifest.json.

export type WindowKind = 'background' | 'ingame' | 'desktop'

export interface WindowDef {
  file: string
  kind: WindowKind
  width: number
  height: number
  // Initial game-relative position for in-game windows the background never positions
  defaultX?: number
  defaultY?: number
  clickThrough?: boolean
  minWidth?: number
  minHeight?: number
}

const BLOCKER_WINDOW_NAMES = [
  'shop_slot_4_blocker',
  'shop_slot_5_blocker',
  'reroll_button_blocker',
  'xp_button_blocker',
  'augment_slot_left_blocker',
  'augment_slot_right_blocker',
  'augment_reroll_1_blocker',
  'augment_reroll_2_blocker',
  'augment_reroll_3_blocker',
]

export const WINDOW_DEFS: Record<string, WindowDef> = {
  background: { file: 'background.html', kind: 'background', width: 0, height: 0 },
  // Hidden screen-reading window (Electron only)
  vision: { file: 'vision.html', kind: 'background', width: 0, height: 0 },
  overlay: { file: 'overlay.html', kind: 'ingame', width: 1920, height: 1080, clickThrough: true },
  // Widget windows fit their own size to the content and restore a saved layout
  overlay_controls: { file: 'overlay.html', kind: 'ingame', width: 360, height: 190, defaultX: 24, defaultY: 24 },
  overlay_pinned: { file: 'overlay.html', kind: 'ingame', width: 340, height: 160, defaultX: 24, defaultY: 300 },
  desktop: { file: 'desktop.html', kind: 'desktop', width: 1200, height: 800, minWidth: 920, minHeight: 640 },
  ...Object.fromEntries(
    BLOCKER_WINDOW_NAMES.map(name => [name, { file: 'shop-blocker.html', kind: 'ingame', width: 88, height: 86 } satisfies WindowDef]),
  ),
}
