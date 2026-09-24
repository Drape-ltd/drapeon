'use client'

import { useEffect, useState } from 'react'
import {
  ANALYTICS_CONSENT_KEY,
  ANALYTICS_QA_BUFFER_KEY,
  readWebAnalyticsBuffer,
} from '../../components/web-analytics'

type DebugEvent = {
  name: string
  properties: Record<string, boolean | number | string | null | undefined>
  path: string
  capturedAt: string
}

function setDebugConsent(value: 'granted' | 'denied'): void {
  window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value)
  if (value === 'denied') {
    window.sessionStorage.removeItem(ANALYTICS_QA_BUFFER_KEY)
    delete window.__DRAPEON_ANALYTICS_BUFFER__
  }
  window.dispatchEvent(new CustomEvent('drapeon:analytics-consent-change', { detail: value }))
}

export function AnalyticsDebugPanel(): React.JSX.Element {
  const [consent, setConsent] = useState('unknown')
  const [events, setEvents] = useState<DebugEvent[]>([])

  useEffect(() => {
    const refresh = () => {
      setConsent(window.localStorage.getItem(ANALYTICS_CONSENT_KEY) ?? 'unknown')
      setEvents(readWebAnalyticsBuffer())
    }
    refresh()
    window.addEventListener('drapeon:analytics', refresh)
    window.addEventListener('drapeon:analytics-consent-change', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('drapeon:analytics', refresh)
      window.removeEventListener('drapeon:analytics-consent-change', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Development QA</p>
        <h1 className="mt-3 text-4xl">Analytics consent inspector</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/65">
          This page is available only on the local development server. It shows the browser’s consent
          decision and the sanitized in-memory event buffer so release evidence can verify the opt-in boundary.
        </p>
        <dl className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[8px] border border-ui-border bg-ui-surface p-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Consent</dt>
            <dd className="mt-2 text-2xl font-semibold text-needle">{consent}</dd>
          </div>
          <div className="rounded-[8px] border border-ui-border bg-ui-surface p-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Buffered events</dt>
            <dd className="mt-2 text-2xl font-semibold text-needle">{events.length}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="analytics-debug-grant"
            onClick={() => setDebugConsent('granted')}
            className="rounded-full bg-needle px-4 py-2 text-xs font-semibold text-white"
          >
            Grant consent for QA
          </button>
          <button
            type="button"
            data-testid="analytics-debug-deny"
            onClick={() => setDebugConsent('denied')}
            className="rounded-full border border-ui-border bg-ui-surface px-4 py-2 text-xs font-semibold text-ink"
          >
            Keep analytics off
          </button>
        </div>
        <section className="mt-6 rounded-[8px] border border-ui-border bg-ui-surface p-5">
          <h2 className="text-lg font-semibold">Sanitized event buffer</h2>
          {events.length === 0 ? (
            <p className="mt-3 text-sm text-ink/60">No consented events have been buffered in this tab.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {events.map((event, index) => (
                <li key={`${event.name}-${event.capturedAt}-${index}`} className="rounded-[8px] bg-ui-muted p-4 text-sm">
                  <p className="font-semibold text-needle">{event.name}</p>
                  <p className="mt-1 text-ink/60">{event.path} · {event.capturedAt}</p>
                  <pre className="mt-2 overflow-x-auto text-xs text-ink/75">{JSON.stringify(event.properties, null, 2)}</pre>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
