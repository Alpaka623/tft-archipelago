import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Downloads champion portraits and trait icons for every champion and trait used by the
// location catalog. Run after `npm run generate:locations`.
const DEFAULT_SOURCE_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json'
const GAME_ASSET_BASE_URL = 'https://raw.communitydragon.org/latest/game/'
const TRAITS_PATH = 'src/data/traits.json'
const CATALOG_PATH = 'src/data/location-catalog.json'
const MANIFEST_PATH = 'src/data/tft-icons.json'
const PUBLIC_DIR = 'public'
const ICON_DIR = 'assets/tft'

function parseArgs(argv) {
  const options = { sourceUrl: DEFAULT_SOURCE_URL }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source' && argv[i + 1]) {
      options.sourceUrl = argv[i + 1]
      i += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argv[i]}`)
    }
  }
  return options
}

// CommunityDragon serves .tex textures converted to .png under the lowercase game path
function toAssetUrl(texturePath) {
  return GAME_ASSET_BASE_URL + texturePath.toLowerCase().replace(/\.(tex|dds)$/, '.png')
}

function toFileName(apiName) {
  return `${apiName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.png`
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function download(url, outputPath) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(outputPath, bytes)
  return bytes.length
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const traitsData = await readJson(TRAITS_PATH)
  const catalog = await readJson(CATALOG_PATH)
  const setNumber = traitsData.metadata.setNumber

  const response = await fetch(options.sourceUrl)
  if (!response.ok) throw new Error(`Failed to fetch ${options.sourceUrl}: ${response.status} ${response.statusText}`)
  const tftData = await response.json()
  const selectedSet = tftData.sets?.[String(setNumber)]
  if (!selectedSet) throw new Error(`TFT set ${setNumber} was not found in ${options.sourceUrl}`)

  const championIds = [...new Set(catalog
    .filter(location => location.condition.type === 'champion')
    .map(location => location.condition.championId))].sort()
  const traitDisplayNames = [...new Set(catalog
    .filter(location => location.condition.type === 'trait')
    .map(location => location.condition.trait))].sort()

  const championsByApiName = new Map(selectedSet.champions.map(champion => [champion.apiName, champion]))
  const traitsByDisplayName = new Map(selectedSet.traits.map(trait => [trait.name, trait]))

  await rm(path.join(PUBLIC_DIR, ICON_DIR), { recursive: true, force: true })
  await mkdir(path.join(PUBLIC_DIR, ICON_DIR, 'champions'), { recursive: true })
  await mkdir(path.join(PUBLIC_DIR, ICON_DIR, 'traits'), { recursive: true })

  const manifest = { metadata: { source: options.sourceUrl, setNumber }, champions: {}, traits: {} }
  let totalBytes = 0

  for (const championId of championIds) {
    const texture = championsByApiName.get(championId)?.tileIcon
    if (!texture || texture === 'None') throw new Error(`No tile icon for champion ${championId}`)
    const relativePath = `${ICON_DIR}/champions/${toFileName(championId)}`
    totalBytes += await download(toAssetUrl(texture), path.join(PUBLIC_DIR, relativePath))
    manifest.champions[championId] = relativePath
  }

  for (const traitName of traitDisplayNames) {
    const trait = traitsByDisplayName.get(traitName)
    if (!trait?.icon) throw new Error(`No icon for trait ${traitName}`)
    const relativePath = `${ICON_DIR}/traits/${toFileName(trait.apiName)}`
    totalBytes += await download(toAssetUrl(trait.icon), path.join(PUBLIC_DIR, relativePath))
    manifest.traits[traitName] = relativePath
  }

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.log(`Set ${setNumber}: ${championIds.length} champion portraits, ${traitDisplayNames.length} trait icons`)
  console.log(`Downloaded ${Math.round(totalBytes / 1024)} KB into ${path.join(PUBLIC_DIR, ICON_DIR)}`)
  console.log(`Wrote ${MANIFEST_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
