// Toast notifications for received items, other players' items, hints and sent checks
import type { Item as ArchipelagoItem } from 'archipelago.js'
import { ITEM_IDS } from '../../data/items'
import type {
  CheckNotification,
  CheckNotificationEntry,
  GlobalItemSentNotification,
  HintNotification,
  ReceivedItemNotification,
} from '../../types/state'
import { sendToConnectedWindows } from '../broadcast'
import { client } from '../runtime'
import { locationChecksById } from '../state'

// The server resends the whole inventory on login; that batch is not news
const ITEM_NOTIFICATION_SUPPRESSION_MS = 2000

let suppressNextItemBatch = false
let suppressionTimeoutId: number | null = null

function getSenderName(item: ArchipelagoItem): string {
  try {
    return item.sender.alias || item.sender.name || 'Archipelago'
  } catch {
    return 'Archipelago'
  }
}

function getReceiverName(item: ArchipelagoItem): string {
  try {
    return item.receiver.alias || item.receiver.name || 'Archipelago'
  } catch {
    return 'Archipelago'
  }
}

function isSelfPlayer(player: ArchipelagoItem['sender']): boolean {
  try {
    const self = client.players.self
    return player.slot === self.slot && player.team === self.team
  } catch {
    return false
  }
}

function isOwnItemActivity(item: ArchipelagoItem): boolean {
  return isSelfPlayer(item.sender) || isSelfPlayer(item.receiver)
}

function toCheckNotificationEntry(locationId: number, rewardItem: ArchipelagoItem | null): CheckNotificationEntry {
  const location = locationChecksById.get(locationId)

  return {
    locationId,
    locationName: rewardItem?.locationName ?? location?.name ?? `Location ${locationId}`,
    locationCategory: location?.category ?? 'minor',
    itemName: rewardItem?.name ?? null,
    playerName: rewardItem ? getReceiverName(rewardItem) : null,
  }
}

async function buildCheckNotification(
  status: CheckNotification['status'],
  locationIds: number[],
  includeRewards: boolean,
): Promise<CheckNotification> {
  const rewardItemsByLocationId = new Map<number, ArchipelagoItem>()
  let rewardDetailsUnavailable = false

  if (includeRewards && client.authenticated) {
    try {
      const scoutedItems = await client.scout(locationIds, 0)
      for (const item of scoutedItems) {
        rewardItemsByLocationId.set(item.locationId, item)
      }
      rewardDetailsUnavailable = locationIds.some(id => !rewardItemsByLocationId.has(id))
    } catch (error) {
      rewardDetailsUnavailable = true
      console.warn('Failed to scout sent check rewards:', error)
    }
  }

  return {
    status,
    rewardDetailsUnavailable,
    checks: locationIds.map(locationId => (
      toCheckNotificationEntry(locationId, rewardItemsByLocationId.get(locationId) ?? null)
    )),
  }
}

function broadcastCheckNotification(notification: CheckNotification): void {
  if (notification.checks.length === 0) return
  sendToConnectedWindows({ id: 'AP_CHECK_NOTIFICATION', content: notification })
}

export function notifyChecksQueued(locationIds: number[]): void {
  void buildCheckNotification('queued', locationIds, false).then(broadcastCheckNotification)
}

export function notifyChecksSent(locationIds: number[]): void {
  void buildCheckNotification('sent', locationIds, true).then(broadcastCheckNotification)
}

export function notifyItemsReceived(items: ArchipelagoItem[]): void {
  for (const item of items) {
    if (item.id === ITEM_IDS.NOTHING) continue

    const notification: ReceivedItemNotification = {
      itemId: item.id,
      itemName: item.name,
      playerName: getSenderName(item),
    }
    sendToConnectedWindows({ id: 'AP_ITEM_RECEIVED', content: notification })
  }
}

export function notifyGlobalItemSent(item: ArchipelagoItem): void {
  if (item.id === ITEM_IDS.NOTHING || isOwnItemActivity(item)) return

  const notification: GlobalItemSentNotification = {
    itemId: item.id,
    itemName: item.name,
    senderName: getSenderName(item),
    receiverName: getReceiverName(item),
    locationId: item.locationId,
    locationName: item.locationName,
  }
  sendToConnectedWindows({ id: 'AP_GLOBAL_ITEM_SENT', content: notification })
}

export function notifyHint(item: ArchipelagoItem, found: boolean): void {
  if (item.id === ITEM_IDS.NOTHING || !isOwnItemActivity(item)) return

  const notification: HintNotification = {
    itemId: item.id,
    itemName: item.name,
    senderName: getSenderName(item),
    receiverName: getReceiverName(item),
    locationId: item.locationId,
    locationName: item.locationName,
    found,
  }
  sendToConnectedWindows({ id: 'AP_HINT_RECEIVED', content: notification })
}

export function suppressInitialItemNotifications(): void {
  suppressNextItemBatch = true

  if (suppressionTimeoutId !== null) window.clearTimeout(suppressionTimeoutId)
  suppressionTimeoutId = window.setTimeout(() => {
    suppressNextItemBatch = false
    suppressionTimeoutId = null
  }, ITEM_NOTIFICATION_SUPPRESSION_MS)
}

export function consumeItemNotificationSuppression(): boolean {
  if (!suppressNextItemBatch) return false

  suppressNextItemBatch = false
  if (suppressionTimeoutId !== null) {
    window.clearTimeout(suppressionTimeoutId)
    suppressionTimeoutId = null
  }

  return true
}
