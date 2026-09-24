'use client'

import { useEffect, useState } from 'react'

type BufferedEvent = {
  name: string
  properties: Record<string, boolean | number | string | null | undefined>
}

export function LifecycleEventPreviewStatus({ eventName }: { eventName: string }): React.JSX.Element {
  const [events, setEvents] = useState<BufferedEvent[]>([])

  useEffect(() => {
    const refresh = () => {
      setEvents((window.__DRAPEON_ANALYTICS_BUFFER__ ?? [])
        .filter((event) => event.name === eventName)
        .map((event) => ({ name: event.name, properties: event.properties })))
    }
    refresh()
    window.addEventListener('drapeon:analytics', refresh)
    return () => window.removeEventListener('drapeon:analytics', refresh)
  }, [eventName])

  return (
    <section className="mt-6 rounded-[8px] border border-needle/20 bg-needle/5 p-4" data-testid="lifecycle-event-preview-status">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Emitted preview events</p>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-ink/60">No consented event yet.</p>
      ) : (
        <ul className="mt-2 grid gap-2 text-sm">
          {events.map((event, index) => (
            <li key={`${event.name}-${index}`}>
              <span className="font-semibold text-needle">{event.name}</span>
              <pre className="mt-1 overflow-x-auto text-xs text-ink/65">{JSON.stringify(event.properties, null, 2)}</pre>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
