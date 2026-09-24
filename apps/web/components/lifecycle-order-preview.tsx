'use client'

import { useRef, useState } from 'react'
import { hashLifecycleIdentifier } from './lifecycle-profile-view-tracker'
import { trackLifecycleEvent, useWebAnalyticsConsent } from './web-analytics'
import { LifecycleEventPreviewStatus } from './lifecycle-event-preview-status'

export function LifecycleOrderPreview(): React.JSX.Element {
  const consent = useWebAnalyticsConsent()
  const [state, setState] = useState<'idle' | 'started' | 'blocked'>('idle')
  const emittedRef = useRef(false)

  async function simulateValidContext() {
    if (emittedRef.current) return
    const tailorIdHash = await hashLifecycleIdentifier('preview-tailor-0001')
    if (!tailorIdHash) return
    trackLifecycleEvent('order_started', {
      tailor_id_hash: tailorIdHash,
      order_kind: 'custom',
      entry_surface: 'web',
    })
    emittedRef.current = true
    setState('started')
  }

  function simulateBlockedContext() {
    setState('blocked')
  }

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-2xl rounded-[8px] border border-ui-border bg-ui-surface p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Development preview</p>
        <h1 className="mt-3 text-4xl">Order intent, without private order data.</h1>
        <p className="mt-3 text-sm leading-7 text-ink/65">
          This preview exercises the same event contract used when a valid customer opens a custom
          brief. It records only a hashed tailor reference, the order kind, and the entry surface.
        </p>
        <div className="mt-6 rounded-[8px] border border-ui-border bg-ui-muted p-4 text-sm">
          <p><span className="font-semibold">Consent:</span> {consent}</p>
          <p className="mt-2"><span className="font-semibold">Event:</span> order_started.v1</p>
          <p className="mt-2"><span className="font-semibold">Negative path:</span> stale or unavailable context emits no order start</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={() => void simulateValidContext()} className="min-h-11 rounded-full bg-needle px-5 py-2 text-sm font-semibold text-white">
            Simulate valid custom brief
          </button>
          <button type="button" onClick={simulateBlockedContext} className="min-h-11 rounded-full border border-ui-border px-5 py-2 text-sm font-semibold text-ink">
            Simulate blocked context
          </button>
        </div>
        <p role="status" className="mt-4 text-sm text-ink/65">
          {state === 'started' ? 'Valid context accepted; order intent emitted only if analytics consent is granted.' : null}
          {state === 'blocked' ? 'Blocked context stopped; no order intent event was emitted.' : null}
        </p>
        <LifecycleEventPreviewStatus eventName="order_started.v1" />
      </div>
    </main>
  )
}
