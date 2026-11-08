import { describe, expect, it } from 'vitest'
import { parseTftLogLine } from './tft-log'

// Standalone client lines (TFT 18.6, 2026-11-08); server address and key replaced by dummies
const PAYLOAD = '{"id":8039442375,"gameState":"IN_PROGRESS","playerCredentials":{"gameId":8039442375,"queueId":1090,'
  + '"puuid":"cd1a3207-c62c-572f-80ab-6f9f2870beb6","serverIp":"192.0.2.1","serverPort":7000,"encryptionKey":"SECRET=="},'
  + '"gameData":{"players":[{"puuid":"00000000-0000-0000-0000-000000000000"}]},"gameMode":"TFT","queueType":"NORMAL_TFT","gameCreateDate":1794096048602}'
const RMS_LINE = `[2026.11.08-00.00.44:215][323]RGIOPRms: Received RMS message ID 'abc' for resource 'lol-gsm-server/v1/gsm/game-update/IN_PROGRESS' service 'gsm' payload '${PAYLOAD}'`
const ESCAPED_LINE = `[2026.11.08-00.00.44:216][323]LogRiotClient: riot-messaging-service: Got message {"payload":"${PAYLOAD.replace(/"/g, '\\"')}","resource":"lol-gsm-server/v1/gsm/game-update/IN_PROGRESS"}`

const GAME_INFO = {
  type: 'game_info',
  gameId: 8039442375,
  queueId: 1090,
  puuid: 'cd1a3207-c62c-572f-80ab-6f9f2870beb6',
  gameMode: 'TFT',
  gameState: 'IN_PROGRESS',
}

describe('parseTftLogLine', () => {
  it('reads the game server game-update message', () => {
    expect(parseTftLogLine(RMS_LINE)).toEqual({ ...GAME_INFO, at: '2026.11.08-00.00.44:215' })
  })

  it('reads the escaped copy of the message', () => {
    expect(parseTftLogLine(ESCAPED_LINE)).toEqual({ ...GAME_INFO, at: '2026.11.08-00.00.44:216' })
  })

  it('never carries the server address or key', () => {
    const text = JSON.stringify([parseTftLogLine(RMS_LINE), parseTftLogLine(ESCAPED_LINE)])
    expect(text).not.toMatch(/serverIp|192\.0\.2\.1|encryptionKey|SECRET/)
  })

  it('takes the puuid from the player credentials only', () => {
    const line = RMS_LINE.replace('"puuid":"cd1a3207-c62c-572f-80ab-6f9f2870beb6",', '')
    expect(parseTftLogLine(line)).toMatchObject({ gameId: 8039442375, puuid: null })
  })

  it('ignores credentials without a game id', () => {
    expect(parseTftLogLine(RMS_LINE.replace('"gameId":8039442375,', ''))).toBeNull()
  })

  it('reads the standalone lobby states', () => {
    expect(parseTftLogLine('[2026.11.08-00.00.58:272][901]TFT: [Client] TFTLobbySubsystem_1: Entering LobbyState[ETFTLobbyState::InGame]'))
      .toEqual({ type: 'match_start', at: '2026.11.08-00.00.58:272' })
    expect(parseTftLogLine('[2026.11.08-00.11.58:035][278]TFT: [Standalone] TFTLobbySubsystem_1: Entering LobbyState[ETFTLobbyState::EndOfGameInterstitial]'))
      .toEqual({ type: 'match_end', at: '2026.11.08-00.11.58:035' })
    expect(parseTftLogLine('[2026.11.08-00.11.58:036][278]TFT: [Standalone] TFTLobbySubsystem_1: Entering LobbyState[ETFTLobbyState::EndOfGameSummary]'))
      .toEqual({ type: 'match_end', at: '2026.11.08-00.11.58:036' })
    expect(parseTftLogLine('[2026.11.08-00.00.33:480][679]TFT: [Standalone] TFTLobbySubsystem_1: Entering LobbyState[ETFTLobbyState::Matchmaking]'))
      .toBeNull()
  })
})
