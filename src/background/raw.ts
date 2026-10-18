import type { UnknownRecord } from './types'

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value.trim() === '') return value

  try {
    return JSON.parse(value)
  } catch (error) {
    console.warn('Failed to parse GEP JSON payload:', error)
    return null
  }
}

export function parseGepValueForLog(value: unknown): unknown {
  if (typeof value !== 'string') return value

  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

export function isTruthyGepValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'True'
}

export function readBooleanFromRaw(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') {
    if (raw === 1) return true
    if (raw === 0) return false
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return null
}

export function readStringFromRaw(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed === '' ? null : trimmed
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  return null
}

export function readNumberFromRaw(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null

  const numberValue = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(numberValue) ? numberValue : null
}
