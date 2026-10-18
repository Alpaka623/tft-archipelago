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
  connected: 'text-emerald-300',
  connecting: 'text-amber-300',
  error: 'text-red-300',
  disconnected: 'text-red-300',
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
    <div className="mt-2 border-t border-white/10 pt-2 text-xs">
      {stock.length > 0 && (
        <div className="text-emerald-200">
          Bonus: {stock.map(([kind, count]) => `${count}× ${BONUS_LABELS[kind] ?? kind}`).join(' · ')}
        </div>
      )}
      {traps.map(([kind]) => (
        <div key={kind} className="font-semibold text-amber-300">Trap: {TRAP_LABELS[kind] ?? kind}</div>
      ))}
    </div>
  )
}

function UsageRow({ label, used, allowed, className = '' }: { label: string; used: number; allowed: number; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-5 ${className}`}>
      <span className="text-zinc-300">{label}</span>
      <span className="font-semibold">
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
    <div className="min-w-60 text-sm text-zinc-100">
      <div className="mb-3 flex items-center justify-between gap-5 border-b border-white/10 pb-2">
        <span className="font-semibold text-zinc-200">AP Server</span>
        <span className={`${CONNECTION_CLASS_NAMES[state.connectionStatus]} font-black uppercase`}>
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
          className="pointer-events-auto border border-white/20 bg-white/10 px-2 py-1 text-xs font-semibold text-white hover:bg-white/18"
          type="button"
          onClick={onToggleCalibration}
        >
          {calibrationMode ? 'Exit Calibration' : 'Calibrate'}
        </button>
        {calibrationMode && (
          <>
            <button
              className="pointer-events-auto border border-emerald-300/50 bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30"
              type="button"
              onClick={onSave}
            >
              Save
            </button>
            <button
              className="pointer-events-auto border border-amber-300/50 bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/30"
              type="button"
              onClick={onReset}
            >
              Reset
            </button>
          </>
        )}
      </div>
      {statusText && (
        <div className="mt-2 text-xs text-zinc-300">
          {statusText}
        </div>
      )}
    </div>
  )
}
