import React from 'react'
import {
  IconActivity,
  IconBug,
  IconCoffee,
  IconCopy,
  IconExternalLink,
  IconEye,
  IconHelpCircle,
  IconLayoutDashboard,
  IconListCheck,
  IconMinus,
  IconPackage,
  IconRocket,
  IconSquare,
  IconX,
  type Icon,
} from '@tabler/icons-react'
import { version as APP_VERSION } from '../../package.json'
import { LOCATION_CHECKS } from '../data/locations'
import { APP_UPDATE_STATUS_MESSAGE_ID, platform, type AppUpdateStatus } from '../platform'
import type { AppState, PinnedCheck } from '../types/state'
import { describeRiotPhase } from './riot'
import { MAX_PINNED_CHECKS, connectionLabel, sendPinnedChecks, type PageId } from './shared'

interface NavEntry {
  id: PageId
  label: string
  icon: Icon
}

const MAIN_NAV: NavEntry[] = [
  { id: 'setup', label: 'Setup', icon: IconRocket },
  { id: 'overview', label: 'Overview', icon: IconLayoutDashboard },
  { id: 'unlocks', label: 'Unlocks', icon: IconPackage },
  { id: 'checks', label: 'Checks', icon: IconListCheck },
  { id: 'activity', label: 'Activity', icon: IconActivity },
  { id: 'faq', label: 'FAQ', icon: IconHelpCircle },
]

// Optional tip link; supporting never unlocks anything in the app
const KOFI_URL = 'https://ko-fi.com/novytft'

function connectionTone(status: AppState['connectionStatus']): string {
  switch (status) {
    case 'connected':
      return 'ok'
    case 'connecting':
      return 'warn'
    case 'error':
      return 'bad'
    case 'disconnected':
      return 'idle'
  }
}

export function TitleBar({ windowId }: { windowId: string }) {
  const [maximized, setMaximized] = React.useState(false)

  const toggleMaximize = () => {
    if (!platform || !windowId) return
    const toggle = maximized ? platform.restoreWindow(windowId) : platform.maximizeWindow(windowId)
    void toggle.then((success) => {
      if (success) setMaximized(!maximized)
    })
  }

  return (
    <header className="titlebar">
      <div
        className="titlebar-drag"
        onMouseDown={(event) => {
          if (event.button === 0 && windowId) platform?.dragMove(windowId)
        }}
        onDoubleClick={toggleMaximize}
      >
        <img alt="" className="brand-mark" src="assets/icon.png" />
        <span className="brand-name">TFT Archipelago</span>
      </div>
      <div className="window-controls">
        <button aria-label="Minimize window" type="button" onClick={() => windowId && platform?.minimizeWindow(windowId)}>
          <IconMinus size={16} />
        </button>
        <button aria-label={maximized ? 'Restore window' : 'Maximize window'} type="button" onClick={toggleMaximize}>
          {maximized ? <IconCopy size={14} /> : <IconSquare size={14} />}
        </button>
        <button
          aria-label="Close window"
          className="window-close"
          type="button"
          onClick={() => windowId && platform?.closeWindow(windowId)}
        >
          <IconX size={16} />
        </button>
      </div>
    </header>
  )
}

function NavButton({ entry, active, count, onSelect }: {
  entry: NavEntry
  active: boolean
  count?: string
  onSelect: (page: PageId) => void
}) {
  const EntryIcon = entry.icon
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} type="button" onClick={() => onSelect(entry.id)}>
      <EntryIcon size={18} stroke={1.75} />
      <span>{entry.label}</span>
      {count && <span className="nav-count">{count}</span>}
    </button>
  )
}

