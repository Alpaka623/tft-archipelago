// XP purchases: a 4 gold drop together with an XP gain. GEP often reports the two in separate
// updates (or the XP not at all), so either half waits for the other, with a gold-only fallback.
/// <reference types="@overwolf/types" />
import { validateImmediateMinorChecks } from '../archipelago/checks'
import { broadcastState } from '../broadcast'
import { hasXpIncreased, readInfoValueFromRecord, readXpFromRaw, summarizeGepEnvironment, summarizeGetInfoShape } from '../gep-parsing'
import { logGep } from '../log'
import { isRecord, parseMaybeJson, readNumberFromRaw } from '../raw'
import { validateCurrentRules } from '../rules/engine'
import { platform } from '../runtime'
import { economy, round } from '../state'
import type { XpSnapshot } from '../types'
import { consumePendingShopRerollCandidates } from './shop'

const XP_PRICE = 4
const GOLD_ONLY_XP_FALLBACK_DELAY_MS = 1000
const SHOP_PURCHASE_XP_FALLBACK_SUPPRESSION_MS = 1000
const XP_SIGNAL_PAIR_WINDOW_MS = 1500
// Cap unconfirmed gold-only bursts (4/8/12 gold) so an OCR glitch never counts as a huge XP spree
const MAX_GOLD_ONLY_FALLBACK_BUYS = 3

interface GoldOnlyXpFallbackCandidate {
  id: number
  previousGold: number
  nextGold: number
  previousXp: XpSnapshot | null
  buyCount: number
  createdAt: number
  timeoutId: number
}

// Fast XP clicks can merge into 8/12/16 gold drops and +8/+12/+16 XP jumps across 1-2 frames
let pendingGoldDrop: { amount: number; previousXp: XpSnapshot | null; updatedAt: number } | null = null
let pendingXpGain: { buys: number | null; updatedAt: number } | null = null
let goldOnlyFallbacks: GoldOnlyXpFallbackCandidate[] = []
let nextFallbackId = 1
// A 4-cost champion bought right before looks exactly like an XP purchase's gold drop, and so do
// two rerolls or two purchases whose gold reads merged into one 4 gold drop
let recentShopPurchase: { createdAt: number } | null = null
let isProbingXp = false
// Latest XP read by the vision source (null = unreadable); undefined on sources without one
let latestXpReading: XpSnapshot | null | undefined

function getPhaseLabel(): 'planning' | 'non_planning' {
  return round.isInPlanningPhase ? 'planning' : 'non_planning'
}

function expireStalePendingSignals(now: number): void {
  if (pendingGoldDrop && now - pendingGoldDrop.updatedAt > XP_SIGNAL_PAIR_WINDOW_MS) {
    pendingGoldDrop = null
  }
  if (pendingXpGain && now - pendingXpGain.updatedAt > XP_SIGNAL_PAIR_WINDOW_MS) {
    pendingXpGain = null
  }
}

// Exact XP gained when staying on the same level or crossing a single known level cap; null when
// the level jumped further or xp_max is missing
function computeXpGain(current: XpSnapshot, previous: XpSnapshot | null): number | null {
  if (!previous || current.level < previous.level) return null
  if (current.level === previous.level) {
    return current.current_xp > previous.current_xp ? current.current_xp - previous.current_xp : 0
  }
  if (current.level === previous.level + 1 && previous.xp_max !== undefined && previous.xp_max > 0) {
    return Math.max(0, previous.xp_max - previous.current_xp) + current.current_xp
  }
  return null
}

function getXpBuyDelta(current: XpSnapshot | null, previous: XpSnapshot | null): { increased: boolean; exactBuys: number | null } {
  if (!current || !hasXpIncreased(current, previous)) return { increased: false, exactBuys: 0 }
  const gain = computeXpGain(current, previous)
  if (gain === null) return { increased: true, exactBuys: null }
  const buys = Math.floor(gain / XP_PRICE)
  // Passive +2 round XP is smaller than a 4-XP purchase
  return buys > 0 ? { increased: true, exactBuys: buys } : { increased: false, exactBuys: 0 }
}

