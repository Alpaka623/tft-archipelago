import { describe, expect, it } from 'vitest'
import { createRegionState, isEmptyShopSlot, parseXp, updateStableFingerprint, updateStableValue, type StableValue } from './readings'

describe('updateStableValue', () => {
  it('accepts a value after two identical reads', () => {
    const state: StableValue<number> = { value: null, candidateKey: null }

    expect(updateStableValue(state, 12)).toBeNull()
    expect(updateStableValue(state, 12)).toBe(12)
    expect(updateStableValue(state, 14)).toBe(12)
    expect(updateStableValue(state, 14)).toBe(14)
  })

  it('drops the value on an unreadable frame', () => {
    const state: StableValue<number> = { value: 12, candidateKey: null }
    expect(updateStableValue(state, null)).toBeNull()
    expect(state.value).toBeNull()
  })
})

describe('updateStableFingerprint', () => {
  it('counts a change only once the new image persisted', () => {
    const state = createRegionState()
    updateStableFingerprint(state, '0000000000000000')
    updateStableFingerprint(state, '0000000000000000')
    expect(state.stableFingerprint).toBe('0000000000000000')
    expect(state.changeCount).toBe(0)

    updateStableFingerprint(state, 'ffffffffffffffff')
    expect(state.stableFingerprint).toBe('0000000000000000')
    updateStableFingerprint(state, 'ffffffffffffffff')
    expect(state.stableFingerprint).toBe('ffffffffffffffff')
    expect(state.changeCount).toBe(1)
  })

  it('treats small fingerprint differences as the same image', () => {
    const state = createRegionState()
    updateStableFingerprint(state, '0000000000000000')
    updateStableFingerprint(state, '0000000000000000')
    updateStableFingerprint(state, '000000000000000f')
    updateStableFingerprint(state, '000000000000000f')
    expect(state.stableFingerprint).toBe('0000000000000000')
  })
})

describe('isEmptyShopSlot', () => {
  it('detects dark slots and the measured empty-slot fingerprints', () => {
    expect(isEmptyShopSlot({ luminance: 9, contrast: 6, fingerprint: 'ffffffffffffffff' })).toBe(true)
    expect(isEmptyShopSlot({ luminance: 120, contrast: 40, fingerprint: '1f5b4f4f17174f0f' })).toBe(true)
    expect(isEmptyShopSlot({ luminance: 39, contrast: 23, fingerprint: 'ffffffffffffffff' })).toBe(false)
  })
})

describe('parseXp', () => {
  it('reads current and maximum XP', () => {
    expect(parseXp('4/6')).toEqual({ current: 4, max: 6 })
  })

  it('rejects impossible readings', () => {
    expect(parseXp('7/6')).toBeNull()
    expect(parseXp('4/0')).toBeNull()
    expect(parseXp('46')).toBeNull()
    expect(parseXp(null)).toBeNull()
  })
})
