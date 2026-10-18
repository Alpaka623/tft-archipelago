import apworldInfo from '../../worlds/tft_archipelago/archipelago.json'
import { MAJOR_LOCATION_CHECKS } from '../data/locations'

// Player settings for a new Archipelago run. The YAML mirrors the APWorld options in
// worlds/tft_archipelago/options.py; start items use Archipelago's built-in start_inventory_from_pool.
export const SETUP_STORAGE_KEY = 'tft-archipelago-setup'
export const GAME_NAME = apworldInfo.game
export const APWORLD_VERSION = apworldInfo.world_version
export const MINIMUM_AP_VERSION = apworldInfo.minimum_ap_version
export const APWORLD_FILE_NAME = 'tft_archipelago.apworld'
export const APWORLD_BUNDLED_PATH = `downloads/${APWORLD_FILE_NAME}`
export const MAX_SLOT_NAME_LENGTH = 16
export const MAJOR_CHECK_TOTAL = MAJOR_LOCATION_CHECKS.length

export interface StartItemDefinition {
  name: string
  // Copies in the APWorld item pool (worlds/tft_archipelago/items.py); start items are taken from it
  max: number
}

export const START_ITEMS: StartItemDefinition[] = [
  { name: 'Progressive Reroll', max: 10 },
  { name: 'Progressive XP Buy', max: 10 },
  { name: 'Progressive Augment Reroll', max: 9 },
  { name: 'Augment Slot Left', max: 1 },
  { name: 'Augment Slot Right', max: 1 },
  { name: 'Shop Slot 4 Unlock', max: 1 },
  { name: 'Shop Slot 5 Unlock', max: 1 },
]

export const MAX_TRAP_SHARE = 50

export interface SetupSettings {
  slotName: string
  goalChecks: number
  startingMajorChecks: number
  startItems: Record<string, number>
  // Percent of the free locations with one-time items instead of Nothing
  bonusItemShare: number
  // Percent of the free locations with traps
  trapShare: number
}

export const DEFAULT_SETUP: SetupSettings = {
  slotName: '',
  goalChecks: 10,
  startingMajorChecks: 11,
  startItems: {},
  bonusItemShare: 100,
  trapShare: 0,
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

export function normalizeSetup(raw: Partial<SetupSettings> | null): SetupSettings {
  const startItems: Record<string, number> = {}
  for (const item of START_ITEMS) {
    const count = clamp(raw?.startItems?.[item.name], 0, item.max, 0)
    if (count > 0) startItems[item.name] = count
  }

  return {
    slotName: typeof raw?.slotName === 'string' ? raw.slotName.slice(0, MAX_SLOT_NAME_LENGTH) : '',
    goalChecks: clamp(raw?.goalChecks, 1, MAJOR_CHECK_TOTAL, DEFAULT_SETUP.goalChecks),
    startingMajorChecks: clamp(raw?.startingMajorChecks, 1, MAJOR_CHECK_TOTAL, DEFAULT_SETUP.startingMajorChecks),
    startItems,
    bonusItemShare: clamp(raw?.bonusItemShare, 0, 100, DEFAULT_SETUP.bonusItemShare),
    trapShare: clamp(raw?.trapShare, 0, MAX_TRAP_SHARE, DEFAULT_SETUP.trapShare),
  }
}

export function readSetup(): SetupSettings {
  try {
    return normalizeSetup(JSON.parse(window.localStorage.getItem(SETUP_STORAGE_KEY) ?? 'null'))
  } catch {
    return DEFAULT_SETUP
  }
}

export function writeSetup(settings: SetupSettings): void {
  try {
    window.localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage can be unavailable; the page still works for this session
  }
}

// Returns an error message, or null when the name can be used as an Archipelago slot name
export function validateSlotName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Enter the name you want to play as.'
  if (trimmed.length > MAX_SLOT_NAME_LENGTH) return `Use at most ${MAX_SLOT_NAME_LENGTH} characters.`
  if (/[{}]/.test(trimmed)) return 'Curly braces are reserved by Archipelago.'
  return null
}

export function toYamlFileName(name: string): string {
  const safe = name.trim().replace(/[<>:"/\\|?*\s]+/g, '_').replace(/^_+|_+$/g, '')
  return `${safe || 'Player'}.yaml`
}

export function buildPlayerYaml(settings: SetupSettings): string {
  const startItems = START_ITEMS.filter(item => (settings.startItems[item.name] ?? 0) > 0)
  const startItemLines = startItems.length > 0
    ? startItems.map(item => `    ${item.name}: ${settings.startItems[item.name]}`)
    : null

  return [
    `# ${GAME_NAME} player settings, created with the TFT Archipelago app (APWorld ${APWORLD_VERSION}).`,
    `# Give this file and ${APWORLD_FILE_NAME} to the person who generates the multiworld.`,
    // Double-quoted YAML strings use JSON escaping, so names with special characters stay valid
    `name: ${JSON.stringify(settings.slotName.trim())}`,
    `game: ${GAME_NAME}`,
    'requires:',
    `  version: ${MINIMUM_AP_VERSION}`,
    `${GAME_NAME}:`,
    `  goal_checks: ${settings.goalChecks}`,
    `  starting_major_checks: ${settings.startingMajorChecks}`,
    `  bonus_item_share: ${settings.bonusItemShare}`,
    `  trap_share: ${settings.trapShare}`,
    ...(startItemLines ? ['  start_inventory_from_pool:', ...startItemLines] : ['  start_inventory_from_pool: {}']),
    '',
  ].join('\n')
}
