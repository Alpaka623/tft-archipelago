// The overlay controls widget: connection, per-round usage and blocker calibration
import { formatLimit } from '../shared/app-state'
import type { AppState } from '../types/state'

export type SaveStatus = 'idle' | 'saved' | 'error' | 'reset'

const BONUS_LABELS: Record<string, string> = {
  reroll: 'reroll',
  xp: 'XP',
  augmentReroll: 'augment reroll',
  augmentPick: 'augment pick',
  shopSlotPass: 'slot pass',
}

const TRAP_LABELS: Record<string, string> = {
  rerollLock: 'No rerolls this round',
  xpLock: 'No XP buys this round',
  augmentLock: 'Next augment: middle only',
  shopLock: 'Slots 4 and 5 locked this round',
}

const CONNECTION_LABELS: Record<AppState['connectionStatus'], string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  error: 'Error',
  disconnected: 'Disconnected',
}

const CONNECTION_CLASS_NAMES: Record<AppState['connectionStatus'], string> = {
  connected: 'bg-emerald-400 text-af-ink',
  connecting: 'bg-af-yellow text-af-ink',
  error: 'bg-af-red text-white',
  disconnected: 'bg-af-red text-white',
}

const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saved: 'Saved',
  error: 'Save failed',
  reset: 'Defaults restored',
}

// One-time items in stock and active traps
function BonusItemsSummary({ state }: { state: AppState }) {
  const stock = Object.entries(state.bonusItems.stock).filter(([, count]) => count > 0)
  const traps = Object.entries(state.bonusItems.activeTraps).filter(([, active]) => active)
  if (stock.length === 0 && traps.length === 0) return null

  return (
    <div className="mt-2 border-t-2 border-af-track pt-2 text-xs">
      {stock.length > 0 && (
        <div className="text-af-yellow">
          Bonus: {stock.map(([kind, count]) => `${count}× ${BONUS_LABELS[kind] ?? kind}`).join(' · ')}
        </div>
      )}
      {traps.map(([kind]) => (
        <div key={kind} className="font-semibold text-red-300">Trap: {TRAP_LABELS[kind] ?? kind}</div>
      ))}
    </div>
  )
}

function UsageRow({ label, used, allowed, className = '' }: { label: string; used: number; allowed: number; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-5 ${className}`}>
      <span className="text-white/70">{label}</span>
      <span className="font-display text-lg leading-none">
        {used} / {formatLimit(allowed)}
      </span>
    </div>
  )
}

export function StatusWidget({
  state,
  calibrationMode,
  saveStatus,
  onToggleCalibration,
  onSave,
  onReset,
}: {
  state: AppState
  calibrationMode: boolean
  saveStatus: SaveStatus
  onToggleCalibration: () => void
  onSave: () => void
  onReset: () => void
}) {
  const statusText = SAVE_STATUS_TEXT[saveStatus]

  return (
    <div className="min-w-60 font-body text-sm text-white">
      <div className="mb-3 flex items-center justify-between gap-5 border-b-2 border-af-track pb-2">
        <span className="af-heading">AP Server</span>
        <span className={`${CONNECTION_CLASS_NAMES[state.connectionStatus]} rounded-md px-2 pt-0.5 font-display text-base leading-tight tracking-wide`}>
          {CONNECTION_LABELS[state.connectionStatus]}
        </span>
      </div>
      <UsageRow label="Shop Rerolls" used={state.currentShopRerollsUsed} allowed={state.allowedRerolls} />
      <UsageRow label="XP Buys" used={state.currentXpBuysThisRound} allowed={state.allowedXpBuysPerRound} className="mt-2" />
      {state.isAugmentPhaseActive && (
        <UsageRow
          label="Augment Rerolls"
          used={state.currentAugmentRerollsUsed}
          allowed={state.allowedAugmentRerolls}
          className="mt-2"
        />
      )}
      <BonusItemsSummary state={state} />
      <div className="mt-3 flex items-center gap-2">
        <button
          className="af-button"
          type="button"
          onClick={onToggleCalibration}
        >
          {calibrationMode ? 'Exit Calibration' : 'Calibrate'}
        </button>
        {calibrationMode && (
          <>
            <button
              className="af-button"
              data-tone="yellow"
              type="button"
              onClick={onSave}
            >
              Save
            </button>
            <button
              className="af-button"
              data-tone="ink"
              type="button"
              onClick={onReset}
            >
              Reset
            </button>
          </>
        )}
      </div>
      {statusText && (
        <div className="mt-2 text-xs text-white/70">
          {statusText}
        </div>
      )}
    </div>
  )
}
