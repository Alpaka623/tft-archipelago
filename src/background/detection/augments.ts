// Augment phases, augment rerolls and the picked augment's slot (GEP). The vision source drives the
// same phase state from the screen instead.
import { deriveState } from '../app-state'
import { championTraits } from '../board'
import { broadcastState } from '../broadcast'
import { logGep } from '../log'
import { spendFreeAugmentPickOrInvalidate } from '../rules/bonus-usage'
import { validateCurrentRules } from '../rules/engine'
import { augments, bonus, round } from '../state'
import type { AugmentSnapshot, PickedAugmentSnapshot, RoundInfoSnapshot } from '../types'
import { areSnapshotsEqual, markNextShopChangeAsUiReturn } from './shop'

const AUGMENT_ROUND_TYPES = new Set(['Augment_1', 'Augment_2', 'Augment_3'])

export interface AugmentUpdateOptions {
  pickedAugmentInSameUpdate?: boolean
}

function normalizeChoiceName(value: string): string {
  return value.replace(/^TFT\d+_/, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

// Champion selections arrive in the same GEP augment fields but are no augment phase
const championChoiceNames = new Set(
  Object.keys(championTraits).flatMap(championId => [
    normalizeChoiceName(championId),
    normalizeChoiceName(championId.replace(/^TFT\d+_/, '')),
  ]),
)

function hasAugmentChoices(snapshot: AugmentSnapshot | null): boolean {
  return snapshot?.some(name => name.trim() !== '') ?? false
}

function isLikelyChampionSelectionSnapshot(snapshot: AugmentSnapshot): boolean {
  const choices = snapshot
    .map(name => normalizeChoiceName(name))
    .filter(Boolean)

  return choices.length > 0 && choices.every(name => championChoiceNames.has(name))
}

function isCurrentRoundAugmentRound(): boolean {
  return round.type !== null && AUGMENT_ROUND_TYPES.has(round.type)
}

function getVisibleAugmentChoiceSnapshot(): AugmentSnapshot | null {
  if (hasAugmentChoices(augments.latest)) return augments.latest
  if (hasAugmentChoices(augments.baseline)) return augments.baseline
  return null
}

function shouldKeepInferredAugmentPhaseOnRoundInfoUpdate(): boolean {
  if (!augments.isPhaseActive) return false

  const visibleChoices = getVisibleAugmentChoiceSnapshot()
  return visibleChoices !== null && !isLikelyChampionSelectionSnapshot(visibleChoices)
}

export function registerAugmentReroll(reason: string): void {
  augments.rerollsUsed += 1
  augments.didChoicesClearBeforePick = false
  logGep('GEP detection: augment reroll', { currentAugmentRerollsUsed: augments.rerollsUsed, reason })
  validateCurrentRules()
  broadcastState()
}

export function clearAugmentPhase(reason: string): void {
  if (!augments.isPhaseActive && !augments.baseline && !augments.didChoicesClearBeforePick) return

  augments.isPhaseActive = false
  augments.baseline = null
  augments.didChoicesClearBeforePick = false
  bonus.freeAugmentPickThisSelection = false
  logGep('GEP augments: augment phase cleared', { reason, currentRoundType: round.type })
  broadcastState()
}

export function handleRoundInfoUpdate(roundInfo: RoundInfoSnapshot): void {
  round.info = roundInfo
  round.type = roundInfo.type
  if (!isCurrentRoundAugmentRound()) {
    if (shouldKeepInferredAugmentPhaseOnRoundInfoUpdate()) {
      logGep('GEP round_type: non-augment label ignored while augment choices are visible', {
        roundInfo,
        currentRoundType: round.type,
      })
      return
    }

    clearAugmentPhase('round_type is not an augment round')
    return
  }

  augments.isPhaseActive = true
  augments.pickedName = null
  augments.didChoicesClearBeforePick = false
  if (augments.latest) {
    augments.baseline = [...augments.latest]
  }

  logGep('GEP round_type: augment phase detected', { roundInfo })
  broadcastState()
}

function startAugmentPhaseFromChoices(snapshot: AugmentSnapshot, message: string): void {
  augments.isPhaseActive = true
  augments.baseline = [...snapshot]
  augments.didChoicesClearBeforePick = false
  logGep(message)
  broadcastState()
}

// A changed choice set is a reroll, unless picked_augment arrived in the same update (the
// choices then clear for the pick animation)
function handleChoiceChange(snapshot: AugmentSnapshot, reason: string, pickedAugmentInSameUpdate: boolean): void {
  if (pickedAugmentInSameUpdate) {
    logGep('GEP augments: choice change ignored because picked_augment arrived in same update', {
      reason,
      currentRoundType: round.type,
      snapshot,
      baseline: augments.baseline,
    })
    return
  }

  augments.baseline = [...snapshot]
  registerAugmentReroll(reason)
}

export function handleAugmentUpdate(snapshot: AugmentSnapshot, options: AugmentUpdateOptions = {}): void {
  const previous = augments.latest
  const previousHadChoices = hasAugmentChoices(previous)
  const snapshotHasChoices = hasAugmentChoices(snapshot)
  const pickedAugmentInSameUpdate = options.pickedAugmentInSameUpdate ?? false
  augments.latest = snapshot

  if (!isCurrentRoundAugmentRound()) {
    if (!snapshotHasChoices) {
      clearAugmentPhase('empty augment snapshot outside augment round')
      return
    }

    if (isLikelyChampionSelectionSnapshot(snapshot)) {
      logGep('GEP augments: champion selection ignored', {
        currentRoundType: round.type,
        snapshot,
      })
      clearAugmentPhase('champion selection snapshot outside augment round')
      return
    }

    augments.pickedName = null
    augments.isPhaseActive = true
    augments.baseline = [...snapshot]
    augments.didChoicesClearBeforePick = false
    logGep('GEP augments: augment phase inferred from non-champion choices', {
      currentRoundType: round.type,
      snapshot,
    })
    broadcastState()
    return
  }

  if (!augments.isPhaseActive && snapshotHasChoices && !augments.pickedName) {
    startAugmentPhaseFromChoices(snapshot, 'GEP augments: augment phase inferred from visible choices')
    return
  }

  if (!augments.baseline && snapshotHasChoices) {
    augments.baseline = [...snapshot]
  }

  if (!augments.isPhaseActive) return

  if (!snapshotHasChoices) {
    if (augments.baseline && previousHadChoices && !augments.pickedName) {
      augments.didChoicesClearBeforePick = true
      logGep('GEP augments: choices cleared before picked_augment')
    }
    return
  }

  if (!augments.baseline) {
    augments.baseline = [...snapshot]
    console.log('GEP augments: baseline initialized for augment phase')
    return
  }

  if (augments.didChoicesClearBeforePick && !areSnapshotsEqual(snapshot, augments.baseline)) {
    handleChoiceChange(snapshot, 'choices_reappeared_after_clear', pickedAugmentInSameUpdate)
    return
  }

  if (previous && !areSnapshotsEqual(snapshot, augments.baseline) && !augments.pickedName) {
    handleChoiceChange(snapshot, 'choices_changed', pickedAugmentInSameUpdate)
  }
}

export function handlePickedAugmentUpdate(pickedAugment: PickedAugmentSnapshot): void {
  const pickedAugmentName = pickedAugment.name
  if (pickedAugmentName === augments.pickedName) return

  const isAugmentRoundPick = isCurrentRoundAugmentRound()
  augments.pickedName = pickedAugmentName
  augments.isPhaseActive = false
  augments.didChoicesClearBeforePick = false
  markNextShopChangeAsUiReturn('augment picked')

  const pickedAugmentSlot = augments.baseline?.findIndex(name => name === pickedAugmentName)
  const pickedAugmentPosition = pickedAugmentSlot === undefined || pickedAugmentSlot < 0
    ? pickedAugment.position ?? 'unknown'
    : pickedAugmentSlot + 1

  logGep('GEP detection: augment picked', {
    pickedAugmentPosition,
    isAugmentRoundPick,
    willTreatNextFullShopChangeAsUiReturn: true,
  })

  if (!isAugmentRoundPick) {
    augments.baseline = null
    broadcastState()
    return
  }

  const state = deriveState()
  if (pickedAugmentPosition === 1 && !state.leftAugmentUnlocked) {
    spendFreeAugmentPickOrInvalidate('Picked the locked left augment slot')
  }
  if (pickedAugmentPosition === 3 && !state.rightAugmentUnlocked) {
    spendFreeAugmentPickOrInvalidate('Picked the locked right augment slot')
  }
  bonus.freeAugmentPickThisSelection = false
  // An Augment Lock Trap covers one augment selection
  if (bonus.activeTraps.augmentLock) {
    bonus.activeTraps.augmentLock = false
    logGep('Trap ended: augment lock')
  }
  broadcastState()
}

export function handleGodPickedFavorUpdate(pickedFavor: string): void {
  if (pickedFavor === round.pickedGodFavor) return

  round.pickedGodFavor = pickedFavor
  markNextShopChangeAsUiReturn('god favor picked')
  broadcastState()
}
