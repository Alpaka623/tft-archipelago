import React from 'react'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconFileCode,
  IconFlame,
  IconMinus,
  IconPencil,
  IconPlugConnected,
  IconPlus,
  IconPuzzle,
  IconServer,
  IconSparkles,
  IconAdjustments,
  IconBomb,
  IconCircleDashed,
  IconGift,
  type Icon,
} from '@tabler/icons-react'
import { platform, type SaveDownloadRequest } from '../../platform'
import {
  APWORLD_BUNDLED_PATH,
  APWORLD_FILE_NAME,
  APWORLD_VERSION,
  MAJOR_CHECK_TOTAL,
  MAX_SLOT_NAME_LENGTH,
  MAX_TRAP_SHARE,
  START_ITEMS,
  buildPlayerYaml,
  readSetup,
  toYamlFileName,
  validateSlotName,
  writeSetup,
  type SetupSettings,
} from '../setup'
import type { PageId } from '../shared'

// Step-by-step walkthrough for a new run, one question per screen. The settings, YAML and
// downloads come from ../setup.
const STEP_STORAGE_KEY = 'tft-archipelago-setup-step'
const STEPS = ['welcome', 'name', 'goal', 'majors', 'unlocks', 'rewards', 'summary', 'host'] as const
type StepId = typeof STEPS[number]
type UnlockMode = 'hardcore' | 'gentle' | 'custom'
type RewardMode = 'bonus' | 'traps' | 'classic' | 'custom'

// Shares for the reward presets: percent of free locations with one-time items / traps
const REWARD_PRESETS: Record<Exclude<RewardMode, 'custom'>, { bonusItemShare: number; trapShare: number }> = {
  bonus: { bonusItemShare: 100, trapShare: 0 },
  traps: { bonusItemShare: 100, trapShare: 15 },
  classic: { bonusItemShare: 0, trapShare: 0 },
}

function detectRewardMode(settings: SetupSettings): RewardMode {
  const preset = (Object.keys(REWARD_PRESETS) as Exclude<RewardMode, 'custom'>[]).find(mode => (
    REWARD_PRESETS[mode].bonusItemShare === settings.bonusItemShare && REWARD_PRESETS[mode].trapShare === settings.trapShare
  ))
  return preset ?? 'custom'
}

function describeRewards(settings: SetupSettings): string {
  const parts = [`${settings.bonusItemShare}% one-time items`]
  if (settings.trapShare > 0) parts.push(`${settings.trapShare}% traps`)
  return parts.join(', ')
}
type SaveStatus = { kind: 'saved'; path: string } | { kind: 'failed'; fileName: string } | null

const GENTLE_START_ITEMS: Record<string, number> = { 'Progressive Reroll': 1, 'Progressive XP Buy': 1 }

interface Preset {
  value: number
  title: string
  subtitle: string
}

const GOAL_PRESETS: Preset[] = [
  { value: 5, title: 'Short', subtitle: 'An evening or two' },
  { value: 10, title: 'Normal', subtitle: 'The default run' },
  { value: 20, title: 'Long', subtitle: 'For a long async' },
]

const MAJOR_PRESETS: Preset[] = [
  { value: 6, title: 'Few', subtitle: 'Unlocks matter a lot' },
  { value: 11, title: 'Normal', subtitle: 'The default' },
  { value: 18, title: 'Many', subtitle: 'More freedom early' },
]

function readStep(): number {
  try {
    const step = Number(window.localStorage.getItem(STEP_STORAGE_KEY))
    return Number.isInteger(step) && step >= 0 && step < STEPS.length ? step : 0
  } catch {
    return 0
  }
}

function writeStep(step: number): void {
  try {
    window.localStorage.setItem(STEP_STORAGE_KEY, String(step))
  } catch {
    // Storage can be unavailable; the walkthrough starts at the beginning next time
  }
}

function sameItems(left: Record<string, number>, right: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every(key => (left[key] ?? 0) === (right[key] ?? 0))
}

