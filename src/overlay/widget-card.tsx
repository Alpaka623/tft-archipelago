// Blitz-style in-game widget: a dark card that turns opaque on hover and shows
// a drag grip on the left and a scale grip in the bottom-right corner. The window always
// fits the scaled card, so no transparent area around it swallows clicks meant for TFT.
import React from 'react'
import type { PlatformRect, WindowDragMode } from '../platform/types'
import { platform } from '../platform'
import {
  clampWidgetScale,
  loadWidgetLayout,
  MAX_WIDGET_SCALE,
  MIN_WIDGET_SCALE,
  saveWidgetLayout,
} from './widget-layout'

interface WidgetCardProps {
  windowId: string
  windowName: string
  children: React.ReactNode
}

interface ContentSize {
  width: number
  height: number
}

// Keeps a restored widget grabbable when the saved position lies outside a smaller game resolution
const MIN_VISIBLE_WIDGET_PX = 48

function getWindowPixelRatio(): number {
  return platform?.pointerToWindowScale() ?? 1
}

function getScaleFromRect(rect: PlatformRect, contentSize: ContentSize): number {
  const ratio = getWindowPixelRatio()
  return clampWidgetScale(Math.max(
    rect.w / (contentSize.width * ratio),
    rect.h / (contentSize.height * ratio),
  ))
}

function restoreWidgetLayout(windowId: string, windowName: string, onScale: (scale: number) => void): void {
  void Promise.all([loadWidgetLayout(windowName), platform?.getRunningGame()]).then(([layout, gameState]) => {
    if (!layout || !platform) return

    let { x, y } = layout
    if (gameState?.isRunning && gameState.width > 0 && gameState.height > 0) {
      x = Math.min(Math.max(0, x), gameState.width - MIN_VISIBLE_WIDGET_PX)
      y = Math.min(Math.max(0, y), gameState.height - MIN_VISIBLE_WIDGET_PX)
    }
    platform.changeWindowPosition(windowId, x, y)
    onScale(clampWidgetScale(layout.scale))
  })
}

function GripDots() {
  return <span className="widget-grip-dots" />
}

function ScaleGripIcon() {
  return (
    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
      <path d="M9 3 3 9M9 6 6 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function WidgetCard({ windowId, windowName, children }: WidgetCardProps) {
  const [scale, setScale] = React.useState(1)
  const [contentSize, setContentSize] = React.useState<ContentSize>({ width: 0, height: 0 })
  const [dragMode, setDragMode] = React.useState<WindowDragMode | null>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const scaleRef = React.useRef(scale)
  scaleRef.current = scale

  React.useEffect(() => {
    restoreWidgetLayout(windowId, windowName, setScale)
  }, [windowId, windowName])

  // offsetWidth/offsetHeight ignore the CSS transform, so this is the unscaled card size
  React.useEffect(() => {
    const element = contentRef.current
    if (!element) return undefined

    const measure = () => setContentSize({ width: element.offsetWidth, height: element.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Fit the window to the scaled card; during a scale drag the drag loop owns the size
  React.useEffect(() => {
    if (!platform || dragMode === 'scale' || contentSize.width === 0 || contentSize.height === 0) return
    const ratio = getWindowPixelRatio()
    platform.changeWindowSize(
      windowId,
      Math.ceil((contentSize.width * scale + 1) * ratio),
      Math.ceil((contentSize.height * scale + 1) * ratio),
    )
  }, [windowId, contentSize, scale, dragMode])

  // Electron resizes the window live during a scale drag; follow it so the content grows along
  React.useEffect(() => {
    if (dragMode !== 'scale' || contentSize.width === 0) return undefined
    const handleResize = () => setScale(clampWidgetScale(window.innerWidth / contentSize.width))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [dragMode, contentSize.width])

  const startDrag = (mode: WindowDragMode) => (event: React.PointerEvent) => {
    if (event.button !== 0 || !platform || dragMode || contentSize.width === 0) return
    event.preventDefault()
    event.stopPropagation()

    const ratio = getWindowPixelRatio()
    const limits = {
      minWidth: Math.ceil(contentSize.width * MIN_WIDGET_SCALE * ratio),
      maxWidth: Math.floor(contentSize.width * MAX_WIDGET_SCALE * ratio),
    }
    const sizeAtStart = contentSize
    setDragMode(mode)
    void platform.dragWindow(windowId, mode, limits).then((rect) => {
      setDragMode(null)
      if (!rect) return
      const nextScale = mode === 'scale' ? getScaleFromRect(rect, sizeAtStart) : scaleRef.current
      setScale(nextScale)
      void saveWidgetLayout(windowName, { x: rect.x, y: rect.y, scale: nextScale })
    })
  }

  const isActive = dragMode !== null

  return (
    <div className="absolute left-0 top-0" style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
      <div ref={contentRef} className="widget-card" data-active={isActive}>
        <div
          className="widget-grip"
          data-active={dragMode === 'move'}
          title="Drag to move"
          onPointerDown={startDrag('move')}
        >
          <GripDots />
        </div>
        {children}
        <div
          className="widget-scale-grip"
          data-active={dragMode === 'scale'}
          title="Drag to resize"
          onPointerDown={startDrag('scale')}
        >
          <ScaleGripIcon />
        </div>
      </div>
    </div>
  )
}
