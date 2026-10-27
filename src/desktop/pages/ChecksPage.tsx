import React from 'react'
import { IconCheck, IconLock, IconPin, IconSearch } from '@tabler/icons-react'
import { MAJOR_LOCATION_CHECKS, type LocationCheck } from '../../data/locations'
import type { AppState } from '../../types/state'
import {
  CHAMPION_STAR_CHECKS,
  MAX_PINNED_CHECKS,
  OTHER_MINOR_CHECKS,
  getChampionCost,
  getChampionIcon,
  getChampionName,
  getDoneCheckIds,
  getMajorLabel,
  getTraitIcon,
  togglePinnedCheck,
} from '../shared'

type ChecksView = 'majors' | 'champions' | 'other'
type StatusFilter = 'missing' | 'done' | 'all'

const COSTS = [1, 2, 3, 4, 5]

interface ChampionRow {
  championId: string
  name: string
  cost: number
  icon: string | null
  checks: Partial<Record<2 | 3, LocationCheck>>
}

function buildChampionRows(): ChampionRow[] {
  const rows = new Map<string, ChampionRow>()
  for (const check of CHAMPION_STAR_CHECKS) {
    if (check.condition.type !== 'champion') continue
    const { championId, minimumStarLevel } = check.condition
    const row = rows.get(championId) ?? {
      championId,
      name: getChampionName(championId),
      cost: getChampionCost(championId),
      icon: getChampionIcon(championId),
      checks: {},
    }
    row.checks[minimumStarLevel as 2 | 3] = check
    rows.set(championId, row)
  }
  return [...rows.values()].sort((left, right) => left.cost - right.cost || left.name.localeCompare(right.name))
}

const CHAMPION_ROWS = buildChampionRows()

const majorIdSet = new Set(MAJOR_LOCATION_CHECKS.map(check => check.id))

function matchesStatus(done: boolean, filter: StatusFilter): boolean {
  return filter === 'all' || (filter === 'done') === done
}

interface CheckContext {
  state: AppState
  doneIds: Set<number>
  // checked on the server by another player's collect, not completed by the player
  collectedMajorIds: Set<number>
  pinnedIds: Set<number>
  pinLimitReached: boolean
}

function PinButton({ check, context }: { check: LocationCheck; context: CheckContext }) {
  const pinned = context.pinnedIds.has(check.id)
  return (
    <button
      aria-label={pinned ? `Unpin ${check.name}` : `Pin ${check.name}`}
      className={`icon-button pin ${pinned ? 'active' : ''}`}
      disabled={!pinned && context.pinLimitReached}
      title={pinned ? 'Unpin' : context.pinLimitReached ? `Only ${MAX_PINNED_CHECKS} checks can be pinned` : 'Pin to overlay'}
      type="button"
      onClick={() => togglePinnedCheck(context.state, check)}
    >
      <IconPin size={16} />
    </button>
  )
}

function StarButton({ check, star, context }: { check: LocationCheck | undefined; star: 2 | 3; context: CheckContext }) {
  if (!check) return <span className="star-button empty">-</span>
  const done = context.doneIds.has(check.id)
  const pinned = context.pinnedIds.has(check.id)
  return (
    <button
      className={`star-button ${done ? 'done' : pinned ? 'pinned' : ''}`}
      disabled={done || (!pinned && context.pinLimitReached)}
      title={done ? `${check.name} (done)` : pinned ? `Unpin ${check.name}` : `Pin ${check.name}`}
      type="button"
      onClick={() => togglePinnedCheck(context.state, check)}
    >
      {done ? <IconCheck size={13} /> : pinned ? <IconPin size={13} /> : null}
      {star}★
    </button>
  )
}

