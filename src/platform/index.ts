import { createElectronPlatform } from './electron'
import { createOverwolfPlatform } from './overwolf'
import type { Platform } from './types'

export * from './types'

function detectPlatform(): Platform | null {
  if (typeof window !== 'undefined' && window.tftPlatform) {
    return createElectronPlatform(window.tftPlatform)
  }
  if (typeof overwolf !== 'undefined') {
    return createOverwolfPlatform()
  }
  return null
}

// null when a page is opened in a plain browser (e.g. `vite` dev server preview)
export const platform: Platform | null = detectPlatform()

if (typeof document !== 'undefined' && platform) {
  document.documentElement.dataset.platform = platform.kind
}
