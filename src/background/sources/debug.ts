// Simulated game events from the desktop debug tab, for testing the rule engine without TFT
import { DEBUG_GAME_EVENTS_ENABLED, type DebugGameEvent } from '../../types/debug'
import { broadcastState } from '../broadcast'
import { clearAugmentPhase, registerAugmentReroll } from '../detection/augments'
import { handleBattleStart, handleMatchEnd, handleRoundStart, resetMatchDetectionState } from '../detection/match'
import { SHOP_SLOT_COUNT, handleShopVisibleUpdate, registerShopReroll } from '../detection/shop'
import { registerXpBuy } from '../detection/xp'
import { logGep } from '../log'
import { augments, run } from '../state'

export function handleDebugGameEvent(event: DebugGameEvent): void {
  if (!DEBUG_GAME_EVENTS_ENABLED) return

  logGep('Debug game event', event)
  switch (event.type) {
    case 'match_start':
      resetMatchDetectionState()
      broadcastState()
      break
    case 'round_start':
      handleRoundStart()
      break
    case 'battle_start':
      handleBattleStart()
      break
    case 'shop_visible':
      handleShopVisibleUpdate(event.visible)
      break
    case 'shop_reroll':
      registerShopReroll(SHOP_SLOT_COUNT, 'debug event')
      break
    case 'xp_buy':
      registerXpBuy('debug event')
      break
    case 'augment_phase':
      if (event.active) {
        augments.isPhaseActive = true
        broadcastState()
      } else {
        clearAugmentPhase('debug event')
      }
      break
    case 'augment_reroll':
      registerAugmentReroll('debug event')
      break
    case 'match_end':
      run.rank = event.rank
      handleMatchEnd({ reason: 'debug event' })
      break
  }
}
