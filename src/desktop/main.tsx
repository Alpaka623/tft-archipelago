import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import { BACKGROUND_WINDOW_ID, platform } from '../platform'
import { DEFAULT_APP_STATE } from '../shared/app-state'
import { DEBUG_GAME_EVENTS_ENABLED } from '../types/debug'
import type { AppState, WindowMessage } from '../types/state'
import {
  MAX_ACTIVITY_LOG_ENTRIES,
  activityEntriesFromChecks,
  activityEntriesFromGlobalItem,
  activityEntriesFromHint,
  activityEntriesFromItem,
  activityEntryFromMatchOutcome,
  type ActivityLogEntry,
} from './activity'
import { DebugTab } from './DebugTab'
import { ActivityPage } from './pages/ActivityPage'
import { ChecksPage } from './pages/ChecksPage'
import { FaqPage } from './pages/FaqPage'
import { OverviewPage } from './pages/OverviewPage'
import { SetupPage } from './pages/SetupPage'
import { UnlocksPage } from './pages/UnlocksPage'
import {
  DEVELOPER_MODE_CLICKS,
  DEVELOPER_MODE_CLICK_GAP_MS,
  readDeveloperMode,
  sendPinnedChecks,
  writeDeveloperMode,
  type PageId,
} from './shared'
import { Sidebar, TitleBar } from './Shell'
import { VisionTab } from './VisionTab'
import './desktop.css'

function sendWindowMounted(): void {
  if (!platform) return

  void platform.getCurrentWindow().then((currentWindow) => {
    if (!currentWindow) {
      console.warn('Desktop failed to resolve current window')
      return
    }

    platform?.sendMessage(BACKGROUND_WINDOW_ID, 'WINDOW_MOUNTED', { windowId: currentWindow.id })
  })
}

function Desktop() {
  const [state, setState] = React.useState<AppState>(DEFAULT_APP_STATE)
  const [page, setPage] = React.useState<PageId>('overview')
  const [windowId, setWindowId] = React.useState('')
  const [activityLog, setActivityLog] = React.useState<ActivityLogEntry[]>([])
  const lastMatchFinishedAt = React.useRef<number | null>(null)
  const [developerMode, setDeveloperMode] = React.useState(readDeveloperMode)
  const faqClicks = React.useRef({ count: 0, lastAt: 0 })
  const showDeveloperPages = DEBUG_GAME_EVENTS_ENABLED && developerMode

  // Clicking FAQ ten times in a row toggles the developer pages
  const selectPage = React.useCallback((next: PageId) => {
    const clicks = faqClicks.current
    if (next !== 'faq') {
      clicks.count = 0
      setPage(next)
      return
    }
    const now = Date.now()
    clicks.count = now - clicks.lastAt <= DEVELOPER_MODE_CLICK_GAP_MS ? clicks.count + 1 : 1
    clicks.lastAt = now
    if (clicks.count >= DEVELOPER_MODE_CLICKS) {
      clicks.count = 0
      setDeveloperMode((enabled) => {
        writeDeveloperMode(!enabled)
        return !enabled
      })
    }
    setPage('faq')
  }, [])

  const addActivity = React.useCallback((entries: ActivityLogEntry[]) => {
    setActivityLog(previous => [...entries, ...previous].slice(0, MAX_ACTIVITY_LOG_ENTRIES))
  }, [])

  React.useEffect(() => {
    sendWindowMounted()

    if (!platform) return undefined

    void platform.getCurrentWindow().then((currentWindow) => {
      if (currentWindow) {
        setWindowId(currentWindow.id)
      }
    })

    const removeMessageListener = platform.onMessage((event) => {
      const message = event as WindowMessage
      if (message.id === 'STATE_UPDATE') {
        setState(message.content)
      } else if (message.id === 'AP_ITEM_RECEIVED') {
        addActivity(activityEntriesFromItem(message.content))
      } else if (message.id === 'AP_GLOBAL_ITEM_SENT') {
        addActivity(activityEntriesFromGlobalItem(message.content))
      } else if (message.id === 'AP_HINT_RECEIVED') {
        addActivity(activityEntriesFromHint(message.content))
      } else if (message.id === 'AP_CHECK_NOTIFICATION') {
        addActivity(activityEntriesFromChecks(message.content))
      }
    })

    return removeMessageListener
  }, [addActivity])

  // Each new Riot client match outcome becomes one activity entry
  const lastOutcome = state.clientMatch?.lastOutcome ?? null
  React.useEffect(() => {
    if (!lastOutcome || lastOutcome.finishedAt === lastMatchFinishedAt.current) return
    lastMatchFinishedAt.current = lastOutcome.finishedAt
    addActivity([activityEntryFromMatchOutcome(lastOutcome)])
  }, [lastOutcome, addActivity])

  React.useEffect(() => {
    const checkedIds = new Set(state.checkedLocationIds)
    const lockedMajorIds = new Set(state.lockedMajorLocationIds)
    const stillOpenPinnedChecks = state.pinnedChecks
      .filter(check => !checkedIds.has(check.id) && !lockedMajorIds.has(check.id))
    if (stillOpenPinnedChecks.length !== state.pinnedChecks.length) {
      sendPinnedChecks(stillOpenPinnedChecks)
    }
  }, [state.checkedLocationIds, state.lockedMajorLocationIds, state.pinnedChecks])

  return (
    <div className="desktop-shell">
      <TitleBar windowId={windowId} />
      <div className="desktop-body">
        <Sidebar developerMode={showDeveloperPages} page={page} state={state} onSelect={selectPage} />
        <main className="main-scroll">
          {page === 'setup' && <SetupPage onNavigate={selectPage} />}
          {page === 'overview' && <OverviewPage state={state} onNavigate={selectPage} />}
          {page === 'unlocks' && <UnlocksPage state={state} />}
          {page === 'checks' && <ChecksPage state={state} />}
          {page === 'activity' && <ActivityPage entries={activityLog} />}
          {page === 'faq' && <FaqPage onNavigate={selectPage} />}
          {showDeveloperPages && page === 'debug' && <div className="page legacy"><DebugTab state={state} /></div>}
          {showDeveloperPages && page === 'vision' && <div className="page legacy"><VisionTab /></div>}
        </main>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Desktop />
  </React.StrictMode>
)