// Battle start: half-seen XP purchases from planning do not carry over
export function clearPendingXpSignals(): void {
  pendingGoldDrop = null
  pendingXpGain = null
}

export function resetXpDetection(reason: string): void {
  clearPendingXpSignals()
  clearGoldOnlyXpFallbacks(reason)
  recentShopPurchase = null
  latestXpReading = undefined
}

// Vision only: a readable XP counter decides the fallback, so the gold drop alone is not enough
export function noteXpReading(xp: XpSnapshot | null): void {
  latestXpReading = xp
}

// An XP gain would already have been paired with the gold drop
function isXpReadableAndUnchanged(previousXp: XpSnapshot | null): boolean {
  return latestXpReading !== undefined
    && latestXpReading !== null
    && previousXp !== null
    && !getXpBuyDelta(latestXpReading, previousXp).increased
}

function clearGoldOnlyXpFallbacks(reason: string): void {
  if (goldOnlyFallbacks.length === 0) return

  for (const candidate of goldOnlyFallbacks) {
    window.clearTimeout(candidate.timeoutId)
  }

  logGep('GEP XP gold-only fallback candidates cleared', {
    reason,
    count: goldOnlyFallbacks.length,
  })
  goldOnlyFallbacks = []
}

function cancelGoldOnlyXpFallbacks(reason: string, buyCount = 1): void {
  let remaining = buyCount
  while (remaining > 0 && goldOnlyFallbacks.length > 0) {
    const candidate = goldOnlyFallbacks[0]
    if (candidate.buyCount <= remaining) {
      goldOnlyFallbacks.shift()
      window.clearTimeout(candidate.timeoutId)
      remaining -= candidate.buyCount
      logGep('GEP XP gold-only fallback canceled', {
        reason,
        id: candidate.id,
        previousGold: candidate.previousGold,
        nextGold: candidate.nextGold,
        buyCount: candidate.buyCount,
      })
    } else {
      candidate.buyCount -= remaining
      logGep('GEP XP gold-only fallback reduced', {
        reason,
        id: candidate.id,
        remainingBuyCount: candidate.buyCount,
      })
      remaining = 0
    }
  }
}

export function registerXpBuy(reason = 'confirmed_xp_delta', cancelPendingFallback = true, count = 1): void {
  if (count <= 0) return
  economy.xpBuysThisRound += count
  if (cancelPendingFallback) cancelGoldOnlyXpFallbacks(reason, count)
  logGep('GEP detection: XP purchase', {
    currentXpBuysThisRound: economy.xpBuysThisRound,
    count,
    reason,
    isInPlanningPhase: round.isInPlanningPhase,
    phase: getPhaseLabel(),
  })
  validateCurrentRules()
  broadcastState()
}

function consumeRecentShopPurchase(goldDelta: number, now: number): boolean {
  const purchase = recentShopPurchase
  if (!purchase) return false

  if (now - purchase.createdAt > SHOP_PURCHASE_XP_FALLBACK_SUPPRESSION_MS) {
    recentShopPurchase = null
    return false
  }

  if (goldDelta > 0) {
    recentShopPurchase = null
  }

  return goldDelta >= XP_PRICE && goldDelta % XP_PRICE === 0
}

// Purchases, rerolls and multi-slot purchases: any shop action that also spends gold
export function noteShopPurchaseForXpFallback(reason = 'nearby shop purchase'): void {
  const now = Date.now()
  recentShopPurchase = { createdAt: now }

  const candidate = goldOnlyFallbacks[0]
  if (!candidate) return

  if (now - candidate.createdAt <= SHOP_PURCHASE_XP_FALLBACK_SUPPRESSION_MS) {
    cancelGoldOnlyXpFallbacks(reason, candidate.buyCount)
  }
}

