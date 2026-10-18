// Full-overlay penalty banner and the pinned checks widget
import type { AppState, PinnedCheck } from '../types/state'

const MAX_PINNED_CHECKS = 3

export function PenaltyBanner({ state }: { state: AppState }) {
  if (state.isValidRun) return null

  const reason = state.lastViolationReason ?? 'A rule was broken'
  return (
    <div className="pointer-events-none absolute left-1/2 top-8 w-[min(92vw,980px)] -translate-x-1/2">
      <div className="border border-red-300 bg-red-700/95 px-6 py-5 text-center shadow-2xl shadow-red-950/40">
        <div className="text-3xl font-black uppercase tracking-normal text-white">
          RULE VIOLATION: Current run invalidated.
        </div>
        <div className="mt-2 text-lg font-semibold text-red-50">
          {reason}{state.lastViolationStage ? ` (stage ${state.lastViolationStage})` : ''}
        </div>
        <div className="mt-1 text-sm text-red-100/80">
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
    <div className="w-72 text-sm text-white">
      <div className="mb-2 text-xs font-semibold uppercase tracking-normal text-zinc-300">
        Pinned Checks
      </div>
      <ul className="space-y-2">
        {visibleChecks.map((check) => (
          <li key={check.id} className="break-words leading-snug text-zinc-100">
            <span className="mr-2 rounded-full border border-white/10 bg-white/10 px-1.5 py-0.5 text-[10px] font-black uppercase text-zinc-300">
              {check.category}
            </span>
            {check.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