function detectUnlockMode(startItems: Record<string, number>): UnlockMode {
  if (Object.values(startItems).every(count => count === 0)) return 'hardcore'
  return sameItems(startItems, GENTLE_START_ITEMS) ? 'gentle' : 'custom'
}

function describeStartItems(startItems: Record<string, number>): string {
  const entries = START_ITEMS.filter(item => (startItems[item.name] ?? 0) > 0)
  if (entries.length === 0) return 'Nothing, full zero state'
  return entries.map(item => (item.max > 1 ? `${startItems[item.name]}x ${item.name}` : item.name)).join(', ')
}

// Plain browser (Vite preview) has no platform: fall back to a normal browser download
async function saveFile(download: SaveDownloadRequest): Promise<string | null> {
  if (platform) return platform.saveDownload(download)

  const blob = 'text' in download
    ? new Blob([download.text], { type: 'text/yaml' })
    : await fetch(download.bundledPath).then(response => (response.ok ? response.blob() : null))
  if (!blob) return null

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = download.fileName
  link.click()
  URL.revokeObjectURL(url)
  return download.fileName
}

function ChoiceCard({ selected, icon: CardIcon, title, subtitle, onSelect }: {
  selected: boolean
  icon?: Icon
  title: string
  subtitle: string
  onSelect: () => void
}) {
  return (
    <button aria-pressed={selected} className={`choice-card ${selected ? 'selected' : ''}`} type="button" onClick={onSelect}>
      {CardIcon && <CardIcon size={20} />}
      <strong>{title}</strong>
      <span>{subtitle}</span>
      <span className="choice-check"><IconCheck size={12} /></span>
    </button>
  )
}

function PresetStep({ presets, value, unit, onChange }: {
  presets: Preset[]
  value: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <>
      <div className="choice-grid">
        {presets.map(preset => (
          <ChoiceCard
            key={preset.value}
            selected={value === preset.value}
            subtitle={preset.subtitle}
            title={`${preset.title} · ${preset.value}`}
            onSelect={() => onChange(preset.value)}
          />
        ))}
      </div>
      <div className="range-field wizard-range">
        <div className="range-field-header">
          <span>Or pick your own</span>
          <strong>{value} {unit}</strong>
        </div>
        <input max={MAJOR_CHECK_TOTAL} min={1} step={1} type="range" value={value} onChange={event => onChange(Number(event.target.value))} />
      </div>
    </>
  )
}

function Stepper({ value, max, label, onChange }: {
  value: number
  max: number
  label: string
  onChange: (value: number) => void
}) {
  if (max === 1) {
    return (
      <button aria-label={label} aria-pressed={value > 0} className={`toggle ${value > 0 ? 'on' : ''}`} type="button" onClick={() => onChange(value > 0 ? 0 : 1)}>
        <span />
      </button>
    )
  }

  return (
    <div className="stepper">
      <button aria-label={`Fewer ${label}`} disabled={value <= 0} type="button" onClick={() => onChange(value - 1)}>
        <IconMinus size={14} />
      </button>
      <span>{value}</span>
      <button aria-label={`More ${label}`} disabled={value >= max} type="button" onClick={() => onChange(value + 1)}>
        <IconPlus size={14} />
      </button>
    </div>
  )
}

