// Simulated game events for testing the rule engine and blockers without a live
// data source. Disable before a public release: simulated match ends can send checks.
export const DEBUG_GAME_EVENTS_ENABLED = true

export type DebugGameEvent =
  | { type: 'match_start' }
  | { type: 'round_start' }
  | { type: 'battle_start' }
  | { type: 'shop_visible'; visible: boolean }
  | { type: 'shop_reroll' }
  | { type: 'xp_buy' }
  | { type: 'augment_phase'; active: boolean }
  | { type: 'augment_reroll' }
  | { type: 'match_end'; rank: number }
