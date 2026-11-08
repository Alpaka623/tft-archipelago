import { describe, expect, it } from 'vitest'
import { parseTftLogLine } from './tft-log'

// Lines from a standalone client log (2026-11-06, Tocker's Trials); keys and tokens replaced
const GAME_START_LINE = `[2026.11.06-21.16.52:900][125]RGIOPRms: Received RMS message ID '478ae25470a9a3cad484e8978b9b7e75' for resource 'lol-gsm-server/v1/gsm/game-update/IN_PROGRESS' service 'gsm' payload '{"id":8038149828,"gameState":"IN_PROGRESS","playerCredentials":{"gameId":8038149828,"queueId":1220,"playerId":3042505845343488,"puuid":"2d15828a-c606-509d-b5db-a20fd70817f0","serverIp":"192.0.2.1","serverPort":7167,"encryptionKey":"REDACTED","spectatorKey":"REDACTED","championId":0}}'`
const ESCAPED_GAME_START_LINE = `[2026.11.06-21.16.52:896][125]RGIOPRiotGamesApiInternal: riot-messaging-service: Got message '{"persist":{"type":"ack_once"},"payload":{"resource":"lol-gsm-server/v1/gsm/game-update/IN_PROGRESS","service":"gsm","payload":"{\\"id\\":8038149828,\\"gameState\\":\\"IN_PROGRESS\\"}"}}'`

describe('parseTftLogLine', () => {
  it('reads game id, queue and player from the game assignment', () => {
    expect(parseTftLogLine(GAME_START_LINE)).toEqual({
      type: 'game_start',
      at: '2026.11.06-21.16.52:900',
      gameId: 8038149828,
      queueId: 1220,
      puuid: '2d15828a-c606-509d-b5db-a20fd70817f0',
    })
  })

  it('never returns anything else from the game assignment line', () => {
    const event = parseTftLogLine(GAME_START_LINE)
    expect(JSON.stringify(event)).not.toContain('REDACTED')
    expect(JSON.stringify(event)).not.toContain('192.0.2.1')
  })

  it('skips the escaped copy of the same message', () => {
    expect(parseTftLogLine(ESCAPED_GAME_START_LINE)).toBeNull()
  })

  it('falls back to the payload id without player credentials', () => {
    const line = `[2026.11.06-21.16.52:900][125]RGIOPRms: Received RMS message ID '' for resource 'lol-gsm-server/v1/gsm/game-update/IN_PROGRESS' service 'gsm' payload '{"id":42,"gameState":"IN_PROGRESS"}'`
    expect(parseTftLogLine(line)).toMatchObject({ type: 'game_start', gameId: 42, queueId: null, puuid: null })
  })

  it('reads match start and end', () => {
    expect(parseTftLogLine('[2026.11.06-21.16.59:652][393]TFT: [Client] TFTLobbySubsystem_2147482177: Entering LobbyState[ETFTLobbyState::InGame]'))
      .toEqual({ type: 'match_start', at: '2026.11.06-21.16.59:652' })
    expect(parseTftLogLine('[2026.11.06-21.40.30:057][899]TFT: [Standalone] TFTLobbySubsystem_2147482177: Exiting LobbyState[ETFTLobbyState::InGame]'))
      .toEqual({ type: 'match_end', at: '2026.11.06-21.40.30:057' })
  })

  it('reads other lobby states once', () => {
    expect(parseTftLogLine('[2026.11.06-21.16.34:979][ 68]TFT: [Standalone] TFTLobbySubsystem_2147482177: Entering LobbyState[ETFTLobbyState::Matchmaking]'))
      .toEqual({ type: 'lobby_state', at: '2026.11.06-21.16.34:979', state: 'Matchmaking' })
    expect(parseTftLogLine('[2026.11.06-21.40.42:230][629]TFT: [Standalone] TFTLobbySubsystem_2147482177: Entering LobbyState[ETFTLobbyState::Frontend] had no side effect'))
      .toBeNull()
    expect(parseTftLogLine('[2026.11.06-21.40.40:561][529]TFT: [Standalone] TFTLobbySubsystem_2147482177: Exiting LobbyState[ETFTLobbyState::EndOfGameSummary]'))
      .toBeNull()
  })
})
