// Feeds HUD reads from the vision window into the same detection paths as GEP.
// No battle phase detection, so everything runs through the planning-phase paths.
import { validateImmediateMinorChecks } from '../archipelago/checks'
import { broadcastState } from '../broadcast'
import { clearAugmentPhase, registerAugmentReroll } from '../detection/augments'
import { handleRoundStart } from '../detection/match'
import {
  SHOP_SLOT_COUNT,
  handleShopUpdate,
  handleShopVisibleUpdate,
  isSold,
  markAwaitingAutomaticShopRefresh,
} from '../detection/shop'
import { handleEconomyUpdate } from '../detection/xp'
import { logGep } from '../log'
import { platform } from '../runtime'
import { augments, economy, session, shop } from '../state'
import type { VisionGameState } from '../../types/vision'
import type { XpSnapshot } from '../types'

// wait for a possible stage label change before treating a full shop change as a reroll
const SHOP_ROUND_START_WAIT_MS = 800
// rerolls replace ~all five cards, smaller changes are animations (wisps, refills)
const MIN_FULL_CHANGE_SLOTS = 4
// full changes this soon after a new round are the auto refresh (measured ~0.9 s after the label)
const ROUND_REFRESH_WINDOW_MS = 3000
// empty slot = purchase only if gold drops in this window (Set 18 wisp slots look empty too)
const PURCHASE_GOLD_WINDOW_MS = 1500
// ...and the slot has to stay empty; cards dim briefly on XP buys, which also cost 4 gold
const PURCHASE_CONFIRM_MS = 500
// HUD fades back in after a layout change, so wait for a stable shop before re-baselining
const LAYOUT_SETTLE_MS = 1500
// augment cards fly in and flip on reroll, only compare once they settle
const AUGMENT_INTRO_MS = 1500
const AUGMENT_SETTLE_MS = 1000
const AUGMENT_REROLL_SETTLE_MS = 600
// the pick animation looks like a one-card reroll, so the screen has to stay open this long
const AUGMENT_REROLL_CONFIRM_MS = 1200
// grace for missed "Choose One" reads (shop coming back closes it right away)
const AUGMENT_CLOSE_GRACE_MS = 2000
// shorter grace when the header is clearly gone, not just misread
const AUGMENT_CLOSE_FAST_MS = 300

// unreadable while the augment screen dims the HUD
let lastKnownStage: string | null = null
let latestGameState: VisionGameState | null = null

// region layout moved -> next settled shop snapshot becomes the baseline
let layoutResyncPending = false
let layoutChangedAt = 0
let resyncCandidateKey = ''
let resyncCandidateSince = 0
let resyncTimeoutId: number | null = null

let lastDeliveredShopSnapshot: string[] | null = null
let pendingShopSnapshot: string[] | null = null
let pendingShopTimeoutId: number | null = null
let roundStartedAt: number | null = null
let pendingPurchase: { snapshot: string[]; createdAt: number } | null = null
let pendingPurchaseTimeoutId: number | null = null
let lastIgnoredShopKey = ''
let goldHistory: { at: number; gold: number }[] = []
// gold reads before this were already used to confirm a purchase
let goldConsumedUntil = 0
let lastXpMax: number | null = null
let level = 1

let augmentBaseline: string[] | null = null
let augmentOpenedAt = 0
let augmentLatestCards: string[] | null = null
let augmentLastChangeAt = 0
let augmentSettleTimeoutId: number | null = null
let augmentCloseTimeoutId: number | null = null
let augmentRerollConfirmTimeoutId: number | null = null
let pendingAugmentRerolls = 0
let isAugmentFastClosePending = false

function clearTimer(timeoutId: number | null): null {
  if (timeoutId !== null) window.clearTimeout(timeoutId)
  return null
}

export function getLatestVisionGameState(): VisionGameState | null {
  return latestGameState
}

export function getPendingVisionAugmentRerolls(): number {
  return pendingAugmentRerolls
}

