import React from 'react'
import {
  IconArrowBigUpLines,
  IconBuildingStore,
  IconDeviceGamepad2,
  IconDice5,
  IconGavel,
  IconLayoutColumns,
  IconListCheck,
  IconLock,
  IconLockOpen,
  IconPlugConnected,
  IconRefresh,
  IconRocket,
  IconHeartHandshake,
  IconShieldCheck,
  IconShieldX,
  IconTrophy,
  type Icon,
} from '@tabler/icons-react'
import type { ClientMatchStatus } from '../../background/client-match'
import { LOCATION_CHECKS, MAJOR_LOCATION_CHECKS } from '../../data/locations'
import type { AppState } from '../../types/state'
import { describeMatchOutcome } from '../activity'
import { PENDING_STATUS_LABELS, RIOT_PHASE_STEPS, describeRiotPhase } from '../riot'
import { readSetup } from '../setup'
import { UNLIMITED, connectionLabel, formatLimit, percent, sendConnect, type PageId } from '../shared'
import { ViolationPanel } from '../ViolationPanel'

const CONNECTION_STORAGE_KEY = 'tft-archipelago-connection'

interface SavedConnection {
  hostname: string
  port: string
  slotName: string
}

function readSavedConnection(): SavedConnection {
  const fallback = { hostname: 'localhost', port: '38281', slotName: '' }
  try {
    const saved = JSON.parse(window.localStorage.getItem(CONNECTION_STORAGE_KEY) ?? 'null') as Partial<SavedConnection> | null
    const connection = { ...fallback, ...saved }
    // Prefill the slot with the player name chosen on the Setup page
    return connection.slotName ? connection : { ...connection, slotName: readSetup().slotName }
  } catch {
    return fallback
  }
}

function writeSavedConnection(connection: SavedConnection): void {
  try {
    window.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(connection))
  } catch {
    // Storage can be unavailable; the form still works for this session
  }
}

function Metric({ icon: MetricIcon, label, value, total, children }: {
  icon: Icon
  label: string
  value: React.ReactNode
  total?: number
  children?: React.ReactNode
}) {
  return (
    <div className="panel metric">
      <div className="metric-label"><MetricIcon size={15} />{label}</div>
      <div className="metric-value">{value}{total !== undefined && <small> / {total}</small>}</div>
      {children}
    </div>
  )
}

function describeValidRun(state: AppState): string {
  const overrides = state.violationOverrides.length
  if (overrides === 0) return 'No rule broken this match'
  return `${overrides} ${overrides === 1 ? 'override' : 'overrides'} announced this match`
}

function ProgressBar({ value }: { value: number }) {
  return <div className="bar"><span style={{ width: `${value}%` }} /></div>
}

interface RuleRow {
  icon: Icon
  label: string
  value: string
  restricted: boolean
}

function buildRules(state: AppState): RuleRow[] {
  const augmentChoices = [
    state.leftAugmentUnlocked && 'Left',
    'Middle',
    state.rightAugmentUnlocked && 'Right',
  ].filter(Boolean).join(', ')

  return [
    { icon: IconRefresh, label: 'Shop rerolls per round', value: formatLimit(state.allowedRerolls), restricted: state.allowedRerolls === 0 },
    { icon: IconArrowBigUpLines, label: 'XP buys per round', value: formatLimit(state.allowedXpBuysPerRound), restricted: state.allowedXpBuysPerRound === 0 },
    { icon: IconDice5, label: 'Augment rerolls per game', value: formatLimit(state.allowedAugmentRerolls), restricted: state.allowedAugmentRerolls === 0 },
    { icon: IconLayoutColumns, label: 'Augment choices', value: augmentChoices, restricted: !state.leftAugmentUnlocked && !state.rightAugmentUnlocked },
    { icon: IconBuildingStore, label: 'Locked shop slots', value: state.lockedShopSlots.join(', ') || 'None', restricted: state.lockedShopSlots.length > 0 },
  ]
}

