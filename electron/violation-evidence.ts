import fs from 'node:fs/promises'
import path from 'node:path'
import type { EvidencePruneResult } from '../src/platform/types'

// Rule violation evidence lives in Documents/TFTArchipelago/violations/<ISO time>/
export const VIOLATIONS_RELATIVE_DIR = path.join('TFTArchipelago', 'violations')
export const MAX_KEPT_VIOLATION_FOLDERS = 20

// Folder names come from new Date().toISOString() with ':' and '.' replaced, so they sort chronologically
const EVIDENCE_FOLDER_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/

async function getDirectorySize(dir: string): Promise<number> {
  let total = 0
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await getDirectorySize(entryPath)
    else if (entry.isFile()) total += (await fs.stat(entryPath)).size
  }
  return total
}

// Keeps the newest folders; only touches folders named like evidence folders
export async function pruneViolationEvidence(documentsDir: string, keep = MAX_KEPT_VIOLATION_FOLDERS): Promise<EvidencePruneResult> {
  const violationsDir = path.join(documentsDir, VIOLATIONS_RELATIVE_DIR)
  let entries
  try {
    entries = await fs.readdir(violationsDir, { withFileTypes: true })
  } catch {
    return { keptFolders: 0, deletedFolders: 0, freedBytes: 0 }
  }

  const folders = entries
    .filter(entry => entry.isDirectory() && EVIDENCE_FOLDER_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort()
  const toDelete = folders.slice(0, Math.max(0, folders.length - keep))

  let deletedFolders = 0
  let freedBytes = 0
  for (const name of toDelete) {
    const folderPath = path.join(violationsDir, name)
    try {
      const size = await getDirectorySize(folderPath)
      await fs.rm(folderPath, { recursive: true, force: true })
      deletedFolders += 1
      freedBytes += size
    } catch (error) {
      console.warn('Failed to delete violation evidence folder:', folderPath, error)
    }
  }
  return { keptFolders: folders.length - deletedFolders, deletedFolders, freedBytes }
}
