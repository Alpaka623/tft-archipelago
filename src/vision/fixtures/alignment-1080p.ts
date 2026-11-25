// Saved HUD alignment from a player's vision-calibration.json (1920x1080, v0.5.11, 2026-11-25).
// The bottom group came from an earlier match; in this normal match the shop sat ~100 px further right,
// no bottom anchor matched, and the stale bottom group was kept for the whole match.
import type { AnchorMatch, HudAlignment } from '../alignment'

export const PLAYER_REPORT_1080P_RUN_MATCHES: AnchorMatch[] = [
  { name: 'buy_xp', group: 'bottom', x: 916, y: 696, scale: 0.4, score: 0.6089366027682521 },
  { name: 'reroll_label', group: 'bottom', x: 909, y: 675, scale: 0.56, score: 0.7096152118380785 },
  { name: 'stage_icon', group: 'top', x: 892, y: 4, scale: 0.76, score: 0.9531288981223114 },
  { name: 'choose_one', group: 'augment', x: 1276, y: 44, scale: 0.4, score: 0.7804598429528204 },
]

export const PLAYER_REPORT_1080P_ALIGNMENT: HudAlignment = {
  profileKey: '1920x1080',
  groups: {
    bottom: { scale: 0.75, offsetX: 0.5, offsetY: 0, score: 0.9326660644638665, source: 'anchor' },
    top: { scale: 0.75, offsetX: 56, offsetY: 1, score: 0.9594791612221627, source: 'anchor' },
    augment: { scale: 0.75, offsetX: 0, offsetY: 0, score: 0.9435367385477091, source: 'anchor' },
  },
  matches: PLAYER_REPORT_1080P_RUN_MATCHES,
}
