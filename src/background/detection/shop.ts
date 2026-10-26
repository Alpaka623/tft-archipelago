// Shop rerolls and purchases, detected from changes of the five shop slots against a baseline.
// Automatic refreshes (round start, refill of sold slots, returning from a UI screen) are no rerolls.
import { deriveState } from '../app-state'
import { broadcastState } from '../broadcast'
import { logGep } from '../log'
import { readBooleanFromRaw } from '../raw'
import { consumeBonusItem } from '../rules/bonus-usage'
import { invalidateRun, validateCurrentRules } from '../rules/engine'
import { bonus, round, shop, slot } from '../state'
import type { ShopSnapshot } from '../types'
import { SHOP_BLOCKER_HIDE_DELAY_MS } from '../windows/blocker-rules'
import { noteShopPurchaseForXpFallback } from './xp'

export const SHOP_SLOT_COUNT = 5

const NON_PLANNING_SHOP_REROLL_CONFIRM_DELAY_MS = 1000
const AUTOMATIC_SHOP_REFRESH_GRACE_MS = 1500

interface PendingShopRerollCandidate {
  id: number
  changedSlotCount: number
  previousSnapshot: ShopSnapshot
  nextSnapshot: ShopSnapshot
  createdAt: number
  timeoutId: number
}

let pendingRerollCandidates: PendingShopRerollCandidate[] = []
let nextRerollCandidateId = 1
let hideTimeoutId: number | null = null

export function isSold(value: string): boolean {
  return value.toLowerCase() === 'sold'
}

function isChampionShopEntry(value: string): boolean {
  return value.trim() !== '' && !isSold(value)
}

function hasShopContent(snapshot: ShopSnapshot): boolean {
  return snapshot.some(name => name.trim() !== '')
}

