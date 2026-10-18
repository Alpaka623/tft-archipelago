// Copies the app version from package.json into the Overwolf manifest,
// so both runtimes report the same version.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const manifestPath = path.join(repoRoot, 'public', 'manifest.json')

const { version } = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
const manifestText = await readFile(manifestPath, 'utf8')
const manifest = JSON.parse(manifestText)

if (manifest.meta.version !== version) {
  // Replace only the version line to keep the manifest's formatting
  const updated = manifestText.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`)
  await writeFile(manifestPath, updated, 'utf8')
  console.log(`Overwolf manifest version: ${manifest.meta.version} -> ${version}`)
}
