'use client'

import { useState } from 'react'
import { trackLifecycleEvent, useWebAnalyticsConsent } from './web-analytics'
import { LifecycleEventPreviewStatus } from './lifecycle-event-preview-status'

export function LifecycleFitPreview() {
  const consent = useWebAnalyticsConsent()
  const [state, setState] = useState<'idle' | 'complete' | 'blocked'>('idle')

  function simulateComplete() {
    trackLifecycleEvent('fit_profile_completed', {
      entry_surface: 'web',
      completion_method: 'manual',
      field_count_bucket: 'all_core',
    })
    setState('complete')
  }

  function simulateBlocked() {
    setState('blocked')
  }

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-2xl rounded-[8px] border border-ui-border bg-ui-surface p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Development preview</p>
        <h1 className="mt-3 text-4xl">Fit completion, without fit values.</h1>
        <p className="mt-3 text-sm leading-7 text-ink/65">
          This preview exercises the same consent-aware event contract used after a successful web
          measurement save. It records only completion method and a coarse field-count bucket.
        </p>
        <div className="mt-6 rounded-[8px] border border-ui-border bg-ui-muted p-4 text-sm">
          <p><span className="font-semibold">Consent:</span> {consent}</p>
          <p className="mt-2"><span className="font-semibold">Event:</span> fit_profile_completed.v1</p>
          <p className="mt-2"><span className="font-semibold">Negative path:</span> incomplete save emits no success event</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={simulateComplete} className="min-h-11 rounded-full bg-needle px-5 py-2 text-sm font-semibold text-white">
            Simulate complete save
          </button>
          <button type="button" onClick={simulateBlocked} className="min-h-11 rounded-full border border-ui-border px-5 py-2 text-sm font-semibold text-ink">
            Simulate incomplete save
          </button>
        </div>
        <p role="status" className="mt-4 text-sm text-ink/65">
          {state === 'complete' ? 'Complete save accepted; event emitted only if analytics consent is granted.' : null}
          {state === 'blocked' ? 'Incomplete save blocked; no conversion event was emitted.' : null}
        </p>
        <LifecycleEventPreviewStatus eventName="fit_profile_completed.v1" />
      </div>
    </main>
  )
}