function MajorTile({ check, context }: { check: LocationCheck; context: CheckContext }) {
  const done = context.doneIds.has(check.id)
  const collected = context.collectedMajorIds.has(check.id)
  const pinned = context.pinnedIds.has(check.id)
  const condition = check.condition
  const isTrait = condition.type === 'trait'
  const icon = isTrait ? getTraitIcon(condition.trait) : condition.type === 'champion' ? getChampionIcon(condition.championId) : null
  const cost = condition.type === 'champion' ? getChampionCost(condition.championId) : 0

  return (
    <div className={`major-tile ${done ? 'done' : ''} ${pinned ? 'pinned' : ''}`} title={check.name}>
      <div className={`major-icon ${isTrait ? 'trait' : `portrait cost-${cost}`}`}>
        {icon && <img alt="" src={icon} />}
      </div>
      <div className="major-text">
        <strong>{getMajorLabel(check)}</strong>
        <small>
          {isTrait ? 'Top 4, trait active' : 'Top 4, on board'}
          {collected && ' · collected, still counts'}
        </small>
      </div>
      {done ? <span className="done-mark"><IconCheck size={14} /></span> : <PinButton check={check} context={context} />}
    </div>
  )
}

function ChampionTile({ row, context }: { row: ChampionRow; context: CheckContext }) {
  return (
    <div className={`champion-tile cost-${row.cost}`}>
      <div className="champion-portrait">
        {row.icon && <img alt="" loading="lazy" src={row.icon} />}
      </div>
      <div className="champion-body">
        <strong>{row.name}</strong>
        <div className="star-row">
          <StarButton check={row.checks[2]} context={context} star={2} />
          <StarButton check={row.checks[3]} context={context} star={3} />
        </div>
      </div>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>
}

export function ChecksPage({ state }: { state: AppState }) {
  const [view, setView] = React.useState<ChecksView>('champions')
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all')
  const [costFilter, setCostFilter] = React.useState<number | null>(null)
  const [search, setSearch] = React.useState('')

  const doneIds = React.useMemo(() => getDoneCheckIds(state), [state])
  const collectedMajorIds = React.useMemo(
    () => new Set(state.checkedLocationIds.filter(id => majorIdSet.has(id) && !doneIds.has(id))),
    [state.checkedLocationIds, doneIds],
  )
  const pinnedIds = React.useMemo(() => new Set(state.pinnedChecks.map(check => check.id)), [state.pinnedChecks])
  const lockedMajorIds = React.useMemo(() => new Set(state.lockedMajorLocationIds), [state.lockedMajorLocationIds])
  const context: CheckContext = { state, doneIds, collectedMajorIds, pinnedIds, pinLimitReached: state.pinnedChecks.length >= MAX_PINNED_CHECKS }
  const query = search.trim().toLowerCase()

  const unlockedMajors = MAJOR_LOCATION_CHECKS.filter(check => !lockedMajorIds.has(check.id))
  const doneCount = (checks: LocationCheck[]) => checks.filter(check => doneIds.has(check.id)).length

  const visibleMajors = unlockedMajors
    .filter(check => matchesStatus(doneIds.has(check.id), statusFilter))
    .filter(check => query === '' || `${check.name} ${getMajorLabel(check)}`.toLowerCase().includes(query))

  const visibleChampions = CHAMPION_ROWS
    .filter(row => costFilter === null || row.cost === costFilter)
    .filter(row => query === '' || row.name.toLowerCase().includes(query))
    .filter((row) => {
      const checks = Object.values(row.checks).filter((check): check is LocationCheck => Boolean(check))
      const allDone = checks.every(check => doneIds.has(check.id))
      return statusFilter === 'all' || (statusFilter === 'done' ? checks.some(check => doneIds.has(check.id)) : !allDone)
    })

  const visibleOther = OTHER_MINOR_CHECKS
    .filter(check => matchesStatus(doneIds.has(check.id), statusFilter))
    .filter(check => query === '' || check.name.toLowerCase().includes(query))

  const views: { id: ChecksView; label: string; done: number; total: number }[] = [
    { id: 'majors', label: 'Majors', done: doneCount(unlockedMajors), total: unlockedMajors.length },
    { id: 'champions', label: 'Champions', done: doneCount(CHAMPION_STAR_CHECKS), total: CHAMPION_STAR_CHECKS.length },
    { id: 'other', label: 'Other', done: doneCount(OTHER_MINOR_CHECKS), total: OTHER_MINOR_CHECKS.length },
  ]

  return (
    <div className="page">
      <div className="toolbar">
        <div className="chip-group">
          {views.map(entry => (
            <button key={entry.id} className={`chip ${view === entry.id ? 'active' : ''}`} type="button" onClick={() => setView(entry.id)}>
              {entry.label} <span className="chip-count">{entry.done}/{entry.total}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <IconSearch size={15} />
          <input
            placeholder={view === 'champions' ? 'Search champions' : 'Search checks'}
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="toolbar secondary">
        <div className="chip-group">
          {(['all', 'missing', 'done'] as const).map(filter => (
            <button key={filter} className={`chip small ${statusFilter === filter ? 'active' : ''}`} type="button" onClick={() => setStatusFilter(filter)}>
              {filter === 'missing' ? 'Missing' : filter === 'done' ? 'Done' : 'All'}
            </button>
          ))}
          {view === 'champions' && <span className="chip-divider" />}
          {view === 'champions' && COSTS.map(cost => (
            <button
              key={cost}
              className={`chip small cost-chip cost-${cost} ${costFilter === cost ? 'active' : ''}`}
              type="button"
              onClick={() => setCostFilter(costFilter === cost ? null : cost)}
            >
              {cost}-cost
            </button>
          ))}
        </div>
        <span className="small muted">
          {state.completedMajorCheckCount} / {state.goalChecks} goal · {state.pinnedChecks.length} / {MAX_PINNED_CHECKS} pinned
        </span>
      </div>

      {view === 'majors' && (
        <>
          {visibleMajors.length === 0
            ? <EmptyState>No unlocked major checks match these filters.</EmptyState>
            : <div className="major-grid">{visibleMajors.map(check => <MajorTile key={check.id} check={check} context={context} />)}</div>}
          {lockedMajorIds.size > 0 && (
            <div className="info-line"><IconLock size={16} />{lockedMajorIds.size} major checks are still locked. Each Progressive Major Check Unlock opens the next one.</div>
          )}
        </>
      )}

      {view === 'champions' && (
        visibleChampions.length === 0
          ? <EmptyState>No champions match these filters.</EmptyState>
          : COSTS.map((cost) => {
            const rows = visibleChampions.filter(row => row.cost === cost)
            if (rows.length === 0) return null
            const costChecks = CHAMPION_STAR_CHECKS.filter(check => check.condition.type === 'champion' && getChampionCost(check.condition.championId) === cost)
            return (
              <section key={cost} className={`cost-group cost-${cost}`}>
                <div className="cost-heading">
                  <span>{cost}-cost</span>
                  <span className="faint small">{doneCount(costChecks)} / {costChecks.length}</span>
                  <div className="cost-rule" />
                </div>
                <div className="champion-grid">
                  {rows.map(row => <ChampionTile key={row.championId} context={context} row={row} />)}
                </div>
              </section>
            )
          })
      )}

      {view === 'other' && (
        visibleOther.length === 0
          ? <EmptyState>No other checks match these filters.</EmptyState>
          : (
            <div className="panel list-panel">
              {visibleOther.map((check) => {
                const done = doneIds.has(check.id)
                return (
                  <div key={check.id} className={`list-row ${done ? 'done' : ''}`}>
                    <span className={`status-icon ${done ? 'done' : ''}`}>{done && <IconCheck size={12} />}</span>
                    <span className="list-row-name">{check.name}</span>
                    {!done && <PinButton check={check} context={context} />}
                  </div>
                )
              })}
            </div>
          )
      )}
    </div>
  )
}
