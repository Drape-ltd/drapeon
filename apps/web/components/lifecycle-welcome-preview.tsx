'use client'

import { useMemo, useState } from 'react'
import {
  getWelcomeSequence,
  welcomeIdempotencyKey,
  type WelcomeRole,
} from '@drape/shared/lifecycle-welcome'

const PREVIEW_USER_ID = 'preview-user-0001'

export function LifecycleWelcomePreview() {
  const [role, setRole] = useState<WelcomeRole>('CUSTOMER')
  const [duplicate, setDuplicate] = useState(false)
  const sequence = useMemo(() => getWelcomeSequence(role), [role])

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-10 text-ink sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-[8px] border border-ui-border bg-ui-surface p-6 shadow-sm sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle">Development preview</p>
          <h1 className="mt-3 text-4xl">Welcome should feel like a useful first step.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-ink/65">
            This preview keeps role copy, destinations, delays, and idempotency visible together.
            It does not send email or mutate an account.
          </p>

          <div className="mt-8 flex flex-wrap gap-2" role="group" aria-label="Welcome role">
            {(['CUSTOMER', 'TAILOR'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={role === option}
                onClick={() => { setRole(option); setDuplicate(false) }}
                className={`min-h-11 rounded-full border px-5 py-2 text-sm font-semibold transition ${
                  role === option
                    ? 'border-needle bg-needle text-white'
                    : 'border-ui-border bg-ui-surface text-ink hover:border-needle'
                }`}
              >
                {option === 'CUSTOMER' ? 'Customer sequence' : 'Tailor sequence'}
              </button>
            ))}
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {sequence.map((message, index) => (
              <article key={message.templateKey} className="rounded-[8px] border border-ui-border bg-ui-muted p-5">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-needle/80">
                  <span>Step {index + 1} · {message.step.replace('_', ' ')}</span>
                  <span>{message.delayHours === 0 ? 'Immediate' : `${message.delayHours}h delay`}</span>
                </div>
                <h2 className="mt-4 text-2xl text-ink">{message.headline}</h2>
                <p className="mt-3 text-sm leading-7 text-ink/68">{message.body}</p>
                <dl className="mt-5 grid gap-2 text-xs text-ink/68">
                  <div className="flex justify-between gap-4 border-t border-ui-border pt-3"><dt>Template</dt><dd className="font-semibold text-ink">{message.templateKey}</dd></div>
                  <div className="flex justify-between gap-4"><dt>Web destination</dt><dd className="font-semibold text-ink">{message.webPath}</dd></div>
                  <div className="flex justify-between gap-4"><dt>App destination</dt><dd className="font-semibold text-ink">{message.appUrl}</dd></div>
                  <div className="flex justify-between gap-4"><dt>Idempotency key</dt><dd className="break-all text-right font-mono text-[11px] text-ink">{welcomeIdempotencyKey(PREVIEW_USER_ID, role, message.step)}</dd></div>
                  <div className="flex justify-between gap-4"><dt>Provider correlation</dt><dd className="break-all text-right font-mono text-[11px] text-ink">X-Drapeon-Template-Key: {message.templateKey}</dd></div>
                </dl>
              </article>
            ))}
          </div>

          <div className="mt-6 rounded-[8px] border border-ui-border bg-ui-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink">Duplicate-event negative path</p>
                <p className="mt-1 text-sm text-ink/65">The same account and step must never enqueue a second welcome.</p>
              </div>
              <button
                type="button"
                aria-pressed={duplicate}
                onClick={() => setDuplicate((current) => !current)}
                className="min-h-11 rounded-full border border-ui-border px-4 py-2 text-sm font-semibold text-ink hover:border-needle"
              >
                Simulate duplicate
              </button>
            </div>
            <p role="status" className={`mt-4 rounded-md px-3 py-2 text-sm ${duplicate ? 'bg-rust/10 text-rust' : 'bg-needle/10 text-needle'}`}>
              {duplicate
                ? 'Suppressed: the idempotency key already exists, so no second message is queued.'
                : 'Ready: one immediate message and one delayed next-step message are eligible.'}
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
