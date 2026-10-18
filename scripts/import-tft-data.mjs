import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_SOURCE_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json'
const DEFAULT_OUTPUT_PATH = 'src/data/traits.json'

function parseArgs(argv) {
  const options = {
    sourceUrl: DEFAULT_SOURCE_URL,
    outputPath: DEFAULT_OUTPUT_PATH,
    setNumber: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--source' && next) {
      options.sourceUrl = next
      i += 1
    } else if (arg === '--out' && next) {
      options.outputPath = next
      i += 1
    } else if (arg === '--set' && next) {
      options.setNumber = Number(next)
      i += 1
    } else if (/^\d+$/.test(arg)) {
      options.setNumber = Number(arg)
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }

  return options
}

function selectSet(tftData, requestedSetNumber) {
  const sets = tftData.sets ?? {}
  const setNumbers = Object.keys(sets)
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

  const setNumber = requestedSetNumber ?? setNumbers[setNumbers.length - 1]
  const selectedSet = sets[String(setNumber)]

  if (!selectedSet) {
    throw new Error(`TFT set ${setNumber} was not found. Available sets: ${setNumbers.join(', ')}`)
  }

  return { setNumber, selectedSet }
}

function normalizeTraitName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function extractChampionTraits(champions) {
  const output = {}

  for (const champion of champions ?? []) {
    if (!champion?.apiName) continue

    const traits = [...new Set((champion.traits ?? []).map(normalizeTraitName).filter(Boolean))]
    if (traits.length === 0) continue

    output[champion.apiName] = traits.sort((left, right) => left.localeCompare(right))
  }

  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

function extractChampionCosts(champions) {
  const output = {}

  for (const champion of champions ?? []) {
    if (!champion?.apiName) continue

    const cost = Number(champion.cost)
    if (!Number.isFinite(cost)) continue

    output[champion.apiName] = cost
  }

  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

function extractTraitBreakpoints(traits) {
  const output = {}

  for (const trait of traits ?? []) {
    const name = normalizeTraitName(trait?.name)
    if (!name) continue

    const breakpoints = [...new Set(
      (trait.effects ?? [])
        .map(effect => Number(effect?.minUnits))
        .filter(value => Number.isFinite(value) && value > 0),
    )].sort((left, right) => left - right)

    if (breakpoints.length > 0) {
      output[name] = breakpoints
    }
  }

  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

function stripHtml(value) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Set 17: "The holder gains the X trait" in the description. Set 18 (UE5): empty description,
// so fall back to the display name "X Emblem" when X is a trait of the set.
function extractGrantedTraitFromItem(item, traitDisplayNames) {
  const desc = stripHtml(item?.desc ?? '')
  const match = desc.match(/\bholder gains the ([^.]+?) trait\b/i)
  if (match) return normalizeTraitName(match[1])

  const nameMatch = normalizeTraitName(item?.name).match(/^(.+) Emblem$/)
  return nameMatch && traitDisplayNames.has(nameMatch[1]) ? nameMatch[1] : ''
}

// Set 18 ids use the UE5 data-asset form: DA_18_Ornn, DA_Riftbeast18, DA_18_EmblemCoven
function isSetApiName(apiName, setNumber) {
  return apiName.startsWith(`TFT${setNumber}_`)
    || apiName.startsWith(`DA_${setNumber}_`)
    || (apiName.startsWith('DA_') && new RegExp(`\\D${setNumber}(?:_|$)`).test(apiName))
}

function extractTraitNames(traits) {
  const output = {}
  for (const trait of traits ?? []) {
    const name = normalizeTraitName(trait?.name)
    if (trait?.apiName && name) output[trait.apiName] = name
  }
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

function extractChampionNames(champions) {
  const output = {}
  for (const champion of champions ?? []) {
    const name = normalizeTraitName(champion?.name)
    if (champion?.apiName && name && (champion.traits ?? []).length > 0) output[champion.apiName] = name
  }
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

// Form variants such as "Lux (Blossom)" count as the base champion "Lux" for checks
function extractChampionAliases(championNames) {
  const idsByName = new Map(Object.entries(championNames).map(([apiName, name]) => [name, apiName]))
  const output = {}
  for (const [apiName, name] of Object.entries(championNames)) {
    const variantMatch = name.match(/^(.+) \([^)]+\)$/)
    const baseId = variantMatch ? idsByName.get(variantMatch[1]) : undefined
    if (baseId && baseId !== apiName) output[apiName] = baseId
  }
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

function extractIconAlias(item) {
  const icon = typeof item?.icon === 'string' ? item.icon : ''
  const basename = path.basename(icon)
  const withoutSetSuffix = basename.replace(/\.TFT_Set\d+\.tex$/i, '')
  return withoutSetSuffix || ''
}

function extractItemGrantedTraits(items, setNumber, traitDisplayNames) {
  const output = {}

  for (const item of items ?? []) {
    if (typeof item?.apiName !== 'string' || !isSetApiName(item.apiName, setNumber)) continue

    const grantedTrait = extractGrantedTraitFromItem(item, traitDisplayNames)
    if (!grantedTrait) continue

    const traits = [grantedTrait]
    const aliases = [item.apiName, extractIconAlias(item)].filter(Boolean)

    for (const alias of aliases) {
      output[alias] = traits
    }
  }

  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const response = await fetch(options.sourceUrl)

  if (!response.ok) {
    throw new Error(`Failed to fetch ${options.sourceUrl}: ${response.status} ${response.statusText}`)
  }

  const tftData = await response.json()
  const { setNumber, selectedSet } = selectSet(tftData, options.setNumber)
  const champions = extractChampionTraits(selectedSet.champions)
  const championCosts = extractChampionCosts(selectedSet.champions)
  const traitBreakpoints = extractTraitBreakpoints(selectedSet.traits)
  const traitNames = extractTraitNames(selectedSet.traits)
  const championNames = extractChampionNames(selectedSet.champions)
  const championAliases = extractChampionAliases(championNames)
  const items = extractItemGrantedTraits(tftData.items, setNumber, new Set(Object.values(traitNames)))

  const output = {
    metadata: {
      source: options.sourceUrl,
      setNumber,
      setName: selectedSet.name,
      championCount: Object.keys(champions).length,
      championCostCount: Object.keys(championCosts).length,
      traitBreakpointCount: Object.keys(traitBreakpoints).length,
      itemAliasCount: Object.keys(items).length,
    },
    champions,
    championCosts,
    traitBreakpoints,
    traitNames,
    championNames,
    championAliases,
    items,
  }

  await mkdir(path.dirname(options.outputPath), { recursive: true })
  await writeFile(options.outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

  console.log(`Imported TFT set ${setNumber} (${selectedSet.name})`)
  console.log(`Champions with traits: ${output.metadata.championCount}`)
  console.log(`Champions with costs: ${output.metadata.championCostCount}`)
  console.log(`Traits with breakpoints: ${output.metadata.traitBreakpointCount}`)
  console.log(`Trait-granting item aliases: ${output.metadata.itemAliasCount}`)
  console.log(`Wrote ${options.outputPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
