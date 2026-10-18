import {
  IconArrowBigUpLines,
  IconBomb,
  IconBuildingStore,
  IconCheck,
  IconDice5,
  IconGift,
  IconInfoCircle,
  IconLayoutColumns,
  IconLock,
  IconLockOpen,
  IconRefresh,
  type Icon,
} from '@tabler/icons-react'
import type { BonusKind, TrapKind } from '../../background/bonus-items'
import { ITEM_IDS } from '../../data/items'
import type { AppState } from '../../types/state'
import { UNLIMITED, formatLimit } from '../shared'

const MAX_SEGMENTS = 14

// One-time items and traps
const BONUS_ROWS: { kind: BonusKind; label: string; effect: string }[] = [
  { kind: 'reroll', label: 'Bonus Reroll', effect: 'one shop reroll over the round limit' },
  { kind: 'xp', label: 'Bonus XP Buy', effect: 'one XP buy over the round limit' },
  { kind: 'augmentReroll', label: 'Bonus Augment Reroll', effect: 'one augment reroll over the game limit' },
  { kind: 'augmentPick', label: 'Free Augment Pick', effect: 'click the augment blocker to open both outer slots once' },
  { kind: 'shopSlotPass', label: 'Shop Slot Pass', effect: 'buy one champion from slot 4 or 5' },
]
const TRAP_ROWS: { kind: TrapKind; label: string; effect: string }[] = [
  { kind: 'rerollLock', label: 'Reroll Lock Trap', effect: 'no shop rerolls for a round' },
  { kind: 'xpLock', label: 'XP Lock Trap', effect: 'no XP buys for a round' },
  { kind: 'augmentLock', label: 'Augment Lock Trap', effect: 'middle augment only, once' },
  { kind: 'shopLock', label: 'Shop Lock Trap', effect: 'slots 4 and 5 locked for a round' },
]
const SHOP_SLOTS = [1, 2, 3, 4, 5]
const UNLOCKABLE_SHOP_SLOTS = [4, 5]

interface ProgressiveTrack {
  name: string
  icon: Icon
  count: number
  max: number
  effect: string
  note: string
  restricted: boolean
}

function countItem(state: AppState, itemId: number): number {
  return state.inventory.find(item => item.itemId === itemId)?.count ?? 0
}

function perRoundNote(allowed: number, unit: string): string {
  return allowed >= UNLIMITED ? 'Maxed out' : `Next: ${allowed + 1} per ${unit}`
}

function buildTracks(state: AppState): ProgressiveTrack[] {
  const majorTotal = state.unlockedMajorLocationIds.length + state.lockedMajorLocationIds.length
  const startingMajors = state.startingMajorLocationIds.length
  const majorUnlocks = countItem(state, ITEM_IDS.PROGRESSIVE_MAJOR_CHECK_UNLOCK)

  return [
    {
      name: 'Progressive Reroll',
      icon: IconRefresh,
      count: countItem(state, ITEM_IDS.PROGRESSIVE_REROLL),
      max: 10,
      effect: `${formatLimit(state.allowedRerolls)} shop rerolls per round`,
      note: perRoundNote(state.allowedRerolls, 'round'),
      restricted: state.allowedRerolls === 0,
    },
    {
      name: 'Progressive XP Buy',
      icon: IconArrowBigUpLines,
      count: countItem(state, ITEM_IDS.PROGRESSIVE_XP_BUY),
      max: 10,
      effect: `${formatLimit(state.allowedXpBuysPerRound)} XP buys per round`,
      note: perRoundNote(state.allowedXpBuysPerRound, 'round'),
      restricted: state.allowedXpBuysPerRound === 0,
    },
    {
      name: 'Progressive Augment Reroll',
      icon: IconDice5,
      count: countItem(state, ITEM_IDS.PROGRESSIVE_AUGMENT_REROLL),
      max: 9,
      effect: `${formatLimit(state.allowedAugmentRerolls)} augment rerolls per game`,
      note: perRoundNote(state.allowedAugmentRerolls, 'game'),
      restricted: state.allowedAugmentRerolls === 0,
    },
    {
      name: 'Progressive Major Check Unlock',
      icon: IconLockOpen,
      count: majorUnlocks,
      max: Math.max(1, majorTotal - startingMajors),
      effect: `${state.unlockedMajorLocationIds.length} of ${majorTotal} majors unlocked`,
      note: `${startingMajors} at start + ${majorUnlocks} received`,
      restricted: false,
    },
  ]
}

