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

interface GoldOnlyXpFallbackCandidate {
  id: number
  previousGold: number
  nextGold: number
  previousXp: XpSnapshot | null
  createdAt: number
  timeoutId: number
}

let pendingGoldDropForXp: { previousXp: XpSnapshot | null } | null = null
let pendingXpGainForGold: { previousGold: number | null } | null = null
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

// Battle start: half-seen XP purchases from planning do not carry over
export function clearPendingXpSignals(): void {
  pendingGoldDropForXp = null
  pendingXpGainForGold = null
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
    && !hasXpIncreased(latestXpReading, previousXp)
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

function cancelOldestGoldOnlyXpFallback(reason: string): void {
  const candidate = goldOnlyFallbacks.shift()
  if (!candidate) return

  window.clearTimeout(candidate.timeoutId)
  logGep('GEP XP gold-only fallback canceled', {
    reason,
    id: candidate.id,
    previousGold: candidate.previousGold,
    nextGold: candidate.nextGold,
  })
}

export function registerXpBuy(reason = 'confirmed_xp_delta', cancelPendingFallback = true): void {
  economy.xpBuysThisRound += 1
  clearPendingXpSignals()
  if (cancelPendingFallback) cancelOldestGoldOnlyXpFallback(reason)
  logGep('GEP detection: XP purchase', {
    currentXpBuysThisRound: economy.xpBuysThisRound,
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

  return goldDelta === XP_PRICE
}

// Purchases, rerolls and multi-slot purchases: any shop action that also spends gold
export function noteShopPurchaseForXpFallback(reason = 'nearby shop purchase'): void {
  const now = Date.now()
  recentShopPurchase = { createdAt: now }

  const candidate = goldOnlyFallbacks[0]
  if (!candidate) return

  if (now - candidate.createdAt <= SHOP_PURCHASE_XP_FALLBACK_SUPPRESSION_MS) {
    cancelOldestGoldOnlyXpFallback(reason)
  }
}

function scheduleGoldOnlyXpFallback(
  previousGold: number,
  nextGold: number,
  previousXp: XpSnapshot | null,
): void {
  const now = Date.now()

  if (consumeRecentShopPurchase(previousGold - nextGold, now)) {
    logGep('GEP XP gold-only fallback skipped', {
      reason: 'nearby shop purchase',
      previousGold,
      nextGold,
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
    pendingGoldDropForXp = null
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
      isInPlanningPhase: round.isInPlanningPhase,
      phase: getPhaseLabel(),
    })
    registerXpBuy('gold_only_four_gold_drop', false)
  }, GOLD_ONLY_XP_FALLBACK_DELAY_MS)

  goldOnlyFallbacks.push({
    id,
    previousGold,
    nextGold,
    previousXp,
    createdAt: now,
    timeoutId,
  })

  logGep('GEP XP gold-only fallback scheduled', {
    id,
    previousGold,
    nextGold,
    previousXp,
    delayMs: GOLD_ONLY_XP_FALLBACK_DELAY_MS,
    isInPlanningPhase: round.isInPlanningPhase,
    phase: getPhaseLabel(),
  })
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

    if (probedXp && hasXpIncreased(probedXp, economy.xp)) {
      economy.xp = probedXp
      if (pendingGoldDropForXp) registerXpBuy()
    }
  })
}

export function handleEconomyUpdate(nextGold: number | null, nextXp: XpSnapshot | null): void {
  const previousGold = economy.gold
  const previousXp = economy.xp

  logGep('GEP economy snapshot', {
    isInPlanningPhase: round.isInPlanningPhase,
    phase: getPhaseLabel(),
    previousGold,
    nextGold,
    previousXp,
    nextXp,
  })

  const goldDelta = nextGold !== null && previousGold !== null ? previousGold - nextGold : null
  const goldDroppedByXpPrice = goldDelta === XP_PRICE
  const xpIncreasedNow = nextXp !== null && hasXpIncreased(nextXp, previousXp)

  if (goldDelta !== null && goldDelta < 0) {
    consumePendingShopRerollCandidates('gold increased')
  }

  if (goldDelta !== null && goldDelta > 0 && goldDelta !== XP_PRICE) {
    consumeRecentShopPurchase(goldDelta, Date.now())
  }

  const goldBeforeXpGain = pendingXpGainForGold?.previousGold
  if (goldDroppedByXpPrice && xpIncreasedNow) {
    registerXpBuy()
  } else if (
    goldDroppedByXpPrice
    && nextGold !== null
    && goldBeforeXpGain !== null
    && goldBeforeXpGain !== undefined
    && goldBeforeXpGain - nextGold === XP_PRICE
  ) {
    registerXpBuy()
  } else if (
    xpIncreasedNow
    && pendingGoldDropForXp
    && nextXp !== null
    && hasXpIncreased(nextXp, pendingGoldDropForXp.previousXp)
  ) {
    registerXpBuy()
  } else {
    if (goldDroppedByXpPrice) {
      pendingGoldDropForXp = { previousXp }
      if (previousGold !== null && nextGold !== null) {
        scheduleGoldOnlyXpFallback(previousGold, nextGold, previousXp)
      }
      probeXpFromGetInfo('gold_dropped_by_four')
    }
    if (xpIncreasedNow) {
      pendingXpGainForGold = { previousGold }
    }
  }

  if (nextGold !== null) economy.gold = nextGold
  if (nextXp !== null) economy.xp = nextXp
  if (nextGold !== null) validateImmediateMinorChecks({ gold: nextGold, isPlayerCombat: round.isPlayerCombat })
}