function RulesPanel({ state }: { state: AppState }) {
  const usage = [
    { label: 'Rerolls used this round', used: state.currentShopRerollsUsed, allowed: state.allowedRerolls },
    { label: 'XP buys used this round', used: state.currentXpBuysThisRound, allowed: state.allowedXpBuysPerRound },
  ].filter(entry => entry.used > 0 && entry.allowed < UNLIMITED)

  return (
    <section className="panel">
      <div className="panel-header">
        <h3><IconGavel size={16} />Your rules this match</h3>
      </div>
      {buildRules(state).map(rule => {
        const RuleIcon = rule.icon
        return (
          <div key={rule.label} className="kv-row">
            <span className="kv-label"><RuleIcon size={16} />{rule.label}</span>
            <strong className={rule.restricted ? 'text-bad' : ''}>
              {rule.restricted && <IconLock size={14} />}
              {rule.value}
            </strong>
          </div>
        )
      })}
      {usage.map(entry => (
        <div key={entry.label} className="kv-row">
          <span className="kv-label faint">{entry.label}</span>
          <strong>{entry.used} / {entry.allowed}</strong>
        </div>
      ))}
    </section>
  )
}

function RiotClientPanel({ status }: { status: ClientMatchStatus }) {
  const phase = describeRiotPhase(status)
  const game = status.currentGame

  return (
    <section className="panel">
      <div className="panel-header">
        <h3><IconDeviceGamepad2 size={16} />Riot client</h3>
        {game
          ? <span className={`badge ${game.isCounted ? 'warn' : ''}`}>{game.queueName} · {game.isCounted ? 'counted' : 'not counted'}</span>
          : <span className={`badge ${phase.tone === 'idle' ? '' : 'ok'}`}>{phase.label}</span>}
      </div>
      <div className="phase-steps">
        {RIOT_PHASE_STEPS.map((step, index) => (
          <div key={step} className={`phase-step ${index < phase.step ? 'done' : index === phase.step ? 'current' : ''}`}>
            <span />
            <small>{step}</small>
          </div>
        ))}
      </div>
      <div className="divider" />
      {status.pending.map(entry => (
        <div key={`${entry.gameId ?? 'unknown'}`} className="kv-row">
          <span className="kv-label">{entry.queueName} result</span>
          <strong>{PENDING_STATUS_LABELS[entry.status]}</strong>
        </div>
      ))}
      <div className="last-match">
        <div>
          <div className="small muted">Last match</div>
          <div className="last-match-title">
            {status.lastOutcome
              ? `${status.lastOutcome.placement !== null ? `#${status.lastOutcome.placement} · ` : ''}${status.lastOutcome.queueName}`
              : 'None yet'}
          </div>
        </div>
        {status.lastOutcome && (
          <span className={`badge ${status.lastOutcome.kind === 'evaluated' && status.lastOutcome.fulfilledLocationIds.length > 0 ? 'ok' : status.lastOutcome.kind === 'invalid_run' ? 'bad' : ''}`}>
            {describeMatchOutcome(status.lastOutcome)}
          </span>
        )}
      </div>
    </section>
  )
}

