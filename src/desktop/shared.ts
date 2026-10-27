import { LOCATION_CHECKS, MAJOR_LOCATION_CHECKS, type LocationCheck } from '../data/locations'
import traitsData from '../data/traits.json'
import tftIcons from '../data/tft-icons.json'
import { BACKGROUND_WINDOW_ID, platform } from '../platform'
import type { AppState, PinnedCheck } from '../types/state'

export type PageId = 'setup' | 'overview' | 'unlocks' | 'checks' | 'activity' | 'faq' | 'debug' | 'vision'

export const MAX_PINNED_CHECKS = 3

// Developer pages (Debug, Vision) stay hidden until FAQ is clicked this many times in a row
export const DEVELOPER_MODE_CLICKS = 10
export const DEVELOPER_MODE_CLICK_GAP_MS = 1500
const DEVELOPER_MODE_STORAGE_KEY = 'tft-archipelago-developer-mode'

export function readDeveloperMode(): boolean {
  try {
    return window.localStorage.getItem(DEVELOPER_MODE_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeDeveloperMode(enabled: boolean): void {
  try {
    window.localStorage.setItem(DEVELOPER_MODE_STORAGE_KEY, String(enabled))
  } catch {
    // Storage can be unavailable; the mode then lasts for this session only
  }
}

export { UNLIMITED, formatLimit } from '../shared/app-state'

const championCosts = (traitsData as { championCosts?: Record<string, number> }).championCosts ?? {}
const championNames = (traitsData as { championNames?: Record<string, string> }).championNames ?? {}
const championIcons: Record<string, string> = tftIcons.champions
const traitIcons: Record<string, string> = tftIcons.traits

export function sendConnect(hostname: string, port: number, slotName: string, password: string): void {
  platform?.sendMessage(BACKGROUND_WINDOW_ID, 'CONNECT', { hostname, port, slotName, password })
}

export function sendOverrideViolation(): void {
  platform?.sendMessage(BACKGROUND_WINDOW_ID, 'OVERRIDE_VIOLATION', {})
}

export function sendPinnedChecks(checks: PinnedCheck[]): void {
  platform?.sendMessage(BACKGROUND_WINDOW_ID, 'SET_PINNED_CHECKS', { checks })
}

export function toPinnedCheck(check: LocationCheck): PinnedCheck {
  return { id: check.id, name: check.name, category: check.category }
}

const majorIds = new Set(MAJOR_LOCATION_CHECKS.map(check => check.id))

// A major counts as done only once the player completed it; one marked by another player's collect
// stays open, since completing it still counts toward the goal
export function getDoneCheckIds(state: AppState): Set<number> {
  return new Set([
    ...state.checkedLocationIds.filter(id => !majorIds.has(id)),
    ...state.completedMajorLocationIds,
  ])
}

export function togglePinnedCheck(state: AppState, check: LocationCheck): void {
  if (state.lockedMajorLocationIds.includes(check.id) || getDoneCheckIds(state).has(check.id)) return

  const isPinned = state.pinnedChecks.some(pinnedCheck => pinnedCheck.id === check.id)
  if (!isPinned && state.pinnedChecks.length >= MAX_PINNED_CHECKS) return

  sendPinnedChecks(isPinned
    ? state.pinnedChecks.filter(pinnedCheck => pinnedCheck.id !== check.id)
    : [...state.pinnedChecks, toPinnedCheck(check)])
}

export function connectionLabel(status: AppState['connectionStatus']): string {
  switch (status) {
    case 'connecting':
      return 'Connecting'
    case 'connected':
      return 'Connected'
    case 'error':
      return 'Connection error'
    case 'disconnected':
      return 'Disconnected'
  }
}

export function percent(value: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
}

export function isChampionStarCheck(check: LocationCheck): boolean {
  const condition = check.condition
  return check.category === 'minor'
    && condition.type === 'champion'
    && (condition.minimumStarLevel === 2 || condition.minimumStarLevel === 3)
}

export function getChampionCost(championId: string): number {
  return championCosts[championId] ?? 0
}

export function getChampionName(championId: string): string {
  return championNames[championId] ?? championId
}

export function getChampionIcon(championId: string): string | null {
  return championIcons[championId] ?? null
}

export function getTraitIcon(traitName: string): string | null {
  return traitIcons[traitName] ?? null
}

// "Reach Top 4 with 4 Brawler active" -> "4 Brawler", "Reach Top 4 with Ashe on your board" -> "Ashe"
export function getMajorLabel(check: LocationCheck): string {
  const condition = check.condition
  if (condition.type === 'trait') return `${condition.minimumActive} ${condition.trait}`
  if (condition.type === 'champion') return getChampionName(condition.championId)
  return check.name
}

export const CHAMPION_STAR_CHECKS = LOCATION_CHECKS.filter(isChampionStarCheck)
export const OTHER_MINOR_CHECKS = LOCATION_CHECKS.filter(check => check.category === 'minor' && !isChampionStarCheck(check))
