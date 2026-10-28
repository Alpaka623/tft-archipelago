import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import { IconLock } from '@tabler/icons-react'
import { BACKGROUND_WINDOW_ID, platform, type PlatformWindowInfo } from '../platform'
import './shop-blocker.css'

const DEFAULT_MIN_BLOCKER_SIZE = 8
const TINY_MIN_BLOCKER_SIZE = 4
const NATIVE_MIN_WINDOW_SIZE = 1

interface Rect { x: number; y: number; w: number; h: number }

const BLOCKER_LABELS: Record<string, string> = {
  shop_slot_4_blocker:        'Shop slot 4',
  shop_slot_5_blocker:        'Shop slot 5',
  reroll_button_blocker:      'Reroll',
  xp_button_blocker:          'Buy XP',
  augment_slot_left_blocker:  'Augment slot left',
  augment_slot_right_blocker: 'Augment slot right',
  augment_reroll_1_blocker:   'Reroll 1',
  augment_reroll_2_blocker:   'Reroll 2',
  augment_reroll_3_blocker:   'Reroll 3',
}

const INLINE_BLOCKERS = new Set(['reroll_button_blocker', 'xp_button_blocker'])
const AUGMENT_SLOT_BLOCKERS = new Set(['augment_slot_left_blocker', 'augment_slot_right_blocker'])

function getIconSize(name: string): number {
  if (AUGMENT_SLOT_BLOCKERS.has(name)) return 24
  if (name.startsWith('shop_slot_')) return 20
  return 15
}

function getLabelFromWindowName(name: string): string {
  return BLOCKER_LABELS[name] ?? name
}

function toRect(info: PlatformWindowInfo): Rect {
  return { x: info.left, y: info.top, w: info.width, h: info.height }
}

