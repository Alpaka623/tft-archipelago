import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { crc32, deflateRawSync } from 'node:zlib'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const sourceDir = path.join(repoRoot, 'worlds', 'tft_archipelago')
const buildDir = path.join(repoRoot, 'build')
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

// Written by hand instead of PowerShell's Compress-Archive, which stores entries as
// tft_archipelago\items.py. Python on Linux and macOS reads those as files at the zip root,
// and the Launcher rejects the APWorld with "expected a single directory".
async function listEntries(dir, prefix) {
  const entries = []
  for (const dirent of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${prefix}/${dirent.name}`
    if (dirent.isDirectory()) {
      entries.push({ name: `${name}/`, data: Buffer.alloc(0) })
      entries.push(...await listEntries(path.join(dir, dirent.name), name))
    } else {
      entries.push({ name, data: await readFile(path.join(dir, dirent.name)) })
    }
  }
  return entries
}

function buildZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const compressed = data.length > 0 ? deflateRawSync(data) : data
    const method = data.length > 0 ? 8 : 0
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12) // 1980-01-01, keeps builds reproducible
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4) // made by Unix, so the Launcher sees plain POSIX paths
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE((name.endsWith('/') ? 0o40755 : 0o100644) * 0x10000, 38)
    central.writeUInt32LE(offset, 42)
    localParts.push(local, nameBytes, compressed)
    centralParts.push(central, nameBytes)
    offset += local.length + nameBytes.length + compressed.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

const entries = [
  { name: 'tft_archipelago/', data: Buffer.alloc(0) },
  ...await listEntries(stagedWorldDir, 'tft_archipelago'),
]
await writeFile(outputPath, buildZip(entries))

await rm(stagingDir, { recursive: true, force: true })
await mkdir(path.dirname(bundledCopyPath), { recursive: true })
await copyFile(outputPath, bundledCopyPath)

console.log(`Packaged ${sourceDir} -> ${outputPath}`)
console.log(`Copied for the app -> ${bundledCopyPath}`)
