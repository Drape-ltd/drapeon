'use client'

import { useState } from 'react'
import { LifecycleEventPreviewStatus } from './lifecycle-event-preview-status'
import { trackLifecycleEvent, useWebAnalyticsConsent } from './web-analytics'

type PreviewState = 'idle' | 'application-complete' | 'waitlist-complete' | 'blocked'

export function LifecycleLeadPreview(): React.JSX.Element {
  const consent = useWebAnalyticsConsent()
  const [state, setState] = useState<PreviewState>('idle')

  function simulateTailorApplication(): void {
    trackLifecycleEvent('tailor_application_submitted', {
      entry_surface: 'web',
      application_kind: 'public',
      portfolio_count_bucket: '2',
    })
    setState('application-complete')
  }

  function simulateWaitlistJoin(): void {
    trackLifecycleEvent('waitlist_joined', {
      role: 'CUSTOMER',
      entry_surface: 'web',
    })
    setState('waitlist-complete')
  }

  function simulateBlockedSubmission(): void {
    setState('blocked')
  }

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-2xl rounded-[8px] border border-ui-border bg-ui-surface p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Development preview</p>
        <h1 className="mt-3 text-4xl">Lead paths with a clear next step.</h1>
        <p className="mt-3 text-sm leading-7 text-ink/65">
          This preview exercises the same consent-aware events used after an accepted tailor
          application or waitlist record. Contact details and proof URLs never enter analytics.
        </p>

        <div className="mt-6 grid gap-3 rounded-[8px] border border-ui-border bg-ui-muted p-4 text-sm">
          <p><span className="font-semibold">Consent:</span> {consent}</p>
          <p><span className="font-semibold">Tailor event:</span> tailor_application_submitted.v1</p>
          <p><span className="font-semibold">Waitlist event:</span> waitlist_joined.v1</p>
          <p><span className="font-semibold">Negative path:</span> invalid or duplicate submissions emit no success event</p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={simulateTailorApplication}
            className="min-h-11 rounded-full bg-needle px-5 py-2 text-sm font-semibold text-white"
          >
            Simulate accepted tailor application
          </button>
          <button
            type="button"
            onClick={simulateWaitlistJoin}
            className="min-h-11 rounded-full bg-needle px-5 py-2 text-sm font-semibold text-white"
          >
            Simulate accepted waitlist join
          </button>
          <button
            type="button"
            onClick={simulateBlockedSubmission}
            className="min-h-11 rounded-full border border-ui-border px-5 py-2 text-sm font-semibold text-ink"
          >
            Simulate invalid submission
          </button>
        </div>

        <p role="status" data-testid="lead-preview-status" className="mt-4 text-sm text-ink/65">
          {state === 'application-complete' ? 'Accepted tailor application; event emitted only if analytics consent is granted.' : null}
          {state === 'waitlist-complete' ? 'Accepted waitlist join; event emitted only if analytics consent is granted.' : null}
          {state === 'blocked' ? 'Invalid submission blocked; no conversion event was emitted.' : null}
        </p>

        <div data-testid="tailor-application-preview-status">
          <LifecycleEventPreviewStatus eventName="tailor_application_submitted.v1" />
        </div>
        <div data-testid="waitlist-preview-status">
          <LifecycleEventPreviewStatus eventName="waitlist_joined.v1" />
        </div>
      </div>
    </main>
  )
}
