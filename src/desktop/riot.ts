import type { ClientMatchStatus, ClientPendingStatus } from '../background/client-match'

export const RIOT_PHASE_STEPS = ['Lobby', 'Queue', 'In game', 'Result'] as const

export interface RiotPhaseInfo {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'idle'
  // Index into RIOT_PHASE_STEPS, -1 when the client is idle or not running
  step: number
}

export const PENDING_STATUS_LABELS: Record<ClientPendingStatus, string> = {
  waiting_for_lobby: 'Match still running',
  waiting_for_result: 'Waiting for match result',
  waiting_for_archipelago: 'Waiting for Archipelago',
}

// Maps the League client gameflow phase onto the four steps shown in the UI
export function describeRiotPhase(status: ClientMatchStatus): RiotPhaseInfo {
  if (!status.connected) return { label: 'Not running', tone: 'idle', step: -1 }

  switch (status.phase) {
    case 'Lobby':
      return { label: 'In lobby', tone: 'ok', step: 0 }
    case 'Matchmaking':
    case 'ReadyCheck':
    case 'ChampSelect':
      return { label: 'In queue', tone: 'ok', step: 1 }
    case 'GameStart':
    case 'InProgress':
    case 'Reconnect':
      return { label: 'In game', tone: 'warn', step: 2 }
    case 'PreEndOfGame':
    case 'EndOfGame':
    case 'WaitingForStats':
      return { label: 'Match ended', tone: 'ok', step: 3 }
    default:
      return { label: 'Idle', tone: 'ok', step: -1 }
  }
}