function consumeEvent(event: React.SyntheticEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

function ShopBlocker() {
  const [windowName, setWindowName] = React.useState('')
  const [windowId, setWindowId] = React.useState<string | null>(null)
  const [calibrationMode, setCalibrationMode] = React.useState(false)
  const [rect, setRect] = React.useState<Rect | null>(null)
  const [freeAugmentPicks, setFreeAugmentPicks] = React.useState(0)

  // Drags follow the cursor's screen position relative to where the drag started. Summing
  // movementX/Y drifts, because the window moves under the cursor while it is dragged.
  const isDraggingRef = React.useRef(false)
  const dragStartRef = React.useRef({ screenX: 0, screenY: 0, x: 0, y: 0 })
  const isResizingRef = React.useRef(false)
  const resizeStartRef = React.useRef({ screenX: 0, screenY: 0, w: 0, h: 0 })
  const isTinyBlocker = windowName.startsWith('augment_reroll_')
  const offersFreeAugmentPick = !calibrationMode && freeAugmentPicks > 0
    && AUGMENT_SLOT_BLOCKERS.has(windowName)
  const isCompactCalibration = calibrationMode && rect !== null && (rect.w < 48 || rect.h < 36)
  const minBlockerSize = isTinyBlocker ? TINY_MIN_BLOCKER_SIZE : DEFAULT_MIN_BLOCKER_SIZE

  React.useEffect(() => {
    if (!platform) return

    void platform.getCurrentWindow().then((currentWindow) => {
      if (!currentWindow) return
      setWindowName(currentWindow.name)
      setWindowId(currentWindow.id)
      void platform?.setWindowMinSize(currentWindow.id, NATIVE_MIN_WINDOW_SIZE, NATIVE_MIN_WINDOW_SIZE)
      setRect(toRect(currentWindow))
    })

    return platform.onMessage((event) => {
      const msg = event as { id: string; content: Record<string, unknown> }
      if (msg.id === 'BLOCKER_OFFER_UPDATE') {
        setFreeAugmentPicks(Number(msg.content['freeAugmentPicks']) || 0)
        return
      }
      if (msg.id !== 'BLOCKER_CALIBRATION_MODE_UPDATE') return

      const enabled = msg.content['enabled'] === true
      setCalibrationMode(enabled)
      if (enabled) {
        void platform?.getCurrentWindow().then((currentWindow) => {
          if (currentWindow) setRect(toRect(currentWindow))
        })
      }
    })
  }, [])

  const reportMoved = React.useCallback(() => {
    void platform?.getCurrentWindow().then((currentWindow) => {
      if (!currentWindow) return
      const nextRect = toRect(currentWindow)
      setRect(nextRect)
      platform?.sendMessage(BACKGROUND_WINDOW_ID, 'BLOCKER_MOVED', { blockerId: currentWindow.name, ...nextRect })
    })
  }, [])

  const handleDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!calibrationMode || !windowId) {
      consumeEvent(e)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    dragStartRef.current = { screenX: e.screenX, screenY: e.screenY, x: rect?.x ?? 0, y: rect?.y ?? 0 }
  }

  const handleDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !windowId) return
    const scale = platform?.pointerToWindowScale() ?? 1
    const start = dragStartRef.current
    const x = Math.round(start.x + (e.screenX - start.screenX) * scale)
    const y = Math.round(start.y + (e.screenY - start.screenY) * scale)
    platform?.changeWindowPosition(windowId, x, y)
  }

  const handleDragPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !windowId) return
    isDraggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    reportMoved()
  }

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!calibrationMode || !windowId) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    isResizingRef.current = true
    const scale = platform?.pointerToWindowScale() ?? 1
    resizeStartRef.current = {
      screenX: e.screenX,
      screenY: e.screenY,
      w: rect?.w ?? window.innerWidth * scale,
      h: rect?.h ?? window.innerHeight * scale,
    }
  }

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current || !windowId) return
    e.stopPropagation()
    const scale = platform?.pointerToWindowScale() ?? 1
    const start = resizeStartRef.current
    const w = Math.max(minBlockerSize, Math.round(start.w + (e.screenX - start.screenX) * scale))
    const h = Math.max(minBlockerSize, Math.round(start.h + (e.screenY - start.screenY) * scale))
    platform?.changeWindowSize(windowId, w, h)
  }

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current || !windowId) return
    isResizingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    reportMoved()
  }

  return (
    <div
      className={[
        'shop-blocker',
        calibrationMode ? 'shop-blocker--calibration' : '',
        isTinyBlocker ? 'shop-blocker--tiny' : '',
        INLINE_BLOCKERS.has(windowName) ? 'shop-blocker--inline' : '',
        isCompactCalibration ? 'shop-blocker--compact-calibration' : '',
      ].filter(Boolean).join(' ')}
      onPointerDown={handleDragPointerDown}
      onPointerMove={handleDragPointerMove}
      onPointerUp={handleDragPointerUp}
      onMouseDown={calibrationMode ? undefined : consumeEvent}
      onMouseUp={calibrationMode ? undefined : consumeEvent}
      onClick={consumeEvent}
      onDoubleClick={consumeEvent}
      onContextMenu={consumeEvent}
      role="presentation"
    >
      <div className="shop-blocker__label">
        <IconLock className="shop-blocker__icon" size={getIconSize(windowName)} stroke={1.75} aria-hidden="true" />
        <span className="shop-blocker__text">{getLabelFromWindowName(windowName)}</span>
        {calibrationMode && rect && (
          <div className="shop-blocker__coords">
            {rect.x}, {rect.y} · {rect.w}×{rect.h}
          </div>
        )}
        {offersFreeAugmentPick && (
          <button
            type="button"
            className="shop-blocker__offer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              consumeEvent(e)
              setFreeAugmentPicks(0)
              platform?.sendMessage(BACKGROUND_WINDOW_ID, 'USE_FREE_AUGMENT_PICK', {})
            }}
          >
            Use free augment pick
            <span className="shop-blocker__offer-count">{freeAugmentPicks} left</span>
          </button>
        )}
      </div>
      {calibrationMode && (
        <div
          className="shop-blocker__resize-handle"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onClick={consumeEvent}
          onContextMenu={consumeEvent}
        />
      )}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<ShopBlocker />)