function scheduleGoldOnlyXpFallback(
  previousGold: number,
  nextGold: number,
  previousXp: XpSnapshot | null,
  buyCount: number,
): void {
  const now = Date.now()

  if (consumeRecentShopPurchase(previousGold - nextGold, now)) {
    logGep('GEP XP gold-only fallback skipped', {
      reason: 'nearby shop purchase',
      previousGold,
      nextGold,
      buyCount,
      isInPlanningPhase: round.isInPlanningPhase,
      phase: getPhaseLabel(),
    })
    return
  }

  const id = nextFallbackId
  nextFallbackId += 1

  const timeoutId = window.setTimeout(() => {
    const index = goldOnlyFallbacks.findIndex(candidate => candidate.id === id)
    if (index === -1) return

    const [candidate] = goldOnlyFallbacks.splice(index, 1)
    if (pendingGoldDrop) {
      pendingGoldDrop.amount = Math.max(0, pendingGoldDrop.amount - candidate.buyCount * XP_PRICE)
      if (pendingGoldDrop.amount < XP_PRICE) pendingGoldDrop = null
    }
    if (isXpReadableAndUnchanged(candidate.previousXp)) {
      logGep('GEP XP gold-only fallback skipped', {
        reason: 'XP readable and unchanged',
        id: candidate.id,
        previousGold: candidate.previousGold,
        nextGold: candidate.nextGold,
        previousXp: candidate.previousXp,
        latestXp: latestXpReading,
      })
      return
    }
    logGep('GEP XP gold-only fallback confirmed', {
      id: candidate.id,
      previousGold: candidate.previousGold,
      nextGold: candidate.nextGold,
      previousXp: candidate.previousXp,
      buyCount: candidate.buyCount,
      isInPlanningPhase: round.isInPlanningPhase,
      phase: getPhaseLabel(),
    })
    registerXpBuy('gold_only_four_gold_drop', false, candidate.buyCount)
  }, GOLD_ONLY_XP_FALLBACK_DELAY_MS)

  goldOnlyFallbacks.push({
    id,
    previousGold,
    nextGold,
    previousXp,
    buyCount,
    createdAt: now,
    timeoutId,
  })

  logGep('GEP XP gold-only fallback scheduled', {
    id,
    previousGold,
    nextGold,
    previousXp,
    buyCount,
    delayMs: GOLD_ONLY_XP_FALLBACK_DELAY_MS,
    isInPlanningPhase: round.isInPlanningPhase,
    phase: getPhaseLabel(),
  })
}

function pairPendingXpSignals(reason = 'confirmed_xp_delta'): number {
  if (!pendingGoldDrop || !pendingXpGain) return 0

  const goldBuys = Math.floor(pendingGoldDrop.amount / XP_PRICE)
  if (goldBuys <= 0) return 0

  const matchedBuys = pendingXpGain.buys === null ? goldBuys : Math.min(goldBuys, pendingXpGain.buys)
  if (matchedBuys <= 0) return 0

  pendingGoldDrop.amount -= matchedBuys * XP_PRICE
  if (pendingGoldDrop.amount < XP_PRICE) pendingGoldDrop = null

  if (pendingXpGain.buys === null || pendingXpGain.buys <= matchedBuys) {
    pendingXpGain = null
  } else {
    pendingXpGain.buys -= matchedBuys
  }

  registerXpBuy(reason, true, matchedBuys)
  return matchedBuys
}

