import type { OrderTimelineEntry } from '../lib/order-data'
import { groupOrderTimeline } from '../lib/order-timeline-groups.mjs'
import { formatEnum } from '../lib/work-items'

function Event({ entry }: { entry: OrderTimelineEntry }) {
  return <><strong>{formatEnum(entry.title)}</strong><span>{entry.actor} · {new Date(entry.occurredAt).toLocaleString()}{entry.summary ? ` · ${entry.summary}` : ''}</span></>
}

export function OrderTimeline({ entries }: { entries: OrderTimelineEntry[] }) {
  const groups = groupOrderTimeline(entries) as Array<{ reminder: boolean; entries: OrderTimelineEntry[] }>
  if (!entries.length) return <p className="ops-muted">No timeline event recorded yet.</p>
  return <ol className="ops-timeline">{groups.map((group) => {
    const first = group.entries[0]
    return <li key={`${first.source}:${first.id}`}>
      {group.entries.length > 1 ? <details>
        <summary>{group.entries.length} automated production reminders · latest {new Date(first.occurredAt).toLocaleString()}</summary>
        <ol className="ops-timeline">{group.entries.map((entry) => <li key={`${entry.source}:${entry.id}`}><Event entry={entry} /></li>)}</ol>
      </details> : <Event entry={first} />}
    </li>
  })}</ol>
}
