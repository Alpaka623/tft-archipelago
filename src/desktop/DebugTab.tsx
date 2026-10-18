import React from 'react'
import { BACKGROUND_WINDOW_ID, platform, type CandidateWindowInfo } from '../platform'
import type { DebugGameEvent } from '../types/debug'
import { formatLimit } from '../shared/app-state'
import type { AppState } from '../types/state'

function sendDebugGameEvent(event: DebugGameEvent): void {
  platform?.sendMessage(BACKGROUND_WINDOW_ID, 'DEBUG_GAME_EVENT', event)
}

function formatUsage(used: number, allowed: number): string {
  return `${used} / ${formatLimit(allowed)}`
}

function DebugButton({ event, children }: { event: DebugGameEvent; children: React.ReactNode }) {
  return (
    <button className="filter-button" type="button" onClick={() => sendDebugGameEvent(event)}>
      {children}
    </button>
  )
}

function GameWindowList() {
  const [windows, setWindows] = React.useState<CandidateWindowInfo[] | null>(null)

  const refresh = () => {
    void platform?.listCandidateWindows().then(setWindows)
  }

  if (platform?.kind !== 'electron') {
    return <div className="empty-state">Window detection diagnostics are only available in the Electron app.</div>
  }

  return (
    <div className="debug-window-list">
      <button className="primary-button" type="button" onClick={refresh}>
        List Visible Windows
      </button>
      {windows && windows.length === 0 && <div className="empty-state">No visible windows found.</div>}
      {windows && windows.length > 0 && (
        <table className="debug-table">
          <thead>
            <tr>
              <th>Process</th>
              <th>Title</th>
              <th>Size</th>
              <th>Game</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((info, index) => (
              <tr key={`${info.processName}-${info.title}-${index}`} className={info.isGame ? 'debug-row-game' : ''}>
                <td>{info.processName}</td>
                <td>{info.title}</td>
                <td>{info.width}×{info.height}</td>
                <td>{info.isGame ? 'Yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function DebugTab({ state }: { state: AppState }) {
  const [rank, setRank] = React.useState('4')
  const parsedRank = Math.min(8, Math.max(1, Math.round(Number(rank)) || 1))

  return (
    <div className="content-grid">
      <section className="panel">
        <div className="panel-heading">Simulate Game Events</div>
        <div className="debug-button-grid">
          <DebugButton event={{ type: 'match_start' }}>Match Start</DebugButton>
          <DebugButton event={{ type: 'round_start' }}>Round Start</DebugButton>
          <DebugButton event={{ type: 'battle_start' }}>Battle Start</DebugButton>
          <DebugButton event={{ type: 'shop_visible', visible: true }}>Shop Visible</DebugButton>
          <DebugButton event={{ type: 'shop_visible', visible: false }}>Shop Hidden</DebugButton>
          <DebugButton event={{ type: 'shop_reroll' }}>Shop Reroll</DebugButton>
          <DebugButton event={{ type: 'xp_buy' }}>XP Buy</DebugButton>
          <DebugButton event={{ type: 'augment_phase', active: true }}>Augment Phase On</DebugButton>
          <DebugButton event={{ type: 'augment_phase', active: false }}>Augment Phase Off</DebugButton>
          <DebugButton event={{ type: 'augment_reroll' }}>Augment Reroll</DebugButton>
        </div>
        <div className="debug-match-end">
          <label>
            <span>Final Rank</span>
            <input
              inputMode="numeric"
              value={rank}
              onChange={(event) => setRank(event.target.value)}
            />
          </label>
          <DebugButton event={{ type: 'match_end', rank: parsedRank }}>Match End (Rank {parsedRank})</DebugButton>
        </div>
        <div className="debug-note">
          Simulated events drive the real rule engine. A simulated match end can send checks when connected.
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">Rule Engine State</div>
        <div className="status-list">
          <div><span>Run Valid</span><strong>{state.isValidRun ? 'Yes' : 'No'}</strong></div>
          <div><span>Shop Rerolls</span><strong>{formatUsage(state.currentShopRerollsUsed, state.allowedRerolls)}</strong></div>
          <div><span>XP Buys This Round</span><strong>{formatUsage(state.currentXpBuysThisRound, state.allowedXpBuysPerRound)}</strong></div>
          <div><span>Augment Rerolls</span><strong>{formatUsage(state.currentAugmentRerollsUsed, state.allowedAugmentRerolls)}</strong></div>
          <div><span>Shop Visible</span><strong>{state.isShopVisible ? 'Yes' : 'No'}</strong></div>
          <div><span>Augment Phase</span><strong>{state.isAugmentPhaseActive ? 'Yes' : 'No'}</strong></div>
          <div><span>Last Violation</span><strong>{state.lastViolationReason ?? 'None'}</strong></div>
        </div>
      </section>

      <section className="panel debug-wide-panel">
        <div className="panel-heading">Game Window Detection</div>
        <GameWindowList />
      </section>
    </div>
  )
}
