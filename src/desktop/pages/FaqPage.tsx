import React from 'react'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconDeviceGamepad2,
  IconGift,
  IconListCheck,
  IconRocket,
  IconSearch,
  IconTool,
  type Icon,
} from '@tabler/icons-react'
import type { PageId } from '../shared'

interface FaqEntry {
  id: string
  question: string
  answer: React.ReactNode
  // Plain-text copy of the answer for the search
  keywords: string
}

interface FaqSection {
  id: string
  title: string
  icon: Icon
  entries: FaqEntry[]
}

const FAQ_SECTIONS: FaqSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    icon: IconRocket,
    entries: [
      {
        id: 'what-is-this',
        question: 'What is this app, and how does it enforce the restrictions?',
        keywords: 'archipelago randomizer overlay blocker click hotkey vanguard anti-cheat passive restrictions',
        answer: (
          <>
            <p>It is the Archipelago client for TFT. You start with almost nothing unlocked: no shop rerolls, no XP buys, no augment rerolls, only the middle augment and three of five shop slots. Archipelago items unlock more over time.</p>
            <p>Blockers are app windows placed over locked buttons, such as reroll, XP or a locked shop slot. They catch your mouse clicks before they reach the game. The app never touches the game itself or its input, so Riot Vanguard has nothing to object to.</p>
            <p>Hotkeys like <code>D</code> and <code>F</code> still reach the game, so the app also watches what happens. Going over a limit anyway invalidates the current match.</p>
          </>
        ),
      },
      {
        id: 'setup-multiworld',
        question: 'How do I set up a multiworld?',
        keywords: 'yaml apworld generate host launcher custom_worlds players upload archipelago.gg',
        answer: (
          <>
            <p>Open <strong>Setup</strong> and follow the walkthrough. It creates your player YAML and saves the APWorld. Then the host:</p>
            <ol>
              <li>double-clicks the APWorld to install it into <code>custom_worlds</code>;</li>
              <li>puts all YAMLs into <code>Players</code> and clicks Generate in the Archipelago Launcher;</li>
              <li>uploads the generated <code>.zip</code> from <code>output</code> to archipelago.gg, or hosts it with the Launcher.</li>
            </ol>
            <p>The archipelago.gg website can only generate games for official worlds, so generate with your local Archipelago Launcher. You can still upload the result to archipelago.gg to host it there.</p>
          </>
        ),
      },
      {
        id: 'keep-open',
        question: 'Does the app have to run while I play?',
        keywords: 'open running start before game closed offline connect',
        answer: (
          <>
            <p>Yes. Start the app and connect to Archipelago before you queue. Checks come from the TFT client's own files and the Riot client while the game runs. A match played without the app is not tracked.</p>
            <p>If you lose the Archipelago connection, completed checks are queued and sent when you connect again.</p>
          </>
        ),
      },
      {
        id: 'install-update',
        question: 'How do I install and update the app?',
        keywords: 'installer setup smartscreen unknown publisher windows protected your pc update version restart uninstall',
        answer: (
          <>
            <p>Run the <code>TFT-Archipelago-Setup</code> installer. It installs for your Windows user only and needs no admin rights. The installer is not signed yet, so Windows SmartScreen may say "Windows protected your PC": click <strong>More info</strong>, then <strong>Run anyway</strong>.</p>
            <p>The app looks for updates on its own and downloads them in the background. A downloaded update installs when you quit the app, or right away with <strong>Restart</strong> at the bottom of the sidebar. It never restarts while TFT is running. The sidebar also shows your app version.</p>
            <p>Uninstalling keeps your settings and rule violation evidence in <code>Documents/TFTArchipelago</code>.</p>
          </>
        ),
      },
      {
        id: 'goal',
        question: 'When have I won?',
        keywords: 'goal victory finish major checks number',
        answer: (
          <p>You win when you have completed the number of <strong>major</strong> checks set as your goal in the YAML (default 10). Overview shows your progress.</p>
        ),
      },
    ],
  },
  {
    id: 'game-modes',
    title: 'Game modes',
    icon: IconDeviceGamepad2,
    entries: [
      {
        id: 'which-modes',
        question: 'Which game modes count?',
        keywords: 'modes queue normal ranked tockers trials double up revival not counted',
        answer: (
          <>
            <p>Three queues count: <strong>Normal</strong>, <strong>Ranked</strong> and <strong>Tocker's Trials</strong>.</p>
            <p>Every other mode, such as Double Up or set revivals, is shown as "not counted". You can play it with the app open, but it completes no checks.</p>
          </>
        ),
      },
      {
        id: 'tockers-trials',
        question: "How do checks work in Tocker's Trials?",
        keywords: "tockers trials pve lives victory surrender 3-10 stage 5 placement top 4",
        answer: (
          <>
            <p>Tocker's Trials has 30 rounds against PvE boards in three stages (1-1 to 3-10) and you have three lives. Riot reports first place for every Tocker's game, so Top 4 means nothing there.</p>
            <ul>
              <li><strong>Major checks</strong> need a victory: finish round 3-10 with at least one life left. Losing the final fight is fine as long as a life is left. Surrendering or running out of lives sends no majors.</li>
              <li><strong>Minor checks</strong> work as in other modes, for example fielding a 2-Star champion.</li>
              <li><strong>"Reach Stage 5"</strong> cannot be completed here, since the mode only has three stages.</li>
            </ul>
          </>
        ),
      },
    ],
  },
  {
    id: 'checks',
    title: 'Checks',
    icon: IconListCheck,
    entries: [
      {
        id: 'majors-minors',
        question: 'What is the difference between major and minor checks?',
        keywords: 'major minor top 4 trait champion board live round end',
        answer: (
          <>
            <p><strong>Major checks</strong> ask for a trait or a champion on your final board, for example "Reach Top 4 with 7 Blossom active". They are checked at match end and need a Top 4 finish (a victory in Tocker's Trials). Only unlocked majors count; each Progressive Major Check Unlock opens one more.</p>
            <p><strong>Minor checks</strong>, such as "Field a 2-Star Akali", "Have 5 Traits active" or "Reach level 8", are completed during the match as soon as the condition is met. They do not need a Top 4 finish.</p>
          </>
        ),
      },
      {
        id: 'check-not-counted',
        question: 'Why did a check not count?',
        keywords: 'missing not sent bench board invalid run locked queue',
        answer: (
          <>
            <p>The most common reasons:</p>
            <ul>
              <li>The run was invalidated by a rule violation. Invalid runs send no checks.</li>
              <li>The mode is not counted (see Game modes).</li>
              <li>The champion was on your bench. Only units on the board count, and the board is read after each round, not mid-fight.</li>
              <li>The major check is still locked. Locked majors appear under Checks with a lock note.</li>
              <li>You finished below Top 4, or lost Tocker's Trials, so no majors were sent.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'no-unlocks-hard-checks',
        question: 'Why do 3-Star checks for 4- and 5-cost champions never give unlocks?',
        keywords: '3-star three star 4-cost 5-cost filler excluded hard',
        answer: (
          <p>They are very hard to get, so the generator never places an unlock you need there. They only hold one-time items, traps or nothing. You never have to chase them to progress.</p>
        ),
      },
      {
        id: 'pin-checks',
        question: 'How do I show checks in the in-game overlay?',
        keywords: 'pin pinned overlay quest log three',
        answer: (
          <p>Open <strong>Checks</strong> and use the pin button on a check, or click a 2★/3★ button on a champion tile. Up to three pinned checks appear in the overlay and in the sidebar. Click again, or use the button in the sidebar, to unpin. Completed checks cannot be pinned.</p>
        ),
      },
    ],
  },
  {
    id: 'items',
    title: 'Items and traps',
    icon: IconGift,
    entries: [
      {
        id: 'progressive-items',
        question: 'What do the unlock items do?',
        keywords: 'progressive reroll xp buy augment reroll slot left right shop slot unlock unlimited',
        answer: (
          <ul>
            <li><strong>Progressive Reroll:</strong> +1 shop reroll per round, unlimited after 10.</li>
            <li><strong>Progressive XP Buy:</strong> +1 XP buy per round, unlimited after 10.</li>
            <li><strong>Progressive Augment Reroll:</strong> +1 augment reroll per game, unlimited after 9.</li>
            <li><strong>Augment Slot Left / Right:</strong> you may pick that augment.</li>
            <li><strong>Shop Slot Unlock:</strong> you may buy from shop slot 4 or 5.</li>
            <li><strong>Progressive Major Check Unlock:</strong> opens the next major check.</li>
          </ul>
        ),
      },
      {
        id: 'one-time-items',
        question: 'What are one-time items and how do I use them?',
        keywords: 'bonus reroll bonus xp buy augment free augment pick shop slot pass stock consume',
        answer: (
          <>
            <p>One-time items are used once and then gone. The app uses them automatically when you go over a limit, so the run stays valid:</p>
            <ul>
              <li><strong>Bonus Reroll / Bonus XP Buy:</strong> one shop reroll or XP buy over this round's limit.</li>
              <li><strong>Bonus Augment Reroll:</strong> one augment reroll over this game's limit.</li>
              <li><strong>Shop Slot Pass:</strong> one purchase from a locked shop slot.</li>
              <li><strong>Free Augment Pick:</strong> not automatic. Click the button on a locked augment slot blocker to open both outer slots for that augment selection.</li>
            </ul>
            <p>Your stock is shown on the Unlocks page and in the overlay.</p>
          </>
        ),
      },
      {
        id: 'traps',
        question: 'What do traps do?',
        keywords: 'trap reroll lock xp lock augment lock shop lock round',
        answer: (
          <>
            <p>Traps only appear if the YAML enables them. A received trap starts at the next round:</p>
            <ul>
              <li><strong>Reroll Lock Trap:</strong> no shop rerolls for a round.</li>
              <li><strong>XP Lock Trap:</strong> no XP buys for a round.</li>
              <li><strong>Shop Lock Trap:</strong> slots 4 and 5 are locked for a round, even if unlocked.</li>
              <li><strong>Augment Lock Trap:</strong> only the middle augment for your next augment selection.</li>
            </ul>
            <p>Waiting and active traps are shown on the Unlocks page and in amber in the overlay.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'violations',
    title: 'Rule violations',
    icon: IconAlertTriangle,
    entries: [
      {
        id: 'what-invalidates',
        question: 'What invalidates a run?',
        keywords: 'violation invalid banner limit reroll xp augment locked slot',
        answer: (
          <>
            <p>Going over a limit without a matching one-time item: rerolling or buying XP too often, rerolling augments too often, picking a locked augment slot or buying from a locked shop slot.</p>
            <p>A red banner then shows in the overlay. The rest of the match sends no checks, unless you override the violation.</p>
          </>
        ),
      },
      {
        id: 'override',
        question: 'The app flagged a violation I did not commit. What can I do?',
        keywords: 'false positive override wrong mistake chat announce hold',
        answer: (
          <>
            <p>Open <strong>Overview</strong>, click "Override…" in the red panel and hold the confirm button. The run becomes valid again.</p>
            <ul>
              <li>The override is posted to the multiworld chat under your name, so everyone can see it.</li>
              <li>You must be connected to Archipelago.</li>
              <li>It only works while the match is running. Once the game closes, the result is final.</li>
            </ul>
            <p>Every violation also saves a screenshot and details to <code>Documents/TFTArchipelago/violations</code>. These help to fix wrong detections.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: IconTool,
    entries: [
      {
        id: 'pending-result',
        question: 'My match result shows as pending. Is that a problem?',
        keywords: 'pending result waiting match history minutes delay riot client',
        answer: (
          <p>Usually the result arrives within seconds after the game closes. If the TFT client did not write its final file, the app waits for Riot's match history instead. It lists a game only a few minutes later. Keep the app open; pending results are also saved and finished on the next start.</p>
        ),
      },
      {
        id: 'riot-client',
        question: 'The sidebar does not show my Riot client.',
        keywords: 'riot client league client not found lockfile phase lobby',
        answer: (
          <p>The app reads the Riot client running on this PC. Start the Riot client and log in. The status updates within a few seconds. Without it, the app cannot tell which mode you are playing, so live checks wait and results may only arrive later from the match history.</p>
        ),
      },
    ],
  },
]

function FaqItem({ entry, open, onToggle }: { entry: FaqEntry; open: boolean; onToggle: () => void }) {
  return (
    <div className={`faq-item ${open ? 'open' : ''}`}>
      <button aria-expanded={open} className="faq-question" type="button" onClick={onToggle}>
        <span>{entry.question}</span>
        <IconChevronDown className="faq-chevron" size={16} />
      </button>
      <div className={`collapsible ${open ? 'open' : ''}`}>
        <div className="collapsible-inner">
          <div className="faq-answer">{entry.answer}</div>
        </div>
      </div>
    </div>
  )
}

export function FaqPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const [search, setSearch] = React.useState('')
  const [openIds, setOpenIds] = React.useState<Set<string>>(() => new Set())
  const query = search.trim().toLowerCase()

  const sections = FAQ_SECTIONS
    .map(section => ({
      ...section,
      entries: query
        ? section.entries.filter(entry => `${entry.question} ${entry.keywords}`.toLowerCase().includes(query))
        : section.entries,
    }))
    .filter(section => section.entries.length > 0)

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="page faq-page">
      <div className="toolbar">
        <div>
          <h2 className="faq-title">Frequently asked questions</h2>
          <p className="faq-lead">How the randomizer works, which modes count and what to do when something looks wrong.</p>
        </div>
        <label className="search">
          <IconSearch size={15} />
          <input placeholder="Search questions" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </div>

      {sections.length === 0 && (
        <section className="panel faq-empty">
          No question matches "{search.trim()}". New here? <button className="link-button" type="button" onClick={() => onNavigate('setup')}>Open the setup walkthrough</button>.
        </section>
      )}

      {sections.map(({ id, title, icon: SectionIcon, entries }) => (
        <section key={id} className="panel faq-section">
          <div className="panel-header compact">
            <h3><SectionIcon size={16} />{title}</h3>
          </div>
          {entries.map(entry => (
            // While searching, every match is open
            <FaqItem key={entry.id} entry={entry} open={query !== '' || openIds.has(entry.id)} onToggle={() => toggle(entry.id)} />
          ))}
        </section>
      ))}
    </div>
  )
}
