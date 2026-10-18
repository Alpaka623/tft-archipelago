import type { ClientMatchOutcome } from '../background/client-match'
import type {
  CheckNotification,
  GlobalItemSentNotification,
  HintNotification,
  ReceivedItemNotification,
} from '../types/state'

export const MAX_ACTIVITY_LOG_ENTRIES = 100

export interface ActivityLogEntry {
  id: number
  type: 'item' | 'global-item' | 'check-sent' | 'check-queued' | 'hint' | 'match'
  relatedToMe: boolean
  timestamp: number
  title: string
  details: string
}

let nextActivityLogEntryId = 1

function createActivityLogEntry(
  type: ActivityLogEntry['type'],
  relatedToMe: boolean,
  title: string,
  details: string,
  timestamp = Date.now(),
): ActivityLogEntry {
  const entry = { id: nextActivityLogEntryId, type, relatedToMe, timestamp, title, details }
  nextActivityLogEntryId += 1
  return entry
}

export function activityEntriesFromItem(notification: ReceivedItemNotification): ActivityLogEntry[] {
  return [createActivityLogEntry('item', true, notification.itemName, `Received from ${notification.playerName}`)]
}

export function activityEntriesFromGlobalItem(notification: GlobalItemSentNotification): ActivityLogEntry[] {
  return [
    createActivityLogEntry(
      'global-item',
      false,
      notification.itemName,
      `${notification.senderName} found it for ${notification.receiverName} at ${notification.locationName}`,
    ),
  ]
}

export function activityEntriesFromHint(notification: HintNotification): ActivityLogEntry[] {
  const status = notification.found ? 'found' : 'not found'
  return [
    createActivityLogEntry(
      'hint',
      true,
      `Hint: ${notification.itemName} for ${notification.receiverName}`,
      `${notification.senderName}'s ${notification.locationName} (${status})`,
    ),
  ]
}

export function activityEntriesFromChecks(notification: CheckNotification): ActivityLogEntry[] {
  return notification.checks.map((check) => {
    if (notification.status === 'queued') {
      return createActivityLogEntry('check-queued', true, check.locationName, 'Queued until Archipelago reconnects')
    }

    const itemText = check.itemName ?? 'Unknown item'
    const playerText = check.playerName ?? 'unknown player'
    return createActivityLogEntry('check-sent', true, check.locationName, `Sent ${itemText} to ${playerText}`)
  })
}

export function activityEntryFromMatchOutcome(outcome: ClientMatchOutcome): ActivityLogEntry {
  const placement = outcome.placement !== null ? `#${outcome.placement} ` : ''
  const title = `Match finished: ${placement}${outcome.queueName}`
  return createActivityLogEntry('match', true, title, describeMatchOutcome(outcome), outcome.finishedAt)
}

export function describeMatchOutcome(outcome: ClientMatchOutcome): string {
  switch (outcome.kind) {
    case 'evaluated':
      return outcome.fulfilledLocationIds.length > 0
        ? `${outcome.fulfilledLocationIds.length} check condition(s) met`
        : 'No check conditions met'
    case 'not_counted':
      return `${outcome.queueName} does not count for checks`
    case 'invalid_run':
      return 'Run invalidated: no checks sent'
    case 'timed_out':
      return 'No match result found'
  }
}

export function formatActivityTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}
