import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '../platform'
import type { VisionStatus } from '../types/vision'
import { REFERENCE_ANCHOR_RECTS, type AnchorMatch, type AnchorTemplate } from './alignment'
import { CalibrationStore } from './calibration'
import { PLAYER_REPORT_1080P_ALIGNMENT, PLAYER_REPORT_1080P_RUN_MATCHES } from './fixtures/alignment-1080p'
import { HudAligner } from './hud-aligner'

// The anchor search itself is image work; here it returns what the player's frames produced
const search = vi.hoisted(() => ({
  results: new Map<string, AnchorMatch>(),
  calls: [] as { name: string; scaleHint: number | null }[],
}))

vi.mock('./alignment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./alignment')>()
  return {
    ...actual,
    findAnchor: (_frame: unknown, anchor: AnchorTemplate, scaleHint: number | null = null): AnchorMatch => {
      search.calls.push({ name: anchor.name, scaleHint })
      return search.results.get(anchor.name) ?? { name: anchor.name, group: anchor.group, x: 0, y: 0, scale: 1, score: 0.3 }
    },
    // Cached matches from the saved file are not at the same spot in the new match
    verifyAnchor: () => 0,
  }
})

const FRAME = { getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) } as unknown as OffscreenCanvasRenderingContext2D

function setSearchResults(matches: AnchorMatch[]): void {
  search.results = new Map(matches.map(match => [match.name, match]))
}

function createPlatform(savedFile: string) {
  return {
    sendMessage: vi.fn(),
    readDocumentsFile: vi.fn(async () => savedFile),
    writeDocumentsFile: vi.fn(async () => true),
    getCaptureGeometry: vi.fn(async () => null),
  }
}

async function createAligner(platform: ReturnType<typeof createPlatform>) {
  const status: VisionStatus = {
    capturing: true,
    source: 'window',
    sourceId: 'window:1',
    frameWidth: 1920,
    frameHeight: 1080,
    profileKey: '1920x1080',
    analyzedFps: 10,
    error: null,
  }
  const calibration = new CalibrationStore(platform as unknown as Platform)
  await calibration.load()
  const aligner = new HudAligner(platform as unknown as Platform, status, calibration)
  aligner.handleProfileChanged('1920x1080')
  await vi.waitFor(() => expect(platform.getCaptureGeometry).toHaveBeenCalled())
  return aligner
}

// One retry tick far enough after the last attempt, then wait for the search to finish
async function retry(aligner: HudAligner, shopVisible: boolean | null = true): Promise<void> {
  aligner.maybeRealign(FRAME, shopVisible, performance.now() + 60_000)
  await vi.waitFor(() => expect(aligner.isAligning).toBe(false))
}

function buyXpAt(shiftX: number): AnchorMatch {
  const anchor = REFERENCE_ANCHOR_RECTS.buy_xp
  return { name: 'buy_xp', group: 'bottom', x: anchor.x * 0.75 + shiftX, y: anchor.y * 0.75, scale: 0.75, score: 0.95 }
}

beforeEach(() => {
  vi.stubGlobal('window', globalThis)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  search.calls = []
  setSearchResults(PLAYER_REPORT_1080P_RUN_MATCHES)
})

