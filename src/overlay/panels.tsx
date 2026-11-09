// Full-overlay penalty banner and the pinned checks widget
import type { AppState, PinnedCheck } from '../types/state'

const MAX_PINNED_CHECKS = 3

export function PenaltyBanner({ state }: { state: AppState }) {
  if (state.isValidRun) return null

  const reason = state.lastViolationReason ?? 'A rule was broken'
  return (
    <div className="pointer-events-none absolute left-1/2 top-8 w-[min(92vw,980px)] -translate-x-1/2">
      <div className="rounded-[14px] border-[3px] border-af-yellow bg-af-red px-6 py-5 text-center font-body shadow-[7px_7px_0_#111111]">
        <div className="font-display text-5xl leading-none tracking-wide text-white">
          RULE VIOLATION: Current run invalidated.
        </div>
        <div className="mt-2 text-lg font-semibold text-white">
          {reason}{state.lastViolationStage ? ` (stage ${state.lastViolationStage})` : ''}
        </div>
        <div className="mt-1 text-sm text-white/80">
          False positive? Override it in the desktop tracker.
        </div>
      </div>
    </div>
  )
}

export function PinnedQuestLog({ checks }: { checks: PinnedCheck[] }) {
  const visibleChecks = checks.slice(0, MAX_PINNED_CHECKS)
  if (visibleChecks.length === 0) return null

  return (
    <div className="w-72 font-body text-sm text-white">
      <div className="af-heading mb-2">
        Pinned Checks
      </div>
      <ul className="space-y-2">
        {visibleChecks.map((check) => (
          <li key={check.id} className="break-words leading-snug text-white">
            <span className="mr-2 inline-block -rotate-2 rounded-md border-2 border-af-yellow bg-white px-1.5 pt-px font-display text-xs leading-tight tracking-wide text-af-ink">
              {check.category}
            </span>
            {check.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
