// In-game overlay. The same page runs in three windows: the full-screen overlay (penalty banner,
// toasts), the controls widget and the pinned checks widget.
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import { BACKGROUND_WINDOW_ID, platform } from '../platform'
import { DEFAULT_APP_STATE } from '../shared/app-state'
import type { AppState, WindowMessage } from '../types/state'
import { PenaltyBanner, PinnedQuestLog } from './panels'
import { StatusWidget, type SaveStatus } from './status-widget'
import { ToastStack, useToasts } from './toasts'
import { WidgetCard } from './widget-card'
import './overlay.css'

const OVERLAY_CONTROLS_WINDOW_NAME = 'overlay_controls'
const OVERLAY_PINNED_WINDOW_NAME = 'overlay_pinned'

function sendToBackground(id: string, content: Record<string, unknown> = {}): void {
  platform?.sendMessage(BACKGROUND_WINDOW_ID, id, content)
}

function Overlay() {
  const [state, setState] = React.useState<AppState>(DEFAULT_APP_STATE)
  const [windowName, setWindowName] = React.useState('')
  const [windowId, setWindowId] = React.useState('')
  const [calibrationMode, setCalibrationMode] = React.useState(false)
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>('idle')
  const { toasts, addToast } = useToasts()

  React.useEffect(() => () => {
    sendToBackground('SET_BLOCKER_CALIBRATION_MODE', { enabled: false })
  }, [])

  React.useEffect(() => {
    if (!platform) return undefined

    void platform.getCurrentWindow().then((currentWindow) => {
      if (!currentWindow) {
        console.warn('Overlay failed to resolve current window')
        return
      }
      sendToBackground('WINDOW_MOUNTED', { windowId: currentWindow.id })
      setWindowName(currentWindow.name)
      setWindowId(currentWindow.id)
    })

    return platform.onMessage((event) => {
      const message = event as WindowMessage

      switch (message.id) {
        case 'STATE_UPDATE':
          setState(message.content)
          break
        case 'BLOCKER_CALIBRATION_MODE_UPDATE':
          setCalibrationMode(message.content.enabled)
          break
        case 'BLOCKER_CONFIG_SAVE_RESULT':
          if (!message.content.success) setSaveStatus('error')
          else setSaveStatus(message.content.isReset ? 'reset' : 'saved')
          break
        case 'AP_ITEM_RECEIVED':
          addToast({ kind: 'item', ...message.content })
          break
        case 'AP_CHECK_NOTIFICATION':
          addToast({ kind: 'check', ...message.content })
          break
      }
    })
  }, [addToast])

  const handleToggleCalibration = () => {
    setCalibrationMode((isEnabled) => {
      const nextEnabled = !isEnabled
      sendToBackground('SET_BLOCKER_CALIBRATION_MODE', { enabled: nextEnabled })
      return nextEnabled
    })
    setSaveStatus('idle')
  }

  const isWidgetWindow = windowName === OVERLAY_CONTROLS_WINDOW_NAME || windowName === OVERLAY_PINNED_WINDOW_NAME

  return (
    <div className="pointer-events-none fixed inset-0 h-screen w-screen bg-transparent font-sans text-white">
      {windowName === OVERLAY_CONTROLS_WINDOW_NAME && (
        <WidgetCard windowId={windowId} windowName={windowName}>
          <StatusWidget
            state={state}
            calibrationMode={calibrationMode}
            saveStatus={saveStatus}
            onToggleCalibration={handleToggleCalibration}
            onSave={() => sendToBackground('SAVE_BLOCKER_CONFIG')}
            onReset={() => sendToBackground('RESET_BLOCKER_CONFIG')}
          />
        </WidgetCard>
      )}
      {windowName === OVERLAY_PINNED_WINDOW_NAME && state.pinnedChecks.length > 0 && (
        <WidgetCard windowId={windowId} windowName={windowName}>
          <PinnedQuestLog checks={state.pinnedChecks} />
        </WidgetCard>
      )}
      {!isWidgetWindow && (
        <>
          <PenaltyBanner state={state} />
          <ToastStack toasts={toasts} />
        </>
      )}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Overlay />
)
