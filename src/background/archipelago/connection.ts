// Login to the Archipelago server, automatic reconnects and the server's event listeners
import type { LocationCategory } from '../../data/locations'
import type { PinnedCheck } from '../../types/state'
import { getErrorMessage, isMajorLocationUnlocked } from '../app-state'
import { broadcastState } from '../broadcast'
import { isRecord, readNumberFromRaw } from '../raw'
import { loadBonusUsage } from '../rules/bonus-usage'
import { validateCurrentRules } from '../rules/engine'
import { client } from '../runtime'
import {
  DEFAULT_GOAL_CHECKS,
  connection,
  defaultMajorUnlockOrderLocationIds,
  defaultStartingMajorLocationIds,
  locationChecksById,
  majorLocationIds,
  slot,
} from '../state'
import { flushPendingChecks, maybeReportGoal } from './checks'
import {
  consumeItemNotificationSuppression,
  notifyGlobalItemSent,
  notifyHint,
  notifyItemsReceived,
  suppressInitialItemNotifications,
} from './notifications'

const AP_GAME_NAME = 'TFT Archipelago'
const MAX_PINNED_CHECKS = 3

export interface ConnectionSettings {
  hostname: string
  port: number
  slotName: string
  password: string
}

interface TftSlotData extends Record<string, unknown> {
  goal_checks?: number
  trust_mode?: unknown
  starting_major_location_ids?: unknown
  major_unlock_order_location_ids?: unknown
}

let settings: ConnectionSettings = { hostname: '', port: 38281, slotName: '', password: '' }
let isReconnecting = false
let hasConnectedSuccessfully = false

function readLocationCategory(value: unknown): LocationCategory | null {
  return value === 'major' || value === 'minor' ? value : null
}

function normalizePinnedChecks(value: unknown): PinnedCheck[] {
  if (!Array.isArray(value)) return []

  return value
    .map((check) => {
      if (!isRecord(check)) return null

      const id = readNumberFromRaw(check['id'])
      const name = check['name']
      if (id === null || typeof name !== 'string' || name.trim() === '') return null
      const location = locationChecksById.get(id)
      const category = readLocationCategory(check['category']) ?? location?.category ?? 'major'
      if (category === 'major' && !isMajorLocationUnlocked(id)) return null

      return {
        id,
        name: name.trim(),
        category,
      }
    })
    .filter((check): check is PinnedCheck => check !== null)
    .slice(0, MAX_PINNED_CHECKS)
}

export function setPinnedChecks(value: unknown): void {
  slot.pinnedChecks = normalizePinnedChecks(value)
  broadcastState()
}

function readMajorLocationIdArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback]

  const ids = value
    .map(readNumberFromRaw)
    .filter((id): id is number => id !== null && majorLocationIds.has(id))

  return ids.length > 0 ? [...new Set(ids)] : [...fallback]
}

function applySlotData(slotData: TftSlotData): void {
  const nextGoalChecks = Number(slotData.goal_checks)
  slot.goalChecks = Number.isFinite(nextGoalChecks) && nextGoalChecks > 0
    ? Math.floor(nextGoalChecks)
    : DEFAULT_GOAL_CHECKS

  slot.startingMajorLocationIds = readMajorLocationIdArray(
    slotData.starting_major_location_ids,
    defaultStartingMajorLocationIds,
  )
  slot.majorUnlockOrderLocationIds = readMajorLocationIdArray(
    slotData.major_unlock_order_location_ids,
    defaultMajorUnlockOrderLocationIds,
  ).filter(id => !slot.startingMajorLocationIds.includes(id))
  slot.trustMode = slotData.trust_mode === true
  // Pins of majors the new slot data locks are dropped
  slot.pinnedChecks = normalizePinnedChecks(slot.pinnedChecks)
}

async function login(): Promise<void> {
  suppressInitialItemNotifications()
  const slotData = await client.login(
    `${settings.hostname}:${settings.port}`,
    settings.slotName,
    AP_GAME_NAME,
    { password: settings.password },
  ) as TftSlotData
  applySlotData(slotData)
  void loadBonusUsage().catch(error => console.warn('Failed to load bonus item usage:', error))
  connection.error = null
  hasConnectedSuccessfully = true
  flushPendingChecks()
  maybeReportGoal()
}

async function reconnect(): Promise<void> {
  if (isReconnecting) return
  isReconnecting = true
  connection.isConnecting = true
  connection.error = null
  broadcastState()
  try {
    await login()
    broadcastState()
  } catch (error) {
    connection.error = getErrorMessage(error)
    console.error('Reconnect failed:', error)
    broadcastState()
  } finally {
    connection.isConnecting = false
    isReconnecting = false
    broadcastState()
  }
}

export async function connect(nextSettings: ConnectionSettings): Promise<void> {
  settings = nextSettings
  if (connection.isConnecting) return
  connection.isConnecting = true
  connection.error = null
  slot.hasReportedGoal = false
  slot.goalChecks = DEFAULT_GOAL_CHECKS
  slot.trustMode = false
  slot.startingMajorLocationIds = [...defaultStartingMajorLocationIds]
  slot.majorUnlockOrderLocationIds = [...defaultMajorUnlockOrderLocationIds]
  broadcastState()

  try {
    await login()
  } catch (error) {
    connection.error = getErrorMessage(error)
    throw error
  } finally {
    connection.isConnecting = false
    broadcastState()
  }
}

export function registerArchipelagoListeners(): void {
  client.socket.on('disconnected', () => {
    connection.isConnecting = false
    broadcastState()
    if (hasConnectedSuccessfully) void reconnect()
  })

  client.items.on('itemsReceived', (items) => {
    validateCurrentRules()
    if (!consumeItemNotificationSuppression()) notifyItemsReceived(items)
    broadcastState()
  })

  client.messages.on('itemSent', (_text, item) => notifyGlobalItemSent(item))
  client.messages.on('itemHinted', (_text, item, found) => notifyHint(item, found))

  client.room.on('locationsChecked', () => {
    maybeReportGoal()
    broadcastState()
  })
}