// GEP-only probe; the Electron vision source reports XP directly
function probeXpFromGetInfo(reason: string): void {
  if (platform.kind !== 'overwolf' || isProbingXp) return
  isProbingXp = true

  overwolf.games.events.getInfo((result) => {
    isProbingXp = false

    if (!result.success) {
      console.warn('GEP XP probe getInfo failed:', result.error)
      return
    }

    const info = result.res
    const goldRaw = readInfoValueFromRecord(info, 'me', 'gold')
    const xpRaw = readInfoValueFromRecord(info, 'me', 'xp')
    const meRaw = readInfoValueFromRecord(info, 'me', 'me')
    const parsedMe = parseMaybeJson(meRaw)
    const probedXp = readXpFromRaw(xpRaw) ?? readXpFromRaw(meRaw)

    logGep('GEP XP probe', {
      reason,
      shape: summarizeGetInfoShape(info),
      environment: summarizeGepEnvironment(info),
      gold: readNumberFromRaw(goldRaw),
      xp: probedXp,
      rawXpPresent: xpRaw !== undefined && xpRaw !== null && xpRaw !== '',
      meKeys: isRecord(parsedMe) ? Object.keys(parsedMe) : [],
    })

    const xpDelta = getXpBuyDelta(probedXp, economy.xp)
    if (probedXp && xpDelta.increased) {
      economy.xp = probedXp
      if (pendingGoldDrop) {
        pendingXpGain = { buys: xpDelta.exactBuys, updatedAt: Date.now() }
        pairPendingXpSignals('confirmed_xp_probe')
      }
    }
  })
}

export function handleEconomyUpdate(nextGold: number | null, nextXp: XpSnapshot | null): void {
  const previousGold = economy.gold
  const previousXp = economy.xp
  const now = Date.now()
  expireStalePendingSignals(now)

  logGep('GEP economy snapshot', {
    isInPlanningPhase: round.isInPlanningPhase,
    phase: getPhaseLabel(),
    previousGold,
    nextGold,
    previousXp,
    nextXp,
  })

  const goldDelta = nextGold !== null && previousGold !== null ? previousGold - nextGold : null
  const xpDelta = getXpBuyDelta(nextXp, previousXp)

  if (goldDelta !== null && goldDelta < 0) {
    consumePendingShopRerollCandidates('gold increased')
  }

  if (goldDelta !== null && goldDelta > 0 && goldDelta % XP_PRICE !== 0) {
    consumeRecentShopPurchase(goldDelta, now)
  }

  if (goldDelta !== null && goldDelta > 0) {
    if (pendingGoldDrop) {
      pendingGoldDrop.amount += goldDelta
      pendingGoldDrop.updatedAt = now
    } else {
      pendingGoldDrop = { amount: goldDelta, previousXp, updatedAt: now }
    }
  }

  if (xpDelta.increased) {
    if (pendingXpGain) {
      pendingXpGain.buys = pendingXpGain.buys === null || xpDelta.exactBuys === null
        ? null
        : pendingXpGain.buys + xpDelta.exactBuys
      pendingXpGain.updatedAt = now
    } else {
      pendingXpGain = { buys: xpDelta.exactBuys, updatedAt: now }
    }
  }

  const matchedBuys = pairPendingXpSignals()
  const unmatchedGoldThisUpdate = goldDelta !== null && goldDelta > 0
    ? Math.max(0, goldDelta - matchedBuys * XP_PRICE)
    : 0

  if (
    unmatchedGoldThisUpdate >= XP_PRICE
    && unmatchedGoldThisUpdate % XP_PRICE === 0
    && previousGold !== null
    && nextGold !== null
  ) {
    const fallbackBuys = unmatchedGoldThisUpdate / XP_PRICE
    if (fallbackBuys <= MAX_GOLD_ONLY_FALLBACK_BUYS) {
      scheduleGoldOnlyXpFallback(previousGold, nextGold, previousXp, fallbackBuys)
    }
    if (unmatchedGoldThisUpdate === XP_PRICE) {
      probeXpFromGetInfo('gold_dropped_by_four')
    }
  }

  if (nextGold !== null) economy.gold = nextGold
  if (nextXp !== null) economy.xp = nextXp
  if (nextGold !== null) validateImmediateMinorChecks({ gold: nextGold, isPlayerCombat: round.isPlayerCombat })
}
