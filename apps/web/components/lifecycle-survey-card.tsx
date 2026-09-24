'use client'

import { useState } from 'react'
import { getSurveyDefinition, type SurveyKind, type SurveySubjectType } from '@drape/shared'
import { createClient } from '../lib/supabase'
import { Button } from './ui/button'

const LABELS: Record<SurveyKind, string> = {
  CUSTOMER_POST_COMPLETION_CSAT: 'How did the finished order feel?',
  SUPPORT_RESOLUTION_CSAT: 'How did Drapeon support do?',
  TAILOR_FIRST_ORDER_CSAT: 'How did your first order go?',
  ONBOARDING_PULSE: 'How clear was getting started?',
}

const TAG_LABELS: Record<string, string> = {
  fit: 'Fit',
  craft: 'Craft',
  communication: 'Communication',
  timeline: 'Timeline',
  delivery: 'Delivery',
  value: 'Value',
  other: 'Other',
  resolved: 'Resolved',
  unclear: 'Unclear',
  slow: 'Slow',
  brief: 'Brief',
  customer: 'Customer',
  payout: 'Payout',
  clear: 'Clear',
  confusing: 'Confusing',
  too_long: 'Too long',
  missing_step: 'Missing step',
}

type Props = {
  kind: SurveyKind
  subjectType: SurveySubjectType
  subjectId: string
  onSubmitted?: () => void
  preview?: boolean
  previewState?: 'form' | 'submitted' | 'suppressed'
}

export function LifecycleSurveyCard({ kind, subjectType, subjectId, onSubmitted, preview = false, previewState = 'form' }: Props) {
  const definition = getSurveyDefinition(kind)
  const [score, setScore] = useState(5)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(previewState === 'submitted')
  const [notice, setNotice] = useState<{ error: boolean; copy: string } | null>(null)

  async function submit() {
    setBusy(true)
    setNotice(null)
    try {
      if (preview) {
        setSubmitted(true)
        setNotice({ error: false, copy: 'Thanks — your feedback is recorded privately.' })
        onSubmitted?.()
        return
      }
      const { data, error } = await createClient().functions.invoke('submit-survey', {
        body: {
          kind,
          subjectType,
          subjectId,
          channel: 'WEB',
          score,
          tags,
          comment: comment.trim() || null,
        },
      })
      if (error) throw error
      if ((data as { error?: string } | null)?.error) {
        throw new Error(String((data as { error: string }).error))
      }
      setSubmitted(true)
      setNotice({ error: false, copy: 'Thanks — your feedback is recorded privately.' })
      onSubmitted?.()
    } catch (error) {
      setNotice({
        error: true,
        copy: error instanceof Error ? error.message : 'Feedback could not be saved. Try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (previewState === 'submitted' || submitted) {
    return (
      <section className="app-surface border-needle/15 p-5" aria-live="polite" data-testid="lifecycle-survey-submitted">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Feedback received</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Thanks for helping Drapeon improve.</h2>
        <p className="mt-2 text-sm leading-6 text-ink/58">Your response is private and does not change your service, payout, or access.</p>
      </section>
    )
  }

  if (previewState === 'suppressed') {
    return (
      <section className="app-surface border-rust/20 p-5" role="status" data-testid="lifecycle-survey-suppressed">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust">Feedback paused</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">We’ll ask after the open issue is resolved.</h2>
        <p className="mt-2 text-sm leading-6 text-ink/58">Your order and support path come first. You do not need to submit a rating while a dispute, incident, or unresolved support case is active.</p>
      </section>
    )
  }

  return (
    <section className="app-surface border-needle/15 p-5" aria-labelledby="lifecycle-survey-heading" data-testid="lifecycle-survey-card">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">Private feedback</p>
      <h2 id="lifecycle-survey-heading" className="mt-1 text-xl font-semibold text-ink">
        {LABELS[kind]}
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink/58">
        One short response helps Drapeon improve. It never changes your service, payout, or access.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Score from 1 to 5">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={score === value}
            aria-label={`${value} out of 5`}
            onClick={() => setScore(value)}
            className={`grid size-10 place-items-center rounded-full border text-sm font-semibold ${score === value ? 'border-needle bg-needle text-white' : 'border-ui-border bg-white text-ink/65'}`}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Feedback topics">
        {definition.allowedTags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => setTags((current) => current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag])}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${tags.includes(tag) ? 'border-needle bg-needle text-white' : 'border-ui-border bg-white text-ink/65'}`}
          >
            {TAG_LABELS[tag] ?? tag}
          </button>
        ))}
      </div>
      <label className="mt-4 grid gap-1 text-sm font-semibold text-ink">
        Anything else? <span className="font-normal text-ink/45">Optional</span>
        <textarea
          value={comment}
          maxLength={definition.maxCommentLength}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          className="resize-none rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-normal outline-none focus:border-needle focus:ring-2 focus:ring-needle/15"
          placeholder="Keep it useful and specific."
        />
      </label>
      {notice ? (
        <p role={notice.error ? 'alert' : 'status'} className={`mt-3 rounded-[8px] p-3 text-sm font-semibold ${notice.error ? 'bg-rust/10 text-rust' : 'bg-needle/8 text-needle'}`}>
          {notice.copy}
        </p>
      ) : null}
      <Button className="mt-4" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Saving feedback…' : 'Send private feedback'}
      </Button>
    </section>
  )
}
