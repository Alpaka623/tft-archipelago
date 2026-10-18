// Item and check toasts in the widget card style
import React from 'react'
import type { CheckNotification, ReceivedItemNotification } from '../types/state'

type NewToast =
  | ({ kind: 'item' } & ReceivedItemNotification)
  | ({ kind: 'check' } & CheckNotification)

export type Toast = NewToast & { toastId: string }

interface ToastStyle {
  borderClassName: string
  titleClassName: string
  title: string
}

const ITEM_TOAST_DURATION_MS = 6000
const CHECK_TOAST_DURATION_MS = 8000
const MAX_CHECK_TOAST_ROWS = 3

function getToastStyle(toast: Toast): ToastStyle {
  if (toast.kind === 'item') {
    return {
      borderClassName: 'border-l-emerald-400',
      titleClassName: 'text-emerald-300',
      title: 'Item Received',
    }
  }

  return toast.status === 'sent'
    ? {
      borderClassName: 'border-l-sky-400',
      titleClassName: 'text-sky-300',
      title: toast.checks.length === 1 ? 'Check Sent' : 'Checks Sent',
    }
    : {
      borderClassName: 'border-l-amber-400',
      titleClassName: 'text-amber-300',
      title: toast.checks.length === 1 ? 'Check Queued' : 'Checks Queued',
    }
}

function ToastRewardLine({ locationName, itemName, playerName }: {
  locationName: string
  itemName: string | null
  playerName: string | null
}) {
  return (
    <li className="leading-snug">
      <span className="font-semibold text-white">{locationName}</span>
      {itemName && playerName && (
        <span className="text-zinc-400"> → {itemName} for {playerName}</span>
      )}
    </li>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const style = getToastStyle(toast)

  if (toast.kind === 'item') {
    return (
      <div className={`toast-card ${style.borderClassName}`}>
        <div className={`${style.titleClassName} text-[11px] font-black uppercase tracking-wide`}>{style.title}</div>
        <div className="mt-0.5 break-words leading-snug">
          <span className="font-semibold">{toast.itemName}</span>
          <span className="text-zinc-400"> from {toast.playerName}</span>
        </div>
      </div>
    )
  }

  const visibleChecks = toast.checks.slice(0, MAX_CHECK_TOAST_ROWS)
  const moreCount = Math.max(0, toast.checks.length - visibleChecks.length)

  return (
    <div className={`toast-card ${style.borderClassName}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`${style.titleClassName} text-[11px] font-black uppercase tracking-wide`}>{style.title}</span>
        {toast.status === 'queued' && (
          <span className="text-[11px] text-zinc-400">sends after reconnect</span>
        )}
      </div>
      <ul className="mt-0.5 space-y-0.5 break-words">
        {visibleChecks.map((check) => (
          <ToastRewardLine
            key={check.locationId}
            locationName={check.locationName}
            itemName={check.itemName}
            playerName={check.playerName}
          />
        ))}
        {moreCount > 0 && (
          <li className="text-xs text-zinc-400">+ {moreCount} more</li>
        )}
      </ul>
    </div>
  )
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-16 flex w-[min(360px,calc(100vw-48px))] -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.toastId} toast={toast} />
      ))}
    </div>
  )
}

// Toasts disappear on their own after a few seconds
export function useToasts(): { toasts: Toast[]; addToast: (toast: NewToast) => void } {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const timers = React.useRef<number[]>([])

  const addToast = React.useCallback((toast: NewToast) => {
    const toastId = `${Date.now()}-${Math.random()}`
    setToasts(current => [...current, { ...toast, toastId }])

    const durationMs = toast.kind === 'check' ? CHECK_TOAST_DURATION_MS : ITEM_TOAST_DURATION_MS
    timers.current.push(window.setTimeout(() => {
      setToasts(current => current.filter(entry => entry.toastId !== toastId))
    }, durationMs))
  }, [])

  React.useEffect(() => () => {
    for (const timerId of timers.current) window.clearTimeout(timerId)
    timers.current = []
  }, [])

  return { toasts, addToast }
}
