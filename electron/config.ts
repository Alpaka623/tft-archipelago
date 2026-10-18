import fs from 'node:fs'
import path from 'node:path'

export interface ElectronConfig {
  // Executable names (case-insensitive) whose largest visible window is the TFT game
  gameProcessNames: string[]
  // Pretend a game covers the primary display; for testing overlays without TFT
  fakeGame: boolean
  // Extra folders to look for the Riot client's lockfile (Riot's install metadata is checked anyway)
  riotClientInstallDirs: string[]
  // Folder with the TFT client's TFT.log and TFTEoGStats.json; null uses %LOCALAPPDATA%/TFT/Saved/Logs
  tftLogDir: string | null
}

export const CONFIG_RELATIVE_PATH = path.join('TFTArchipelago', 'electron-config.json')

// UE5 TFT game process (measured 2026-10-17, Set 18, launched via the League client)
const DEFAULT_CONFIG: ElectronConfig = {
  gameProcessNames: ['TFTClient-Win64-Shipping.exe'],
  fakeGame: false,
  riotClientInstallDirs: [],
  tftLogDir: null,
}

function normalizeConfig(raw: unknown): ElectronConfig {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const processNames = Array.isArray(record['gameProcessNames'])
    ? record['gameProcessNames'].filter((name): name is string => typeof name === 'string' && name.trim() !== '')
    : DEFAULT_CONFIG.gameProcessNames

  return {
    gameProcessNames: processNames.length > 0 ? processNames : DEFAULT_CONFIG.gameProcessNames,
    fakeGame: record['fakeGame'] === true,
    riotClientInstallDirs: Array.isArray(record['riotClientInstallDirs'])
      ? record['riotClientInstallDirs'].filter((dir): dir is string => typeof dir === 'string' && dir.trim() !== '')
      : [],
    tftLogDir: typeof record['tftLogDir'] === 'string' && record['tftLogDir'].trim() !== '' ? record['tftLogDir'] : null,
  }
}

export function loadElectronConfig(documentsDir: string): ElectronConfig {
  const configPath = path.join(documentsDir, CONFIG_RELATIVE_PATH)
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  } catch {
    // Missing or invalid: write defaults so the player has a file to edit
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8')
      }
    } catch (error) {
      console.warn('Failed to write default Electron config:', error)
    }
    return { ...DEFAULT_CONFIG }
  }
}
