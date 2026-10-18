import React from 'react'
import { platform } from '../platform'
import {
  VISION_WINDOW_ID,
  type VisionActionResult,
  type VisionDebugUpdate,
  type VisionEvent,
  type VisionTextRegion,
} from '../types/vision'

function sendVisionCommand(id: string, content: unknown): void {
  platform?.sendMessage(VISION_WINDOW_ID, id, content)
}

// Compact display id for long signatures
function shortHash(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index++) hash = ((hash * 33) ^ value.charCodeAt(index)) >>> 0
  return hash.toString(16).padStart(8, '0')
}

function formatDistance(distance: number | null | undefined): string {
  return distance === null || distance === undefined ? '' : ` (distance ${distance})`
}

function TeachTextForm({ region, label, placeholder }: { region: VisionTextRegion; label: string; placeholder: string }) {
  const [value, setValue] = React.useState('')
  return (
    <form
      className="debug-match-end"
      onSubmit={(event) => {
        event.preventDefault()
        sendVisionCommand('VISION_TEACH_TEXT', { region, value })
      }}
    >
      <label>
        <span>{label}</span>
        <input placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button className="filter-button" type="submit">Teach</button>
    </form>
  )
}

function formatOptionalBoolean(value: boolean | null): string {
  if (value === null) return 'Not calibrated'
  return value ? 'Yes' : 'No'
}

export function VisionTab() {
  const [update, setUpdate] = React.useState<VisionDebugUpdate | null>(null)
  const [actionResult, setActionResult] = React.useState<VisionActionResult | null>(null)

  React.useEffect(() => {
    if (!platform) return undefined

    const removeListener = platform.onMessage((message) => {
      const event = message as VisionEvent
      if (event.id === 'VISION_DEBUG_UPDATE') setUpdate(event.content)
      if (event.id === 'VISION_ACTION_RESULT') setActionResult(event.content)
    })
    sendVisionCommand('VISION_DEBUG_SUBSCRIBE', { enabled: true })

    return () => {
      sendVisionCommand('VISION_DEBUG_SUBSCRIBE', { enabled: false })
      removeListener()
    }
  }, [])

  if (platform?.kind !== 'electron') {
    return <div className="empty-state">Screen reading is only available in the Electron app.</div>
  }

  const status = update?.status
  const gameState = update?.gameState

  return (
    <div className="content-grid">
      <section className="panel">
        <div className="panel-heading">Capture</div>
        <div className="status-list">
          <div><span>Capturing</span><strong>{status?.capturing ? 'Yes' : 'No'}</strong></div>
          <div><span>Source</span><strong>{status?.source ?? 'None'}</strong></div>
          <div><span>Frame</span><strong>{status ? `${status.frameWidth}×${status.frameHeight}` : '-'}</strong></div>
          <div><span>Region Profile</span><strong>{status?.profileKey ?? '-'}</strong></div>
          <div><span>Analyzed FPS</span><strong>{status?.analyzedFps ?? 0}</strong></div>
          {status?.error && <div><span>Error</span><strong>{status.error}</strong></div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">Detected State</div>
        <div className="status-list">
          <div>
            <span>Shop Visible</span>
            <strong>{formatOptionalBoolean(gameState?.shopVisible ?? null)}{formatDistance(update?.shopReferenceDistance)}</strong>
          </div>
          <div><span>Shop Snapshot</span><strong className="vision-mono">{gameState?.shopSnapshot.join(' | ') || '-'}</strong></div>
          <div><span>Gold</span><strong>{gameState?.gold ?? '?'} ({update?.goldGlyphCount ?? 0} glyphs)</strong></div>
          <div>
            <span>XP</span>
            <strong>
              {gameState?.xp ? `${gameState.xp.current}/${gameState.xp.max}` : '?'} (read "{update?.xpText ?? '?'}", {update?.xpGlyphCount ?? 0} glyphs)
            </strong>
          </div>
          <div><span>Stage Signature</span><strong className="vision-mono">{gameState?.stageFingerprint ? shortHash(gameState.stageFingerprint) : '-'}</strong></div>
          <div>
            <span>Augment Screen</span>
            <strong>{formatOptionalBoolean(gameState?.augmentScreenVisible ?? null)}{formatDistance(update?.augmentReferenceDistance)}</strong>
          </div>
          <div><span>Augment Cards</span><strong className="vision-mono">{gameState?.augmentCards.map(card => card.slice(0, 8)).join(' | ') || '-'}</strong></div>
          <div><span>Taught Gold</span><strong>{update?.taughtGoldDigits.join(' ') || 'None'}</strong></div>
          <div><span>Taught XP</span><strong>{update?.taughtXpChars.join(' ') || 'None'}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">Calibration</div>
        <div className="vision-actions">
          <button className="filter-button" type="button" onClick={() => sendVisionCommand('VISION_SAVE_SAMPLES', {})}>
            Save Samples
          </button>
          <button className="filter-button" type="button" onClick={() => sendVisionCommand('VISION_SET_SHOP_REFERENCE', {})}>
            Set Shop Reference (shop open)
          </button>
          <button className="filter-button" type="button" onClick={() => sendVisionCommand('VISION_SET_AUGMENT_REFERENCE', {})}>
            Set Augment Reference (augment screen open)
          </button>
          <button className="filter-button" type="button" onClick={() => sendVisionCommand('VISION_RUN_ALIGNMENT', {})}>
            Re-run HUD Alignment
          </button>
          <button className="filter-button" type="button" onClick={() => sendVisionCommand('VISION_RESET_CALIBRATION', {})}>
            Reset Calibration
          </button>
        </div>
        <TeachTextForm region="gold" label="Gold shown in game" placeholder="e.g. 12" />
        <TeachTextForm region="xp" label="XP shown in game" placeholder="e.g. 4/6" />
        {actionResult && (
          <div className={actionResult.success ? 'debug-note' : 'error-box'}>{actionResult.message}</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">HUD Alignment{update?.alignment.isAligning ? ' (searching…)' : ''}</div>
        <div className="status-list">
          {update && (['bottom', 'top', 'augment'] as const).map(group => {
            const transform = update.alignment.groups[group]
            return (
              <div key={group}>
                <span>{group}</span>
                <strong className="vision-mono">
                  {transform.source} · scale {transform.scale.toFixed(3)} · offset {Math.round(transform.offsetX)},{Math.round(transform.offsetY)}
                </strong>
              </div>
            )
          })}
          {update?.alignment.matches.map(match => (
            <div key={match.name}>
              <span>Anchor {match.name}</span>
              <strong className="vision-mono">score {match.score.toFixed(3)} · scale {match.scale.toFixed(3)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">Frame</div>
        {update?.framePreviewDataUrl
          ? <img alt="Captured TFT frame with region outlines" className="vision-frame" src={update.framePreviewDataUrl} />
          : <div className="empty-state">No frame captured. Start TFT (or the fake-game mode).</div>}
      </section>

      <section className="panel debug-wide-panel">
        <div className="panel-heading">Regions</div>
        <table className="debug-table">
          <thead>
            <tr>
              <th>Region</th>
              <th>Preview</th>
              <th>Fingerprint</th>
              <th>Luminance</th>
              <th>Contrast</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody>
            {(update?.regions ?? []).map(region => (
              <tr key={region.name}>
                <td>{region.name}</td>
                <td>{region.previewDataUrl && <img alt={region.name} className="vision-region-preview" src={region.previewDataUrl} />}</td>
                <td className="vision-mono">{region.fingerprint}</td>
                <td>{region.luminance}</td>
                <td>{region.contrast}</td>
                <td>{region.changeCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
