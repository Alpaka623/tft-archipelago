import {
  IconBulb,
  IconCircleCheck,
  IconClockHour4,
  IconGift,
  IconSwords,
  IconUser,
  IconWorld,
  type Icon,
} from '@tabler/icons-react'
import { formatActivityTime, type ActivityLogEntry } from '../activity'

const TYPE_ICONS: Record<ActivityLogEntry['type'], { icon: Icon; tone: string }> = {
  'item': { icon: IconGift, tone: 'accent' },
  'global-item': { icon: IconWorld, tone: 'muted' },
  'check-sent': { icon: IconCircleCheck, tone: 'ok' },
  'check-queued': { icon: IconClockHour4, tone: 'warn' },
  'hint': { icon: IconBulb, tone: 'warn' },
  'match': { icon: IconSwords, tone: 'muted' },
}

function ActivityColumn({ title, icon: TitleIcon, entries, emptyText }: {
  title: string
  icon: Icon
  entries: ActivityLogEntry[]
  emptyText: string
}) {
  return (
    <section className="panel list-panel">
      <div className="panel-header list-header">
        <h3><TitleIcon size={16} />{title}</h3>
        <span className="tiny faint">{entries.length}</span>
      </div>
      {entries.length === 0 && <div className="list-empty">{emptyText}</div>}
      {entries.map((entry) => {
        const { icon: EntryIcon, tone } = TYPE_ICONS[entry.type]
        return (
          <div key={entry.id} className="activity-row">
            <span className={`activity-icon tone-${tone}`}><EntryIcon size={16} /></span>
            <div className="activity-text">
              <strong>{entry.title}</strong>
              <span>{entry.details}</span>
            </div>
            <time className="activity-time">{formatActivityTime(entry.timestamp)}</time>
          </div>
        )
      })}
    </section>
  )
}

export function ActivityPage({ entries }: { entries: ActivityLogEntry[] }) {
  return (
    <div className="page">
      <div className="activity-columns">
        <ActivityColumn
          emptyText="Items you receive, your checks, hints and match results appear here."
          entries={entries.filter(entry => entry.relatedToMe)}
          icon={IconUser}
          title="For you"
        />
        <ActivityColumn
          emptyText="Items other players find for each other appear here."
          entries={entries.filter(entry => !entry.relatedToMe)}
          icon={IconWorld}
          title="Multiworld"
        />
      </div>
    </div>
  )
}