export function resetVisionSourceState(): void {
  pendingShopTimeoutId = clearTimer(pendingShopTimeoutId)
  pendingShopSnapshot = null
  lastDeliveredShopSnapshot = null
  lastKnownStage = null
  layoutResyncPending = false
  resyncTimeoutId = clearTimer(resyncTimeoutId)
  latestGameState = null
  resetAugmentTracking()
  roundStartedAt = null
  pendingPurchase = null
  goldHistory = []
  goldConsumedUntil = 0
  lastXpMax = null
  level = 1
}

function isCompleteShopSnapshot(snapshot: string[]): boolean {
  return snapshot.length === SHOP_SLOT_COUNT && snapshot.every(entry => entry !== '')
}

function countChangedShopSlots(snapshot: string[], reference: string[] | null): number {
  return snapshot.filter((entry, index) => entry !== reference?.[index]).length
}

function deliverShopSnapshot(snapshot: string[], isConfirmedPurchase = false): void {
  // Only a gold-confirmed single slot may reach the engine as a newly sold slot. Inside any
  // other change (refresh, round start) an empty-looking slot is a wisp; keep the old card
  // there so the engine sees a plain shop change instead of a purchase.
  if (!isConfirmedPurchase && shop.baseline && shop.isVisible) {
    const baseline = shop.baseline
    const maskedSlots = snapshot
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => isSold(entry) && !isSold(baseline[index] ?? ''))
      .map(({ index }) => index + 1)
    if (maskedSlots.length) {
      snapshot = snapshot.map((entry, index) => (maskedSlots.includes(index + 1) ? baseline[index] : entry))
      logGep('Vision shop: empty-looking slot in an unconfirmed change kept as before (wisp)', { maskedSlots })
    }
  }
  // keep the masked version so buying the champion behind a wisp is still a single-slot change
  lastDeliveredShopSnapshot = [...snapshot]

  // auto refresh after round start, even if wisps made the engine think it already refreshed
  const isFullChange = countChangedShopSlots(snapshot, shop.baseline) >= MIN_FULL_CHANGE_SLOTS
  if (isFullChange && roundStartedAt !== null && Date.now() - roundStartedAt <= ROUND_REFRESH_WINDOW_MS) {
    markAwaitingAutomaticShopRefresh()
  }

  handleShopUpdate([...snapshot])
}

function recordGold(gold: number | null): void {
  if (gold === null) return
  const now = Date.now()
  goldHistory = [...goldHistory.filter(entry => now - entry.at <= PURCHASE_GOLD_WINDOW_MS * 2), { at: now, gold }]
}

function hasGoldDroppedSince(since: number): boolean {
  const readings = goldHistory.filter(entry => (
    entry.at >= since - PURCHASE_GOLD_WINDOW_MS && entry.at >= goldConsumedUntil
  ))
  return readings.some((entry, index) => readings.slice(index + 1).some(later => later.gold < entry.gold))
}

// isPersisted: a later snapshot kept the slot empty (e.g. a second purchase right after)
function resolvePendingPurchase(isPersisted = false): void {
  if (!pendingPurchase) return

  const { snapshot, createdAt } = pendingPurchase
  if (hasGoldDroppedSince(createdAt)) {
    const confirmInMs = createdAt + PURCHASE_CONFIRM_MS - Date.now()
    if (!isPersisted && confirmInMs > 0) {
      if (pendingPurchaseTimeoutId === null) {
        pendingPurchaseTimeoutId = window.setTimeout(() => {
          pendingPurchaseTimeoutId = null
          resolvePendingPurchase()
        }, confirmInMs)
      }
      return
    }
    pendingPurchase = null
    goldConsumedUntil = goldHistory[goldHistory.length - 1]?.at ?? Date.now()
    deliverShopSnapshot(snapshot, true)
    return
  }

  if (Date.now() - createdAt > PURCHASE_GOLD_WINDOW_MS) {
    pendingPurchase = null
    // don't re-queue it, the engine baseline keeps the old card
    lastDeliveredShopSnapshot = [...snapshot]
    logGep('Vision shop: slot looked empty without a gold drop; not a purchase', { snapshot })
  }
}

