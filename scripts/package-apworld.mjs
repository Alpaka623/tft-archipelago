import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const sourceDir = path.join(repoRoot, 'worlds', 'tft_archipelago')
const buildDir = path.join(repoRoot, 'build')
const zipPath = path.join(buildDir, 'tft_archipelago.zip')
const outputPath = path.join(buildDir, 'tft_archipelago.apworld')
// The desktop Setup page offers this copy as a download; public/downloads is gitignored
const bundledCopyPath = path.join(repoRoot, 'public', 'downloads', 'tft_archipelago.apworld')
const stagingDir = path.join(buildDir, 'apworld-staging')
const stagedWorldDir = path.join(stagingDir, 'tft_archipelago')
// APContainer packaging scheme (worlds/Files.py in Archipelago 0.6.5). The source manifest must not
// define these; the Launcher's "Build APWorlds" adds them the same way.
const CONTAINER_VERSION = 7
const CONTAINER_COMPATIBLE_VERSION = 7

await mkdir(buildDir, { recursive: true })
await rm(zipPath, { force: true })
await rm(outputPath, { force: true })
await rm(stagingDir, { recursive: true, force: true })
await cp(sourceDir, stagedWorldDir, {
  recursive: true,
  filter: source => !['__pycache__', '.pytest_cache'].includes(path.basename(source)) && !source.endsWith('.pyc'),
})

const manifestPath = path.join(stagedWorldDir, 'archipelago.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.version = CONTAINER_VERSION
manifest.compatible_version = CONTAINER_COMPATIBLE_VERSION
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

const command = [
  'Compress-Archive',
  '-Path',
  '.\\build\\apworld-staging\\tft_archipelago',
  '-DestinationPath',
  '.\\build\\tft_archipelago.zip',
  '-Force',
  ';',
  'Move-Item',
  '-Force',
  '.\\build\\tft_archipelago.zip',
  '.\\build\\tft_archipelago.apworld',
].join(' ')

const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
  cwd: repoRoot,
  stdio: 'inherit',
})

if (result.status !== 0) {
  throw new Error(`APWorld packaging failed with exit code ${result.status ?? 'unknown'}`)
}

await rm(stagingDir, { recursive: true, force: true })
await mkdir(path.dirname(bundledCopyPath), { recursive: true })
await copyFile(outputPath, bundledCopyPath)

console.log(`Packaged ${sourceDir} -> ${outputPath}`)
console.log(`Copied for the app -> ${bundledCopyPath}`)
