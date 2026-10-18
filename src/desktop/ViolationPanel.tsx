import React from 'react'
import { IconAlertTriangle, IconSpeakerphone } from '@tabler/icons-react'
import { platform } from '../platform'
import type { AppState, WindowMessage } from '../types/state'
import { sendOverrideViolation } from './shared'

// Holding prevents an override by a stray click
const HOLD_TO_CONFIRM_MS = 1500

type OverrideFeedback = { success: boolean; message: string }

function useOverrideFeedback(): [OverrideFeedback | null, (feedback: OverrideFeedback | null) => void] {
  const [feedback, setFeedback] = React.useState<OverrideFeedback | null>(null)

  React.useEffect(() => {
    if (!platform) return undefined
    return platform.onMessage((event) => {
      const message = event as WindowMessage
      if (message.id === 'VIOLATION_OVERRIDE_RESULT') setFeedback(message.content)
    })
  }, [])

  return [feedback, setFeedback]
}

function HoldToConfirmButton({ disabled, onConfirm, children }: {
  disabled: boolean
  onConfirm: () => void
  children: React.ReactNode
}) {
  const [isHolding, setIsHolding] = React.useState(false)
  const timeoutRef = React.useRef<number | null>(null)

  const cancel = React.useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    setIsHolding(false)
  }, [])

  React.useEffect(() => cancel, [cancel])

  const start = () => {
    if (disabled) return
    setIsHolding(true)
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null
      setIsHolding(false)
      onConfirm()
    }, HOLD_TO_CONFIRM_MS)
  }

  return (
    <button
      className={`btn hold-button ${isHolding ? 'holding' : ''}`}
      disabled={disabled}
      style={{ '--hold-ms': `${HOLD_TO_CONFIRM_MS}ms` } as React.CSSProperties}
      type="button"
      onPointerDown={start}
      onPointerLeave={cancel}
      onPointerUp={cancel}
    >
      <span className="hold-progress" />
      <span className="hold-label">{children}</span>
    </button>
  )
}

// Shown while the current run is invalid
export function ViolationPanel({ state }: { state: AppState }) {
  const [isConfirming, setIsConfirming] = React.useState(false)
  const [isSending, setIsSending] = React.useState(false)
  const [feedback, setFeedback] = useOverrideFeedback()
  const isConnected = state.connectionStatus === 'connected'

  // A new violation starts over
  React.useEffect(() => {
    setIsConfirming(false)
    setIsSending(false)
  }, [state.lastViolationReason])

  React.useEffect(() => {
    if (feedback) setIsSending(false)
  }, [feedback])

  if (state.isValidRun) return null

  const confirm = () => {
    setFeedback(null)
    setIsSending(true)
    sendOverrideViolation()
  }

  return (
    <section className="panel violation-panel">
      <div className="violation-head">
        <IconAlertTriangle size={18} />
        <div className="violation-text">
          <strong>Rule violation: current run invalidated</strong>
          <span>
            {state.lastViolationReason ?? 'A rule was broken'}
            {state.lastViolationStage ? ` · stage ${state.lastViolationStage}` : ''}
          </span>
        </div>
        {!isConfirming && (
          <button className="btn" type="button" onClick={() => { setFeedback(null); setIsConfirming(true) }}>
            Override…
          </button>
        )}
      </div>

      {isConfirming && (
        <div className="violation-confirm">
          <p>
            Only override if the tracker detected something you did not do. The override is posted to the
            multiworld chat with the reason, so every player sees it.
          </p>
          {!isConnected && <div className="error-box">Connect to Archipelago first. Overrides are announced to the multiworld.</div>}
          <div className="violation-actions">
            <button className="btn ghost" type="button" onClick={() => setIsConfirming(false)}>Cancel</button>
            <HoldToConfirmButton disabled={!isConnected || isSending} onConfirm={confirm}>
              <IconSpeakerphone size={14} />
              {isSending ? 'Posting…' : 'Hold to override and announce'}
            </HoldToConfirmButton>
          </div>
        </div>
      )}

      {feedback && !feedback.success && <div className="error-box violation-feedback">{feedback.message}</div>}
    </section>
  )
}