function ArchipelagoPanel({ state }: { state: AppState }) {
  const [connection, setConnection] = React.useState<SavedConnection>(() => readSavedConnection())
  const [password, setPassword] = React.useState('')
  const [editing, setEditing] = React.useState(false)

  const isConnected = state.connectionStatus === 'connected'
  const isConnecting = state.connectionStatus === 'connecting'
  const canConnect = connection.hostname.trim() !== ''
    && connection.slotName.trim() !== ''
    && Number.isInteger(Number(connection.port))

  React.useEffect(() => {
    if (isConnected) setEditing(false)
  }, [isConnected])

  const update = (field: keyof SavedConnection) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setConnection({ ...connection, [field]: event.target.value })
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canConnect || isConnecting) return
    const trimmed = { hostname: connection.hostname.trim(), port: connection.port.trim(), slotName: connection.slotName.trim() }
    writeSavedConnection(trimmed)
    sendConnect(trimmed.hostname, Number(trimmed.port), trimmed.slotName, password)
  }

  if (isConnected && !editing) {
    return (
      <section className="panel">
        <div className="panel-header compact">
          <h3><IconPlugConnected size={16} />Archipelago</h3>
          <button className="btn ghost" type="button" onClick={() => setEditing(true)}>Change</button>
        </div>
        <div className="connection-line">
          <span className="dot ok" />
          <span>Connected as <strong>{connection.slotName}</strong></span>
          <span className="faint">{connection.hostname}:{connection.port}</span>
        </div>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h3><IconPlugConnected size={16} />Archipelago</h3>
        <span className={`badge ${state.connectionStatus === 'error' ? 'bad' : isConnecting ? 'warn' : ''}`}>
          {connectionLabel(state.connectionStatus)}
        </span>
      </div>
      <form className="connection-form" onSubmit={handleSubmit}>
        <label className="field field-wide">
          <span>Host</span>
          <input placeholder="archipelago.gg" value={connection.hostname} onChange={update('hostname')} />
        </label>
        <label className="field">
          <span>Port</span>
          <input inputMode="numeric" placeholder="38281" value={connection.port} onChange={update('port')} />
        </label>
        <label className="field">
          <span>Slot name</span>
          <input placeholder="Name from your YAML" value={connection.slotName} onChange={update('slotName')} />
        </label>
        <label className="field">
          <span>Password</span>
          <input placeholder="Optional" type="password" value={password} onChange={event => setPassword(event.target.value)} />
        </label>
        <div className="connection-actions">
          {state.connectionError && <div className="error-box">{state.connectionError}</div>}
          {editing && <button className="btn ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>}
          <button className="btn primary" disabled={!canConnect || isConnecting} type="submit">
            {isConnecting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>
    </section>
  )
}

export function OverviewPage({ state, onNavigate }: { state: AppState; onNavigate: (page: PageId) => void }) {
  const majorTotal = state.unlockedMajorLocationIds.length + state.lockedMajorLocationIds.length || MAJOR_LOCATION_CHECKS.length
  const checkedCount = state.checkedLocationIds.length
  const isConnected = state.connectionStatus === 'connected'

  return (
    <div className="page">
      {!isConnected && (
        <div className="info-line setup-hint">
          <IconRocket size={16} />
          <span>No multiworld yet? Create your player settings and the files for the host.</span>
          <button className="btn" type="button" onClick={() => onNavigate('setup')}>Open setup</button>
        </div>
      )}
      {!isConnected && <ArchipelagoPanel state={state} />}
      <ViolationPanel state={state} />

      <div className="metric-grid">
        <Metric icon={IconTrophy} label="Major goal" total={state.goalChecks} value={state.completedMajorCheckCount}>
          <ProgressBar value={percent(state.completedMajorCheckCount, state.goalChecks)} />
        </Metric>
        <Metric icon={IconListCheck} label="All checks" total={LOCATION_CHECKS.length} value={checkedCount}>
          <ProgressBar value={percent(checkedCount, LOCATION_CHECKS.length)} />
        </Metric>
        <Metric icon={IconLockOpen} label="Majors unlocked" total={majorTotal} value={state.unlockedMajorLocationIds.length}>
          <ProgressBar value={percent(state.unlockedMajorLocationIds.length, majorTotal)} />
        </Metric>
        {state.trustMode ? (
          <Metric icon={IconHeartHandshake} label="Current run" value={<span className="text-ok">Trust mode</span>}>
            <div className="tiny faint metric-note">Restrictions are not checked, you keep track yourself</div>
          </Metric>
        ) : (
          <Metric
            icon={state.isValidRun ? IconShieldCheck : IconShieldX}
            label="Current run"
            value={<span className={state.isValidRun ? 'text-ok' : 'text-bad'}>{state.isValidRun ? 'Valid' : 'Invalid'}</span>}
          >
            <div className="tiny faint metric-note">
              {state.isValidRun ? describeValidRun(state) : state.lastViolationReason ?? 'A rule was broken'}
            </div>
          </Metric>
        )}
      </div>

      <div className="overview-columns">
        <RulesPanel state={state} />
        <div className="stack">
          {state.clientMatch && <RiotClientPanel status={state.clientMatch} />}
          {isConnected && <ArchipelagoPanel state={state} />}
        </div>
      </div>

      <p className="legal-note">
        TFT Archipelago isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone
        officially involved in producing or managing Riot Games properties. Riot Games and all associated properties
        are trademarks or registered trademarks of Riot Games, Inc.
      </p>
    </div>
  )
}