function keepsPendingPurchaseSlotEmpty(snapshot: string[], pendingSnapshot: string[]): boolean {
  const reference = lastDeliveredShopSnapshot ?? shop.baseline
  if (!reference) return false
  return pendingSnapshot.every((entry, index) => entry === reference[index] || !isSold(entry) || isSold(snapshot[index]))
}

function isSinglePurchaseCandidate(snapshot: string[]): boolean {
  const reference = lastDeliveredShopSnapshot ?? shop.baseline
  if (!reference) return false
  const changed = snapshot.map((entry, index) => ({ entry, index })).filter(({ entry, index }) => entry !== reference[index])
  return changed.length === 1 && isSold(changed[0].entry)
}

function flushPendingShopSnapshot(): void {
  pendingShopTimeoutId = clearTimer(pendingShopTimeoutId)
  const pending = pendingShopSnapshot
  pendingShopSnapshot = null
  if (pending) deliverShopSnapshot(pending)
}

function handleShopSnapshot(snapshot: string[]): void {
  if (!isCompleteShopSnapshot(snapshot)) return
  if (pendingPurchase && !countChangedShopSlots(snapshot, pendingPurchase.snapshot)) return
  if (pendingPurchase && keepsPendingPurchaseSlotEmpty(snapshot, pendingPurchase.snapshot)) {
    // second purchase while the first was unconfirmed -> first one persisted
    resolvePendingPurchase(true)
  } else if (pendingPurchase) {
    logGep('Vision shop: empty slot did not persist; not a purchase', { pending: pendingPurchase.snapshot, snapshot })
    pendingPurchase = null
  }
  if (!countChangedShopSlots(snapshot, pendingShopSnapshot ?? lastDeliveredShopSnapshot)) return

  if (isSinglePurchaseCandidate(snapshot)) {
    pendingPurchase = { snapshot: [...snapshot], createdAt: Date.now() }
    resolvePendingPurchase()
    return
  }
  pendingPurchase = null

  const changedFromBaseline = shop.baseline === null ? SHOP_SLOT_COUNT : countChangedShopSlots(snapshot, shop.baseline)
  if (changedFromBaseline === 0) {
    lastDeliveredShopSnapshot = [...snapshot]
    return
  }
  if (changedFromBaseline < MIN_FULL_CHANGE_SLOTS) {
    const ignoredKey = snapshot.join('|')
    if (ignoredKey !== lastIgnoredShopKey) {
      lastIgnoredShopKey = ignoredKey
      logGep('Vision shop: partial change ignored (animation)', { snapshot, baseline: shop.baseline })
    }
    return
  }

  // the stage label can lag behind the round's auto refresh, so let round start run first
  if (shop.baseline !== null) {
    pendingShopSnapshot = [...snapshot]
    pendingShopTimeoutId ??= window.setTimeout(flushPendingShopSnapshot, SHOP_ROUND_START_WAIT_MS)
    return
  }

  flushPendingShopSnapshot()
  deliverShopSnapshot(snapshot)
}

function handleEconomy(state: VisionGameState): void {
  let xp: XpSnapshot | null = null
  if (state.xp) {
    // XP counter has no level, a bigger cap means we leveled
    if (lastXpMax !== null && state.xp.max > lastXpMax) level++
    lastXpMax = state.xp.max
    xp = { level, current_xp: state.xp.current, xp_max: state.xp.max }
  }

  const goldChanged = state.gold !== null && state.gold !== economy.gold
  const xpChanged = xp !== null && (economy.xp === null || xp.level !== economy.xp.level || xp.current_xp !== economy.xp.current_xp)
  if (goldChanged || xpChanged) handleEconomyUpdate(goldChanged ? state.gold : null, xpChanged ? xp : null)
}

function cancelPendingAugmentRerolls(reason: string): void {
  augmentRerollConfirmTimeoutId = clearTimer(augmentRerollConfirmTimeoutId)
  if (pendingAugmentRerolls > 0) {
    logGep('Vision augments: pending card change discarded (augment picked)', { pendingVisionAugmentRerolls: pendingAugmentRerolls, reason })
    pendingAugmentRerolls = 0
    broadcastState()
  }
}

