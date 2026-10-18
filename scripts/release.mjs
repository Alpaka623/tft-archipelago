// Uploads the built installer as a draft GitHub release. Uses GH_TOKEN when set,
// otherwise the token of the logged-in GitHub CLI (`gh auth login`), so no token is stored anywhere.
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const RELEASES_REPO = 'Alpaka623/tft-archipelago-releases'
const NOTES_TEMPLATE_PATH = path.join(process.cwd(), 'installer', 'release-notes.md')
// Community files next to the installer, so links to releases/latest/download/ stay stable
const COMMUNITY_ASSETS = [
  path.join(process.cwd(), 'build', 'tft_archipelago.apworld'),
  path.join(process.cwd(), 'installer', 'TFT-Archipelago-template.yaml'),
]

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', shell: true, ...options })
}

function readGhToken() {
  const result = run('gh', ['auth', 'token'])
  return result.status === 0 ? result.stdout.trim() : ''
}

const token = process.env['GH_TOKEN'] || readGhToken()
if (!token) {
  console.error('No GitHub token: run `gh auth login` once, or set GH_TOKEN.')
  process.exit(1)
}
const env = { ...process.env, GH_TOKEN: token }

const { version } = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
const tag = `v${version}`

// electron-builder uploads its files in parallel and creates two drafts when the release
// does not exist yet, so the draft is created first. Its notes come from the template.
if (run('gh', ['release', 'view', tag, '--repo', RELEASES_REPO], { env }).status !== 0) {
  const notes = (await readFile(NOTES_TEMPLATE_PATH, 'utf8')).replaceAll('{version}', version)
  const notesPath = path.join(os.tmpdir(), `tft-archipelago-release-notes-${version}.md`)
  await writeFile(notesPath, notes, 'utf8')
  const created = run('gh', ['release', 'create', tag, '--repo', RELEASES_REPO, '--draft', '--title', version, '--notes-file', `"${notesPath}"`], { env, stdio: 'inherit' })
  if (created.status !== 0) process.exit(created.status ?? 1)
}

const result = run('npx', ['electron-builder', '--win', '--publish', 'always'], { env, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

const uploaded = run('gh', ['release', 'upload', tag, ...COMMUNITY_ASSETS.map(asset => `"${asset}"`), '--repo', RELEASES_REPO, '--clobber'], { env, stdio: 'inherit' })
process.exit(uploaded.status ?? 1)