export function SetupPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const [settings, setSettings] = React.useState<SetupSettings>(() => readSetup())
  const [step, setStep] = React.useState(() => readStep())
  const [direction, setDirection] = React.useState<'forward' | 'back'>('forward')
  const [unlockMode, setUnlockMode] = React.useState<UnlockMode>(() => detectUnlockMode(readSetup().startItems))
  const [rewardMode, setRewardMode] = React.useState<RewardMode>(() => detectRewardMode(readSetup()))
  const [nameTouched, setNameTouched] = React.useState(false)
  const [showYaml, setShowYaml] = React.useState(false)
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>(null)
  const nameInput = React.useRef<HTMLInputElement>(null)
  const wizardRef = React.useRef<HTMLDivElement>(null)

  const stepId: StepId = STEPS[step]
  const nameError = validateSlotName(settings.slotName)
  const yaml = buildPlayerYaml(settings)
  const yamlFileName = toYamlFileName(settings.slotName)

  React.useEffect(() => {
    if (stepId === 'name') nameInput.current?.focus()
    // Every step starts at the top, even when the previous one was scrolled
    wizardRef.current?.closest('.main-scroll')?.scrollTo({ top: 0 })
  }, [stepId])

  const update = (patch: Partial<SetupSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    writeSetup(next)
  }

  const goTo = (target: number) => {
    if (target === step || target < 0 || target >= STEPS.length) return
    // The name is the only required answer; later steps need it for the YAML
    if (target > STEPS.indexOf('name') && nameError) {
      setNameTouched(true)
      if (step !== STEPS.indexOf('name')) {
        setDirection('back')
        setStep(STEPS.indexOf('name'))
        writeStep(STEPS.indexOf('name'))
      }
      return
    }
    setDirection(target > step ? 'forward' : 'back')
    setStep(target)
    writeStep(target)
    setSaveStatus(null)
  }

  const goToStep = (id: StepId) => goTo(STEPS.indexOf(id))

  const chooseUnlockMode = (mode: UnlockMode) => {
    setUnlockMode(mode)
    if (mode === 'hardcore') update({ startItems: {} })
    if (mode === 'gentle') update({ startItems: { ...GENTLE_START_ITEMS } })
  }

  const chooseRewardMode = (mode: RewardMode) => {
    setRewardMode(mode)
    if (mode !== 'custom') update(REWARD_PRESETS[mode])
  }

  const download = async (request: SaveDownloadRequest) => {
    const savedPath = await saveFile(request)
    // A cancelled save dialog also returns null; only report real failures for bundled files
    if (savedPath) setSaveStatus({ kind: 'saved', path: savedPath })
    else if ('bundledPath' in request) setSaveStatus({ kind: 'failed', fileName: request.fileName })
  }

  const renderStep = () => {
    switch (stepId) {
      case 'welcome':
        return (
          <>
            <div className="wizard-hero"><IconPuzzle size={30} /></div>
            <h2>Start a new Archipelago run</h2>
            <p className="wizard-lead">
              A few quick questions, then you get two files for the person who hosts the multiworld.
              You can change everything later.
            </p>
            <div className="welcome-list">
              <div><IconFileCode size={18} /><span><strong>Your player file</strong>A YAML with your name and settings</span></div>
              <div><IconPuzzle size={18} /><span><strong>The TFT APWorld</strong>Teaches Archipelago how TFT works</span></div>
              <div><IconServer size={18} /><span><strong>A guide for your host</strong>Three steps to generate and host the game</span></div>
            </div>
          </>
        )
      case 'name':
        return (
          <>
            <h2>What's your player name?</h2>
            <p className="wizard-lead">This becomes your slot name. You connect with the same name later.</p>
            <input
              ref={nameInput}
              aria-invalid={nameTouched && nameError !== null}
              className="wizard-input"
              maxLength={MAX_SLOT_NAME_LENGTH}
              value={settings.slotName}
              onChange={event => update({ slotName: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') goTo(step + 1)
              }}
            />
            {nameTouched && nameError
              ? <div className="field-error">{nameError}</div>
              : <div className="field-hint">{settings.slotName.trim().length} / {MAX_SLOT_NAME_LENGTH} characters</div>}
          </>
        )
      case 'goal':
        return (
          <>
            <h2>How long should the run be?</h2>
            <p className="wizard-lead">You win once you complete this many major checks.</p>
            <PresetStep presets={GOAL_PRESETS} unit="majors" value={settings.goalChecks} onChange={goalChecks => update({ goalChecks })} />
          </>
        )
      case 'majors':
        return (
          <>
            <h2>How many majors are open at the start?</h2>
            <p className="wizard-lead">
              The other {MAJOR_CHECK_TOTAL - settings.startingMajorChecks} open one by one when someone sends you a Progressive Major Check Unlock.
            </p>
            <PresetStep presets={MAJOR_PRESETS} unit="open" value={settings.startingMajorChecks} onChange={startingMajorChecks => update({ startingMajorChecks })} />
          </>
        )
      case 'unlocks':
        return (
          <>
            <h2>Do you want a head start?</h2>
            <p className="wizard-lead">Starting unlocks are taken out of the item pool, so the run has the same unlocks in total.</p>
            <div className="choice-grid">
              <ChoiceCard icon={IconFlame} selected={unlockMode === 'hardcore'} subtitle="No rerolls, no XP, middle augment only" title="Hardcore" onSelect={() => chooseUnlockMode('hardcore')} />
              <ChoiceCard icon={IconSparkles} selected={unlockMode === 'gentle'} subtitle="1 shop reroll and 1 XP buy per round" title="Gentle start" onSelect={() => chooseUnlockMode('gentle')} />
              <ChoiceCard icon={IconAdjustments} selected={unlockMode === 'custom'} subtitle="Pick every unlock yourself" title="Custom" onSelect={() => chooseUnlockMode('custom')} />
            </div>
            <div className={`collapsible ${unlockMode === 'custom' ? 'open' : ''}`}>
              <div className="collapsible-inner">
                <div className="custom-unlocks">
                  {START_ITEMS.map(item => (
                    <div key={item.name} className="kv-row">
                      <span className="kv-label">{item.name}</span>
                      <Stepper
                        label={item.name}
                        max={item.max}
                        value={settings.startItems[item.name] ?? 0}
                        onChange={count => update({ startItems: { ...settings.startItems, [item.name]: count } })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )
      case 'rewards':
        return (
          <>
            <h2>What should the other checks give?</h2>
            <p className="wizard-lead">
              All unlocks are always in the pool. The remaining checks get one-time items such as Bonus Reroll, each usable once
              beyond your limit. The hardest checks (3-star 4- and 5-costs) only ever hold these, never something you need.
            </p>
            <div className="choice-grid">
              <ChoiceCard icon={IconGift} selected={rewardMode === 'bonus'} subtitle="Every free check holds a one-time item" title="Bonus items" onSelect={() => chooseRewardMode('bonus')} />
              <ChoiceCard icon={IconBomb} selected={rewardMode === 'traps'} subtitle="Bonus items, plus some traps like no rerolls next round" title="With traps" onSelect={() => chooseRewardMode('traps')} />
              <ChoiceCard icon={IconCircleDashed} selected={rewardMode === 'classic'} subtitle="Free checks hold Nothing" title="Classic" onSelect={() => chooseRewardMode('classic')} />
            </div>
            <button className={`yaml-toggle ${rewardMode === 'custom' ? 'open' : ''}`} type="button" onClick={() => setRewardMode(rewardMode === 'custom' ? detectRewardMode(settings) : 'custom')}>
              <IconAdjustments size={14} />Fine-tune
            </button>
            <div className={`collapsible ${rewardMode === 'custom' ? 'open' : ''}`}>
              <div className="collapsible-inner">
                <div className="custom-unlocks">
                  <div className="range-field wizard-range">
                    <div className="range-field-header"><span>One-time items instead of Nothing</span><strong>{settings.bonusItemShare}%</strong></div>
                    <input max={100} min={0} step={5} type="range" value={settings.bonusItemShare} onChange={event => update({ bonusItemShare: Number(event.target.value) })} />
                  </div>
                  <div className="range-field wizard-range">
                    <div className="range-field-header"><span>Traps</span><strong>{settings.trapShare}%</strong></div>
                    <input max={MAX_TRAP_SHARE} min={0} step={5} type="range" value={settings.trapShare} onChange={event => update({ trapShare: Number(event.target.value) })} />
                  </div>
                </div>
              </div>
            </div>
          </>
        )
      case 'summary': {
        const rows: { label: string; value: string; target: StepId }[] = [
          { label: 'Player name', value: settings.slotName.trim(), target: 'name' },
          { label: 'Goal', value: `${settings.goalChecks} major checks`, target: 'goal' },
          { label: 'Open at start', value: `${settings.startingMajorChecks} of ${MAJOR_CHECK_TOTAL} majors`, target: 'majors' },
          { label: 'Starting unlocks', value: describeStartItems(settings.startItems), target: 'unlocks' },
          { label: 'Other checks', value: describeRewards(settings), target: 'rewards' },
        ]
        return (
          <>
            <h2>Your files are ready</h2>
            <p className="wizard-lead">Send both files to the host. Tap a setting to change it.</p>
            <div className="summary-grid">
              {rows.map(row => (
                <button key={row.label} className="summary-card" type="button" onClick={() => goToStep(row.target)}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                  <IconPencil size={14} />
                </button>
              ))}
            </div>
            <div className="download-row">
              <button className="btn primary large" type="button" onClick={() => void download({ fileName: yamlFileName, text: yaml })}>
                <IconDownload size={16} />Download {yamlFileName}
              </button>
              <button className="btn large" type="button" onClick={() => void download({ fileName: APWORLD_FILE_NAME, bundledPath: APWORLD_BUNDLED_PATH })}>
                <IconDownload size={16} />Download APWorld {APWORLD_VERSION}
              </button>
            </div>
            {saveStatus?.kind === 'saved' && <div className="save-note"><IconCheck size={14} />Saved to {saveStatus.path}</div>}
            {saveStatus?.kind === 'failed' && <div className="error-box save-note">Couldn't save {saveStatus.fileName}.</div>}
            <button className={`yaml-toggle ${showYaml ? 'open' : ''}`} type="button" onClick={() => setShowYaml(!showYaml)}>
              <IconChevronDown size={14} />{showYaml ? 'Hide YAML' : 'Show YAML'}
            </button>
            <div className={`collapsible ${showYaml ? 'open' : ''}`}>
              <div className="collapsible-inner">
                <pre className="yaml-preview">{yaml}</pre>
              </div>
            </div>
          </>
        )
      }
      case 'host':
        return (
          <>
            <h2>What the host does</h2>
            <p className="wizard-lead">Send this to whoever runs the game. It takes about two minutes.</p>
            <ol className="host-steps">
              <li>
                <strong>Install the APWorld</strong>
                <span>Double-click <code>{APWORLD_FILE_NAME}</code>. The Archipelago Launcher installs it into <code>custom_worlds</code>.</span>
              </li>
              <li>
                <strong>Generate the multiworld</strong>
                <span>Put every player's YAML into the <code>Players</code> folder and click Generate in the Launcher. archipelago.gg can't generate games with custom APWorlds itself.</span>
              </li>
              <li>
                <strong>Host it</strong>
                <span>Upload the generated <code>.zip</code> from the <code>output</code> folder on archipelago.gg/uploads, or use the Launcher's Host option. You get a host and port to connect to.</span>
              </li>
            </ol>
          </>
        )
    }
  }

  const isLast = step === STEPS.length - 1

  return (
    <div className="page wizard-page">
      <div ref={wizardRef} className="wizard">
        <div className="wizard-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((id, index) => (
            <button
              key={id}
              aria-label={`Go to step ${index + 1}`}
              className={`wizard-dot ${index === step ? 'current' : index < step ? 'done' : ''}`}
              type="button"
              onClick={() => goTo(index)}
            />
          ))}
        </div>

        <div key={stepId} className={`wizard-step enter-${direction}`}>
          {renderStep()}
        </div>

        <div className="wizard-nav">
          {step > 0
            ? <button className="btn ghost" type="button" onClick={() => goTo(step - 1)}><IconArrowLeft size={15} />Back</button>
            : <span />}
          {isLast
            ? (
              <button className="btn primary large" type="button" onClick={() => onNavigate('overview')}>
                <IconPlugConnected size={16} />Go to connect
              </button>
            )
            : (
              <button className="btn primary large" type="button" onClick={() => goTo(step + 1)}>
                {stepId === 'welcome' ? "Let's go" : stepId === 'summary' ? 'Next: tell the host' : 'Next'}
                <IconArrowRight size={15} />
              </button>
            )}
        </div>
      </div>
    </div>
  )
}
