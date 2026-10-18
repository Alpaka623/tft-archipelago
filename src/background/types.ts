export type UnknownRecord = Record<string, unknown>
export type ShopSnapshot = string[]
export type AugmentSnapshot = string[]
export type BoardSnapshot = UnknownRecord

export interface TraitsData {
  champions?: Record<string, string[]>
  championCosts?: Record<string, number>
  traitBreakpoints?: Record<string, number[]>
  items?: Record<string, string[]>
  // apiName → display name, e.g. DA_18_Slayer → Ravager (Set 18+)
  traitNames?: Record<string, string>
  championNames?: Record<string, string>
  // Form variants → base champion, e.g. DA_18_Lux_Coven → DA_Lux18_Base
  championAliases?: Record<string, string>
}

export interface BoardUnit {
  cellId: string
  championId: string
  starLevel: number
  itemIds: string[]
}

export interface LocationValidationContext {
  snapshot: BoardSnapshot | null
  gold: number | null
  totalPlayerCombatWins: number
  playerCombatWinStreak: number
  isPlayerCombat: boolean
  // Electron live values: level from the HUD, stage from the TFT client log; null if unknown
  level: number | null
  stage: number | null
}

export interface XpSnapshot {
  level: number
  current_xp: number
  xp_max?: number
}

export interface PickedAugmentSnapshot {
  name: string
  position: number | null
  hasFourthSlot: boolean
}

export interface RoundInfoSnapshot {
  type: string | null
  name: string | null
  nativeName: string | null
  stage: string | null
}

export type PlayerCombatOutcome = 'victory' | 'defeat'

export interface LocalPlayerIdentity {
  name: string | null
  tagLine: string | null
}