function TrackPanel({ track }: { track: ProgressiveTrack }) {
  const TrackIcon = track.icon
  const segments = Math.min(track.max, MAX_SEGMENTS)
  const filled = track.max > MAX_SEGMENTS
    ? Math.round((Math.min(track.count, track.max) / track.max) * MAX_SEGMENTS)
    : Math.min(track.count, track.max)

  return (
    <section className="panel">
      <div className="panel-header compact">
        <h3><TrackIcon size={16} />{track.name}</h3>
        <span className={`badge ${track.count > 0 ? 'accent' : ''}`}>x{track.count}</span>
      </div>
      <div className="segments" style={{ gridTemplateColumns: `repeat(${segments}, 1fr)` }}>
        {Array.from({ length: segments }, (_, index) => (
          <span key={index} className={index < filled ? 'filled' : ''} />
        ))}
      </div>
      <div className="track-footer">
        <span className={track.restricted ? 'text-bad' : ''}>{track.effect}</span>
        <span className="faint">{track.note}</span>
      </div>
    </section>
  )
}

export function UnlocksPage({ state }: { state: AppState }) {
  const augmentSlots = [
    { label: 'Left', open: state.leftAugmentUnlocked, base: false },
    { label: 'Middle', open: true, base: true },
    { label: 'Right', open: state.rightAugmentUnlocked, base: false },
  ]
  const openAugmentSlots = augmentSlots.filter(slot => slot.open).length
  const buyableShopSlots = SHOP_SLOTS.filter(slot => !state.lockedShopSlots.includes(slot)).length
  const nothingCount = countItem(state, ITEM_IDS.NOTHING)

  return (
    <div className="page">
      <div className="two-columns">
        {buildTracks(state).map(track => <TrackPanel key={track.name} track={track} />)}
      </div>

      <div className="slot-columns">
        <section className="panel">
          <div className="panel-header">
            <h3><IconLayoutColumns size={16} />Augment choices</h3>
            <span className="small muted">{openAugmentSlots} of 3</span>
          </div>
          <div className="slot-row three">
            {augmentSlots.map(slot => (
              <div key={slot.label} className={`slot ${slot.open ? 'open' : ''}`}>
                {slot.open ? <IconCheck size={18} /> : <IconLock size={18} />}
                <small>{slot.label}{slot.base ? ' · base' : ''}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h3><IconBuildingStore size={16} />Shop slots</h3>
            <span className="small muted">{buyableShopSlots} of {SHOP_SLOTS.length} buyable</span>
          </div>
          <div className="slot-row five">
            {SHOP_SLOTS.map((slot) => {
              const locked = state.lockedShopSlots.includes(slot)
              const unlockable = UNLOCKABLE_SHOP_SLOTS.includes(slot)
              return (
                <div key={slot} className={`slot ${locked ? '' : unlockable ? 'open' : 'base'}`}>
                  {locked ? <IconLock size={18} /> : <strong>{slot}</strong>}
                  <small>{locked ? 'locked' : unlockable ? 'unlocked' : 'base'}</small>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <div className="two-columns">
        <section className="panel">
          <div className="panel-header">
            <h3><IconGift size={16} />One-time items</h3>
            <span className="tiny faint">used automatically over a limit</span>
          </div>
          {BONUS_ROWS.map(row => (
            <div key={row.kind} className="kv-row">
              <span className="kv-label stacked">{row.label}<span className="faint small">{row.effect}</span></span>
              <strong className={state.bonusItems.stock[row.kind] > 0 ? 'text-ok' : 'faint'}>{state.bonusItems.stock[row.kind]}</strong>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-header">
            <h3><IconBomb size={16} />Traps</h3>
            <span className="tiny faint">start at the next round</span>
          </div>
          {TRAP_ROWS.map(row => (
            <div key={row.kind} className="kv-row">
              <span className="kv-label stacked">{row.label}<span className="faint small">{row.effect}</span></span>
              <strong className={state.bonusItems.activeTraps[row.kind] ? 'text-bad' : state.bonusItems.pendingTraps[row.kind] > 0 ? '' : 'faint'}>
                {state.bonusItems.activeTraps[row.kind] ? 'active' : `${state.bonusItems.pendingTraps[row.kind]} waiting`}
              </strong>
            </div>
          ))}
        </section>
      </div>

      {nothingCount > 0 && (
        <div className="info-line"><IconInfoCircle size={16} />Nothing x{nothingCount} received. Filler items are not shown.</div>
      )}
    </div>
  )
}