function PinnedChecks({ pinnedChecks }: { pinnedChecks: PinnedCheck[] }) {
  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header">
        <span className="section-label">Pinned</span>
        <span className="faint tiny">{pinnedChecks.length} / {MAX_PINNED_CHECKS}</span>
      </div>
      {pinnedChecks.length === 0 && (
        <div className="sidebar-hint">Pin up to {MAX_PINNED_CHECKS} checks to show them in game.</div>
      )}
      {pinnedChecks.map(check => (
        <div key={check.id} className="pinned-card">
          <div className="pinned-card-text">
            <span className={`pinned-category ${check.category}`}>{check.category}</span>
            <span>{check.name}</span>
          </div>
          <button
            aria-label={`Unpin ${check.name}`}
            className="icon-button"
            type="button"
            onClick={() => sendPinnedChecks(pinnedChecks.filter(pinnedCheck => pinnedCheck.id !== check.id))}
          >
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

function useAppUpdateStatus(): AppUpdateStatus | null {
  const [status, setStatus] = React.useState<AppUpdateStatus | null>(null)

  React.useEffect(() => {
    if (!platform) return undefined
    let active = true
    void platform.getUpdateStatus().then((initial) => {
      if (active) setStatus(current => current ?? initial)
    })
    const removeListener = platform.onMessage((message) => {
      if (message.id === APP_UPDATE_STATUS_MESSAGE_ID) setStatus(message.content as AppUpdateStatus)
    })
    return () => {
      active = false
      removeListener()
    }
  }, [])

  return status
}

// App version and auto-update state. A ready update installs on quit anyway;
// the button restarts earlier, which the main process refuses while TFT is running.
function AppVersionRow() {
  const status = useAppUpdateStatus()
  const [installRefused, setInstallRefused] = React.useState(false)

  if (status?.state === 'ready') {
    const install = () => {
      void platform?.installUpdate().then(started => setInstallRefused(!started))
    }
    return (
      <button
        className="sidebar-status-row sidebar-status-link"
        title={installRefused ? 'Close TFT first, or quit the app: the update installs on quit' : `Restart to install ${status.version}`}
        type="button"
        onClick={install}
      >
        <span className="dot ok" />
        <span>Update {status.version}</span>
        <span className={installRefused ? 'text-bad' : 'text-ok'}>{installRefused ? 'Close TFT first' : 'Restart'}</span>
      </button>
    )
  }

  const detail = status?.state === 'downloading' ? `${status.version} · ${status.percent ?? 0}%` : null
  return (
    <div className="sidebar-status-row" title={status?.state === 'error' ? `Update check failed: ${status.error}` : undefined}>
      <span className={`dot ${status?.state === 'downloading' ? 'warn' : 'idle'}`} />
      <span>{detail ? 'Downloading' : 'App'}</span>
      <span className="faint">{detail ?? APP_VERSION}</span>
    </div>
  )
}

function StatusBlock({ state, onSelect }: { state: AppState; onSelect: (page: PageId) => void }) {
  const riot = state.clientMatch ? describeRiotPhase(state.clientMatch) : null
  return (
    <div className="sidebar-status">
      <div className="sidebar-status-row">
        <span className={`dot ${connectionTone(state.connectionStatus)}`} />
        <span>Archipelago</span>
        <span className="faint">{state.connectionStatus === 'error' ? 'Error' : connectionLabel(state.connectionStatus)}</span>
      </div>
      {riot && (
        <div className="sidebar-status-row">
          <span className={`dot ${riot.tone}`} />
          <span>Riot client</span>
          <span className="faint">{riot.label}</span>
        </div>
      )}
      {state.isValidRun ? (
        <div className="sidebar-status-row">
          <span className="dot ok" />
          <span>Run</span>
          <span className="text-ok">Valid</span>
        </div>
      ) : (
        // The override lives on Overview
        <button className="sidebar-status-row sidebar-status-link" title="Show the violation" type="button" onClick={() => onSelect('overview')}>
          <span className="dot bad" />
          <span>Run</span>
          <span className="text-bad">Invalid</span>
        </button>
      )}
      <AppVersionRow />
    </div>
  )
}

export function Sidebar({ state, page, developerMode, onSelect }: {
  state: AppState
  page: PageId
  developerMode: boolean
  onSelect: (page: PageId) => void
}) {
  const checkCount = `${state.checkedLocationIds.length}/${LOCATION_CHECKS.length}`
  const devNav: NavEntry[] = developerMode
    ? [
      { id: 'debug', label: 'Debug', icon: IconBug },
      ...(platform?.kind === 'electron' ? [{ id: 'vision' as const, label: 'Vision', icon: IconEye }] : []),
    ]
    : []

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {MAIN_NAV.map(entry => (
          <NavButton
            key={entry.id}
            active={page === entry.id}
            count={entry.id === 'checks' ? checkCount : undefined}
            entry={entry}
            onSelect={onSelect}
          />
        ))}
        {devNav.length > 0 && <div className="section-label sidebar-dev-label">Developer</div>}
        {devNav.map(entry => (
          <NavButton key={entry.id} active={page === entry.id} entry={entry} onSelect={onSelect} />
        ))}
      </nav>
      <PinnedChecks pinnedChecks={state.pinnedChecks} />
      <div className="sidebar-spacer" />
      {platform && (
        <button className="nav-item kofi-link" title={KOFI_URL} type="button" onClick={() => platform?.openExternalUrl(KOFI_URL)}>
          <IconCoffee size={18} stroke={1.75} />
          <span>Support on Ko-fi</span>
          <IconExternalLink className="kofi-link-external" size={14} stroke={1.75} />
        </button>
      )}
      <StatusBlock state={state} onSelect={onSelect} />
    </aside>
  )
}