export function areSnapshotsEqual(left: string[] | null, right: string[] | null): boolean {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function getPhaseLabel(): 'planning' | 'non_planning' {
  return round.isInPlanningPhase ? 'planning' : 'non_planning'
}

export function markAwaitingAutomaticShopRefresh(): void {
  shop.isAwaitingAutomaticRefresh = true
  shop.automaticRefreshMarkedAt = Date.now()
}

export function clearAutomaticShopRefreshMarker(): void {
  shop.isAwaitingAutomaticRefresh = false
  shop.automaticRefreshMarkedAt = null
}

function getAutomaticShopRefreshAgeMs(): number | null {
  return shop.automaticRefreshMarkedAt === null
    ? null
    : Date.now() - shop.automaticRefreshMarkedAt
}

export function markNextShopChangeAsUiReturn(reason: string): void {
  shop.isAwaitingUiReturnRefresh = true
  logGep('GEP shop: next full shop change marked as UI-return refresh', { reason })
}

export function setShopHiddenAt(hiddenAt: number | null): void {
  shop.hiddenAt = hiddenAt
  if (hideTimeoutId !== null) window.clearTimeout(hideTimeoutId)
  hideTimeoutId = null
  if (hiddenAt === null) return

  // Re-evaluate blockers once the hide delay has passed
  hideTimeoutId = window.setTimeout(() => {
    hideTimeoutId = null
    broadcastState()
  }, SHOP_BLOCKER_HIDE_DELAY_MS + 50)
}

export function handleShopVisibleUpdate(rawShopVisible: unknown): void {
  const nextIsShopVisible = readBooleanFromRaw(rawShopVisible)
  if (nextIsShopVisible === null) {
    logGep('GEP shop_visible ignored: unrecognized payload', { data: rawShopVisible })
    return
  }

  const didChange = shop.isVisible !== nextIsShopVisible
  shop.isVisible = nextIsShopVisible
  shop.isExplicitlyHidden = !nextIsShopVisible

  if (!didChange) return
  setShopHiddenAt(nextIsShopVisible ? null : Date.now())

  logGep('GEP shop_visible changed', { isShopVisible: shop.isVisible })
  broadcastState()
}

export function inferShopVisibleFromShopData(reason: string, snapshot: ShopSnapshot): boolean {
  if (shop.isVisible || shop.isExplicitlyHidden || !hasShopContent(snapshot)) return false

  shop.isVisible = true
  setShopHiddenAt(null)
  logGep('GEP shop_visible inferred from shop data', { reason })
  return true
}

export function registerShopReroll(changedSlotCount: number, reason: string): void {
  shop.rerollsUsed += 1
  logGep('GEP detection: shop reroll', {
    currentShopRerollsUsed: shop.rerollsUsed,
    changedSlotCount,
    reason,
    isInPlanningPhase: round.isInPlanningPhase,
    phase: getPhaseLabel(),
  })
  validateCurrentRules()
  broadcastState()
}

export function clearPendingShopRerollCandidates(reason: string): void {
  if (pendingRerollCandidates.length === 0) return

  for (const candidate of pendingRerollCandidates) {
    window.clearTimeout(candidate.timeoutId)
  }

  logGep('GEP shop reroll candidates cleared', {
    reason,
    count: pendingRerollCandidates.length,
  })
  pendingRerollCandidates = []
}

// A full shop change outside planning is only a reroll if no automatic refresh signal follows
export function consumePendingShopRerollCandidates(reason: string): void {
  if (pendingRerollCandidates.length === 0) return

  for (const candidate of pendingRerollCandidates) {
    window.clearTimeout(candidate.timeoutId)
  }

  logGep('GEP shop reroll candidate consumed by automatic refresh signal', {
    reason,
    count: pendingRerollCandidates.length,
    candidates: pendingRerollCandidates.map(candidate => ({
      id: candidate.id,
      changedSlotCount: candidate.changedSlotCount,
      previousSnapshot: candidate.previousSnapshot,
      nextSnapshot: candidate.nextSnapshot,
    })),
  })
  pendingRerollCandidates = []
}

function scheduleNonPlanningShopRerollCandidate(
  changedSlotCount: number,
  previousSnapshot: ShopSnapshot,
  nextSnapshot: ShopSnapshot,
): void {
  const id = nextRerollCandidateId
  nextRerollCandidateId += 1

  const timeoutId = window.setTimeout(() => {
    const index = pendingRerollCandidates.findIndex(candidate => candidate.id === id)
    if (index === -1) return

    const [candidate] = pendingRerollCandidates.splice(index, 1)
    registerShopReroll(candidate.changedSlotCount, 'full_champion_shop_changed_non_planning_delayed')
  }, NON_PLANNING_SHOP_REROLL_CONFIRM_DELAY_MS)

  pendingRerollCandidates.push({
    id,
    changedSlotCount,
    previousSnapshot: [...previousSnapshot],
    nextSnapshot: [...nextSnapshot],
    createdAt: Date.now(),
    timeoutId,
  })

  logGep('GEP shop reroll candidate scheduled', {
    id,
    changedSlotCount,
    previousSnapshot,
    nextSnapshot,
    delayMs: NON_PLANNING_SHOP_REROLL_CONFIRM_DELAY_MS,
    isInPlanningPhase: round.isInPlanningPhase,
    phase: 'non_planning',
  })
}

function handleShopPurchase(purchasedSlotIndex: number, snapshot: ShopSnapshot): void {
  shop.baseline = [...snapshot]
  noteShopPurchaseForXpFallback()
  logGep('GEP detection: shop purchase', {
    purchasedSlotIndex,
    isInPlanningPhase: round.isInPlanningPhase,
    phase: getPhaseLabel(),
  })
  const state = deriveState()
  if (state.lockedShopSlots.includes(purchasedSlotIndex) && !slot.trustMode) {
    if (!bonus.activeTraps.shopLock && state.bonusItems.stock.shopSlotPass > 0) {
      // Shop Slot Pass: covers exactly this one purchase
      consumeBonusItem('shopSlotPass')
    } else {
      invalidateRun(`Purchased from locked shop slot ${purchasedSlotIndex}`)
    }
  }
  broadcastState()
}

// Returns true when the change was the expected automatic refresh
function consumeAutomaticRefresh(snapshot: ShopSnapshot, changedSlotCount: number): boolean {
  const automaticRefreshAgeMs = getAutomaticShopRefreshAgeMs()
  const logData = {
    changedSlotCount,
    automaticRefreshAgeMs,
    automaticRefreshGraceMs: AUTOMATIC_SHOP_REFRESH_GRACE_MS,
    isInPlanningPhase: round.isInPlanningPhase,
    phase: getPhaseLabel(),
  }
  clearAutomaticShopRefreshMarker()

  if (automaticRefreshAgeMs !== null && automaticRefreshAgeMs <= AUTOMATIC_SHOP_REFRESH_GRACE_MS) {
    shop.baseline = [...snapshot]
    logGep('GEP round_start: shop auto-refresh consumed; baseline updated', logData)
    broadcastState()
    return true
  }

  logGep('GEP stale automatic shop refresh marker ignored', logData)
  return false
}

export function handleShopUpdate(snapshot: ShopSnapshot): void {
  shop.latest = snapshot
  if (!round.hasSeenPlanningPhaseEvent && !round.isInPlanningPhase) {
    round.isInPlanningPhase = true
    logGep('GEP planning phase inferred from shop update before first phase event')
  }
  const didInferShopVisible = inferShopVisibleFromShopData(
    round.isInPlanningPhase
      ? 'shop_pieces update during planning'
      : 'shop_pieces update outside planning',
    snapshot,
  )
  logGep('GEP shop snapshot', {
    isInPlanningPhase: round.isInPlanningPhase,
    phase: getPhaseLabel(),
    isShopVisible: shop.isVisible,
    isAwaitingUiReturnShopRefresh: shop.isAwaitingUiReturnRefresh,
    isAwaitingAutomaticShopRefresh: shop.isAwaitingAutomaticRefresh,
    automaticRefreshAgeMs: getAutomaticShopRefreshAgeMs(),
    snapshot,
    baseline: shop.baseline,
  })

  const hasChangedFromBaseline = snapshot.some((name, index) => name !== shop.baseline?.[index])

  if (!hasChangedFromBaseline) {
    if (didInferShopVisible) broadcastState()
    return
  }

  const baseline = shop.baseline
  if (!baseline) {
    shop.baseline = [...snapshot]
    clearAutomaticShopRefreshMarker()
    logGep('GEP shop_pieces: baseline initialized', {
      isInPlanningPhase: round.isInPlanningPhase,
      phase: getPhaseLabel(),
    })
    if (didInferShopVisible) broadcastState()
    return
  }

  if (!shop.isVisible) {
    shop.baseline = [...snapshot]
    clearAutomaticShopRefreshMarker()
    shop.isAwaitingUiReturnRefresh = false
    logGep('GEP shop_pieces: changed while shop hidden; baseline updated without reroll count')
    broadcastState()
    return
  }

  const soldSlots = snapshot
    .map((name, index) => ({ name, index }))
    .filter(({ name, index }) => isSold(name) && !isSold(baseline[index] ?? ''))
    .map(({ index }) => index + 1)

  if (soldSlots.length === 1) {
    handleShopPurchase(soldSlots[0], snapshot)
    return
  }

  const changedSlotCount = snapshot.filter((name, index) => name !== baseline[index]).length
  const fullChampionShopChanged = snapshot.every(isChampionShopEntry) && changedSlotCount >= 2
  if (!fullChampionShopChanged) return

  if (!round.isInPlanningPhase && baseline.some(isSold)) {
    shop.baseline = [...snapshot]
    logGep('GEP shop_pieces: sold-slot refill outside planning consumed; baseline updated', {
      changedSlotCount,
      isInPlanningPhase: round.isInPlanningPhase,
      phase: 'non_planning',
    })
    broadcastState()
    return
  }

  if (shop.isAwaitingAutomaticRefresh && consumeAutomaticRefresh(snapshot, changedSlotCount)) return

  if (shop.isAwaitingUiReturnRefresh) {
    shop.isAwaitingUiReturnRefresh = false
    shop.baseline = [...snapshot]
    logGep('GEP UI return shop refresh consumed; baseline updated', {
      changedSlotCount,
      isInPlanningPhase: round.isInPlanningPhase,
      phase: getPhaseLabel(),
    })
    broadcastState()
    return
  }

  shop.baseline = [...snapshot]
  if (!round.isInPlanningPhase) {
    scheduleNonPlanningShopRerollCandidate(changedSlotCount, baseline, snapshot)
    return
  }

  registerShopReroll(changedSlotCount, 'full_champion_shop_changed_planning')
}