function confirmPendingAugmentRerolls(): void {
  augmentRerollConfirmTimeoutId = null
  const count = pendingAugmentRerolls
  pendingAugmentRerolls = 0
  if (!augments.isPhaseActive || latestGameState?.augmentScreenVisible !== true) {
    if (count > 0) logGep('Vision augments: pending card change discarded (screen closing)', { count })
    broadcastState()
    return
  }
  for (let index = 0; index < count; index++) registerAugmentReroll('vision_single_card_changed')
}

function resetAugmentTracking(): void {
  augmentSettleTimeoutId = clearTimer(augmentSettleTimeoutId)
  cancelPendingAugmentRerolls('augment tracking reset')
  augmentBaseline = null
  augmentLatestCards = null
  augmentOpenedAt = 0
  augmentLastChangeAt = 0
}

function evaluateAugmentCards(): void {
  augmentSettleTimeoutId = null
  const cards = augmentLatestCards
  if (!augments.isPhaseActive || !cards) return

  const now = Date.now()
  const settleMs = augmentBaseline ? AUGMENT_REROLL_SETTLE_MS : AUGMENT_SETTLE_MS
  const waitMs = Math.max(
    settleMs - (now - augmentLastChangeAt),
    augmentBaseline ? 0 : AUGMENT_INTRO_MS - (now - augmentOpenedAt),
  )
  if (waitMs > 0) {
    augmentSettleTimeoutId = window.setTimeout(evaluateAugmentCards, waitMs)
    return
  }

  if (!augmentBaseline) {
    augmentBaseline = cards
    logGep('Vision augments: card baseline settled', { cards })
    return
  }

  const changedCards = cards.filter((card, index) => card !== augmentBaseline?.[index]).length
  if (changedCards === 0) return
  augmentBaseline = cards
  // UE5 rerolls one card per click, more at once is a transition
  if (changedCards === 1) {
    // confirmed later, the pick animation looks the same
    pendingAugmentRerolls++
    clearTimer(augmentRerollConfirmTimeoutId)
    augmentRerollConfirmTimeoutId = window.setTimeout(confirmPendingAugmentRerolls, AUGMENT_REROLL_CONFIRM_MS)
    broadcastState()
  } else {
    logGep('Vision augments: multiple cards changed; baseline updated without reroll', { changedCards })
  }
}

function cancelAugmentClose(): void {
  augmentCloseTimeoutId = clearTimer(augmentCloseTimeoutId)
  isAugmentFastClosePending = false
}

function closeAugmentPhase(reason: string): void {
  cancelAugmentClose()
  resetAugmentTracking()
  clearAugmentPhase(reason)
}

function handleAugments(state: VisionGameState): void {
  if (state.augmentScreenVisible === true) {
    cancelAugmentClose()
    if (!augments.isPhaseActive) {
      resetAugmentTracking()
      augments.isPhaseActive = true
      augmentOpenedAt = Date.now()
      logGep('Vision augments: augment screen visible')
      broadcastState()
    }

    const cards = state.augmentCards.length === 3 && state.augmentCards.every(Boolean) ? state.augmentCards : null
    if (!cards) return
    if (!augmentLatestCards || cards.some((card, index) => card !== augmentLatestCards?.[index])) {
      augmentLatestCards = cards
      augmentLastChangeAt = Date.now()
    }
    if (augmentSettleTimeoutId === null) evaluateAugmentCards()
    return
  }

  if (state.augmentScreenVisible !== false || !augments.isPhaseActive) return

  // header fading out -> that card change was the pick animation
  cancelPendingAugmentRerolls('augment header missing')
  if (state.shopVisible === true) {
    closeAugmentPhase('vision augment screen closed; shop visible')
    return
  }

  // one missed header read must not drop the blockers
  const isFastClose = state.augmentHeaderGone === true
  if (augmentCloseTimeoutId !== null && (isAugmentFastClosePending || !isFastClose)) return
  cancelAugmentClose()
  isAugmentFastClosePending = isFastClose
  augmentCloseTimeoutId = window.setTimeout(() => {
    augmentCloseTimeoutId = null
    isAugmentFastClosePending = false
    if (augments.isPhaseActive && latestGameState?.augmentScreenVisible !== true) {
      closeAugmentPhase(isFastClose ? 'vision augment screen closed; header gone' : 'vision augment screen closed')
    }
  }, isFastClose ? AUGMENT_CLOSE_FAST_MS : AUGMENT_CLOSE_GRACE_MS)
}

