'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { Route } from 'next'
import type { EducationGuide } from '@drape/shared/education-guides'
import { trackLifecycleEvent } from './web-analytics'

type GuideProgress = {
  guideId: string
  guideVersion: number
  completedAt: string
}

function progressKey(guide: EducationGuide): string {
  return `drapeon.education-guide.${guide.id}.v${guide.version}`
}

export function EducationGuideCard({ guide }: { guide: EducationGuide }): React.JSX.Element {
  const [hydrated, setHydrated] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(progressKey(guide))
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<GuideProgress>
      if (
        parsed.guideId === guide.id &&
        parsed.guideVersion === guide.version &&
        typeof parsed.completedAt === 'string'
      ) {
        window.setTimeout(() => setCompleted(true), 0)
      }
    } catch {
      // A blocked or malformed progress store fails closed; the guide remains usable.
    } finally {
      setHydrated(true)
    }
  }, [guide])

  function markComplete() {
    if (!hydrated || completed) return
    const progress: GuideProgress = {
      guideId: guide.id,
      guideVersion: guide.version,
      completedAt: new Date().toISOString(),
    }

    try {
      window.localStorage.setItem(progressKey(guide), JSON.stringify(progress))
    } catch {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setCompleted(true)
    trackLifecycleEvent('guide_completed', {
      guide_id: guide.id,
      role: guide.role,
      entry_surface: 'web',
      guide_version: guide.version,
    })
  }

  return (
    <article className="rounded-[8px] border border-ink/6 bg-white/82 p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
        {guide.role === 'CUSTOMER' ? 'Customer path' : 'Tailor path'}
      </p>
      <h3 className="mt-3 text-2xl text-ink">{guide.title}</h3>
      <p className="mt-3 text-sm leading-7 text-ink/68">{guide.summary}</p>
      <ol className="mt-5 space-y-4">
        {guide.steps.map((step, index) => (
          <li key={step.id} className="grid grid-cols-[2rem_1fr] gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-needle text-sm font-semibold text-white" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h4 className="font-semibold text-ink">{step.title}</h4>
              <p className="mt-1 text-sm leading-6 text-ink/68">{step.body}</p>
              <Link
                href={step.webPath as Route}
                data-analytics-event="guide_started"
                data-analytics-label={guide.id}
                data-analytics-role={guide.role}
                data-analytics-version={String(guide.version)}
                className="mt-2 inline-flex text-sm font-semibold text-needle"
              >
                {index === guide.steps.length - 1 ? 'See the next step' : 'Learn more'}
              </Link>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 border-t border-ink/8 pt-4">
        <button
          type="button"
          data-testid={`guide-complete-${guide.id}`}
          onClick={markComplete}
          disabled={!hydrated || completed}
          aria-pressed={completed}
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-needle/25 px-4 text-sm font-semibold text-needle transition-colors hover:bg-ui-muted disabled:cursor-default disabled:opacity-100"
        >
          {completed ? 'Guide complete' : hydrated ? 'Mark guide complete' : 'Loading guide progress…'}
        </button>
        <p className="mt-2 text-xs leading-5 text-ink/55">
          {saveError
            ? 'Progress could not be saved on this device. Try again when storage is available.'
            : completed
              ? 'Saved on this device for this guide version.'
              : 'You can return to this guide any time.'}
        </p>
      </div>
    </article>
  )
}