describe('HudAligner with the player-reported calibration file', () => {
  const savedFile = JSON.stringify({ version: 1, profiles: { '1920x1080': { alignment: PLAYER_REPORT_1080P_ALIGNMENT } } })

  it('treats the saved alignment as unconfirmed before the first search', async () => {
    const aligner = await createAligner(createPlatform(savedFile))

    expect(aligner.isHudVerified()).toBe(false)
    expect(aligner.getAlignment().groups.bottom.source).toBe('cached')
  })

  it('does not confirm or save the stale bottom group when only the stage icon matches', async () => {
    const platform = createPlatform(savedFile)
    const aligner = await createAligner(platform)

    await retry(aligner)

    expect(aligner.isHudVerified()).toBe(false)
    expect(aligner.getAlignment().groups.bottom.source).toBe('cached')
    expect(platform.writeDocumentsFile).not.toHaveBeenCalled()
  })

  it('keeps searching for the bottom anchor, mostly around the expected scale', async () => {
    const aligner = await createAligner(createPlatform(savedFile))

    for (let attempt = 0; attempt < 5; attempt++) await retry(aligner)

    const hints = search.calls.filter(call => call.name === 'buy_xp').map(call => call.scaleHint)
    expect(hints).toEqual([null, 0.75, 0.75, 0.75, null])
  })

  it('searches the other anchors full range only on full-search attempts, and the reroll label only with buy_xp', async () => {
    const aligner = await createAligner(createPlatform(savedFile))

    for (let attempt = 0; attempt < 5; attempt++) await retry(aligner, false)

    const hints = (name: string) => search.calls.filter(call => call.name === name).map(call => call.scaleHint)
    expect(hints('stage_icon')).toEqual([null, 0.75, 0.75, 0.75, null])
    expect(hints('choose_one')).toEqual([null, 0.75, 0.75, 0.75, null])
    expect(hints('reroll_label')).toEqual([])
  })

  it('searches the augment header only while the shop is hidden', async () => {
    const aligner = await createAligner(createPlatform(savedFile))

    await retry(aligner, true)
    expect(search.calls.filter(call => call.name === 'choose_one')).toHaveLength(0)

    await retry(aligner, null)
    expect(search.calls.filter(call => call.name === 'choose_one')).toHaveLength(1)
  })

  it('discards a search whose trust was reset while it ran', async () => {
    const platform = createPlatform(savedFile)
    const aligner = await createAligner(platform)
    setSearchResults([buyXpAt(100)])

    // buy_xp is searched synchronously on the old frame; the match state changes during the next yield
    aligner.maybeRealign(FRAME, true, performance.now() + 60_000)
    aligner.markUnverified()
    await vi.waitFor(() => expect(aligner.isAligning).toBe(false))

    expect(aligner.isHudVerified()).toBe(false)
    expect(aligner.getAlignment().groups.bottom.source).toBe('cached')
    expect(platform.writeDocumentsFile).not.toHaveBeenCalled()

    await retry(aligner)
    expect(aligner.isHudVerified()).toBe(true)
  })

  it('writes the calibration file once while the top group stays unconfirmed', async () => {
    const saved = structuredClone(PLAYER_REPORT_1080P_ALIGNMENT)
    // Neither the saved top group nor the stage icon agrees with the bottom group found below
    saved.groups.top.offsetX += 400
    const platform = createPlatform(JSON.stringify({ version: 1, profiles: { '1920x1080': { alignment: saved } } }))
    const aligner = await createAligner(platform)
    const stageIcon = PLAYER_REPORT_1080P_RUN_MATCHES.find(match => match.name === 'stage_icon')!
    setSearchResults([{ ...stageIcon, x: stageIcon.x + 400 }, buyXpAt(100)])

    for (let attempt = 0; attempt < 5; attempt++) await retry(aligner)

    expect(aligner.isHudVerified()).toBe(true)
    expect(aligner.getAlignment().groups.top.source).toBe('fallback')
    expect(search.calls.filter(call => call.name === 'stage_icon')).toHaveLength(5)
    expect(platform.writeDocumentsFile).toHaveBeenCalledTimes(1)
  })

  it('does not rewrite the file when the next match confirms the same alignment', async () => {
    const platform = createPlatform(savedFile)
    const aligner = await createAligner(platform)
    setSearchResults([buyXpAt(100)])
    await retry(aligner)
    expect(platform.writeDocumentsFile).toHaveBeenCalledTimes(1)

    aligner.markUnverified()
    await retry(aligner)

    expect(aligner.isHudVerified()).toBe(true)
    expect(platform.writeDocumentsFile).toHaveBeenCalledTimes(1)
  })

  it('confirms, saves and moves the regions once the shop shows up at its real position', async () => {
    const platform = createPlatform(savedFile)
    const aligner = await createAligner(platform)
    await retry(aligner)

    setSearchResults([...PLAYER_REPORT_1080P_RUN_MATCHES.filter(match => match.name !== 'buy_xp'), buyXpAt(100)])
    await retry(aligner)

    expect(aligner.isHudVerified()).toBe(true)
    expect(aligner.getAlignment().groups.bottom).toMatchObject({ source: 'anchor', offsetX: 100 })
    expect(aligner.getRegions().gold.x).toBeGreaterThan(90)
    expect(platform.writeDocumentsFile).toHaveBeenCalledTimes(1)
  })

  it('stops searching once the whole HUD is confirmed in this match', async () => {
    const aligner = await createAligner(createPlatform(savedFile))
    setSearchResults([buyXpAt(0.5), { ...PLAYER_REPORT_1080P_RUN_MATCHES[2], x: 684, scale: 0.75 }])
    await retry(aligner)
    expect(aligner.isHudVerified()).toBe(true)

    search.calls = []
    await retry(aligner)

    expect(search.calls).toEqual([])
  })

  it('reports augment blockers as measured only once the bottom group confirms them', async () => {
    const platform = createPlatform(savedFile)
    const aligner = await createAligner(platform)
    const reference = REFERENCE_ANCHOR_RECTS.choose_one
    const chooseOne: AnchorMatch = { name: 'choose_one', group: 'augment', x: reference.x * 0.75, y: reference.y * 0.75, scale: 0.75, score: 0.95 }
    const lastAnchoredBlockers = () => {
      const sent = platform.sendMessage.mock.calls.filter(call => call[1] === 'VISION_HUD_ALIGNMENT')
      return (sent.at(-1)?.[2] as { anchoredBlockers: string[] }).anchoredBlockers
    }

    // Augment screen right after a reconnect: the shop is hidden, only the augment header matches
    setSearchResults([chooseOne])
    await retry(aligner, false)
    expect(aligner.getAlignment().groups.augment.source).toBe('anchor')
    expect(lastAnchoredBlockers()).toEqual([])

    setSearchResults([buyXpAt(0.5), chooseOne])
    await retry(aligner)
    expect(lastAnchoredBlockers()).toEqual(expect.arrayContaining(['augment_slot_left_blocker', 'xp_button_blocker']))
  })

  it('asks for confirmation again after the next match starts', async () => {
    const aligner = await createAligner(createPlatform(savedFile))
    setSearchResults([buyXpAt(0.5)])
    await retry(aligner)
    expect(aligner.isHudVerified()).toBe(true)

    aligner.markUnverified()

    expect(aligner.isHudVerified()).toBe(false)
    expect(aligner.getAlignment().groups.bottom.source).toBe('cached')
  })
})