export function handleVisionLayoutChanged(): void {
  // new alignment/resolution: fingerprints changed without any game action
  layoutResyncPending = true
  layoutChangedAt = Date.now()
  resyncTimeoutId = clearTimer(resyncTimeoutId)
  resyncCandidateKey = ''
  resyncCandidateSince = 0
  lastKnownStage = null
  pendingShopTimeoutId = clearTimer(pendingShopTimeoutId)
  pendingShopSnapshot = null
  pendingPurchase = null
  augmentBaseline = null
  augmentLatestCards = null
  cancelPendingAugmentRerolls('vision layout changed')
  logGep('Vision layout changed: next shop snapshot resyncs the baseline')
}

function trySettleLayoutResync(state: VisionGameState): boolean {
  if (state.shopVisible !== true || !isCompleteShopSnapshot(state.shopSnapshot)) return false

  const now = Date.now()
  const candidateKey = state.shopSnapshot.join('|')
  if (candidateKey !== resyncCandidateKey) {
    resyncCandidateKey = candidateKey
    resyncCandidateSince = now
  }
  const settled = now - resyncCandidateSince >= LAYOUT_SETTLE_MS && now - layoutChangedAt >= LAYOUT_SETTLE_MS
  if (!settled) {
    if (resyncTimeoutId === null) {
      const waitMs = Math.max(
        LAYOUT_SETTLE_MS - (now - resyncCandidateSince),
        LAYOUT_SETTLE_MS - (now - layoutChangedAt),
      )
      resyncTimeoutId = window.setTimeout(() => {
        resyncTimeoutId = null
        if (latestGameState) handleVisionGameState(latestGameState)
      }, waitMs + 20)
    }
    return false
  }

  layoutResyncPending = false
  shop.baseline = [...state.shopSnapshot]
  shop.latest = [...state.shopSnapshot]
  lastDeliveredShopSnapshot = [...state.shopSnapshot]
  lastKnownStage = state.stageFingerprint
  logGep('Vision layout changed: shop baseline resynced', { snapshot: state.shopSnapshot })
  return true
}

export function handleVisionGameState(state: VisionGameState): void {
  if (platform.kind === 'overwolf') return
  latestGameState = state

  // level never drops mid-match, a lower read is a misread or the next game
  if (session.isTftRunning && state.level !== null && (economy.level === null || state.level > economy.level)) {
    economy.level = state.level
    logGep('Vision level changed', { level: state.level })
    validateImmediateMinorChecks()
  }

  if (layoutResyncPending && !trySettleLayoutResync(state)) {
    // HUD still fading in, only trust shop visibility
    if (state.shopVisible !== null && state.shopVisible !== shop.isVisible) handleShopVisibleUpdate(state.shopVisible)
    recordGold(state.gold)
    handleEconomy(state)
    handleAugments(state)
    return
  }

  if (state.stageFingerprint) {
    const isNewRound = lastKnownStage !== null && state.stageFingerprint !== lastKnownStage
    lastKnownStage = state.stageFingerprint
    if (isNewRound) {
      logGep('Vision round start: stage label changed')
      handleRoundStart()
      roundStartedAt = Date.now()
      flushPendingShopSnapshot()
    }
  }

  if (state.shopVisible === true && !shop.isVisible) {
    // sync changes from while the shop was hidden (augments, carousel) first
    if (isCompleteShopSnapshot(state.shopSnapshot)) {
      flushPendingShopSnapshot()
      deliverShopSnapshot(state.shopSnapshot)
    }
    handleShopVisibleUpdate(true)
  } else if (state.shopVisible === false && shop.isVisible) {
    flushPendingShopSnapshot()
    handleShopVisibleUpdate(false)
  } else if (state.shopVisible === true) {
    handleShopSnapshot(state.shopSnapshot)
  }

  recordGold(state.gold)
  resolvePendingPurchase()
  handleEconomy(state)
  handleAugments(state)
}
