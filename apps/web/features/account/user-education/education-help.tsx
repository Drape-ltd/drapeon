'use client'
import { useRef, useState } from 'react'
import { getGuide } from '@drape/shared/guide-library'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog'
import { GuideReader } from './guide-reader'
import { EDUCATION_TOURS, type EducationTour } from '@drape/shared/education-tours'
import { type EducationProgress } from '@drape/shared/education-state'
import { useEducation } from './use-education'
export function EducationHelp({
  context = 'welcome',
  role = 'CUSTOMER',
}: {
  context?: EducationTour
  role?: 'CUSTOMER' | 'TAILOR'
}) {
  const { store, state } = useEducation()
  const [reading, setReading] = useState(false)
  const [open, setOpen] = useState(false),
    [step, setStep] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const tour = EDUCATION_TOURS[context],
    key = `progress:${role}:${context}:v1`
  const previous = state.data[key] as EducationProgress | undefined
  const save = (status: EducationProgress['status'], index = step) => {
    void store?.set(key, { status, step: index }).catch(() => {})
  }
  const close = (status: EducationProgress['status']) => {
    save(status)
    setOpen(false)
  }
  const locate = () => {
    const id = tour.steps[step]!.target
    const target = id && document.getElementById(id)
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'auto' })
      target.style.outline = '3px solid #ae794e'
      setTimeout(() => {
        target.style.outline = ''
      }, 2500)
    }
  }
  return (
    <div className="my-3 rounded-xl border border-needle/15 bg-white/80 p-3 text-sm">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{!previous && state.ready ? tour.title : 'Help is here when you need it.'}</span>
          <div className="flex gap-4">
            <button
              type="button"
              disabled={!state.ready}
              onClick={() => {
                setStep(0)
                setOpen(true)
                save('started', 0)
                setTimeout(() => panel.current?.focus(), 0)
              }}
              className="font-semibold text-needle underline"
            >
              {previous ? 'Replay introduction' : 'Show me'}
            </button>
            {!previous && state.ready ? (
              <button type="button" onClick={() => save('skipped', 0)}>
                Skip
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div
          ref={panel}
          tabIndex={-1}
          role="region"
          aria-label={tour.title}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close('dismissed')
          }}
          className="space-y-3 outline-none"
        >
          <p className="text-xs text-ink/60">
            {step + 1} of {tour.steps.length} · {tour.title}
          </p>
          <h3 className="font-semibold" aria-live="polite">
            {tour.steps[step]!.title}
          </h3>
          <p className="leading-6">{tour.steps[step]!.body}</p>
          <div className="flex flex-wrap items-center gap-4">
            {step > 0 && (
              <button
                type="button"
                onClick={() => {
                  setStep(step - 1)
                  save('started', step - 1)
                }}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="rounded-full bg-needle px-4 py-2 text-white"
              onClick={() => {
                if (step + 1 === tour.steps.length) close('completed')
                else {
                  setStep(step + 1)
                  save('started', step + 1)
                }
              }}
            >
              {step + 1 === tour.steps.length ? 'Done' : 'Next'}
            </button>
            {tour.steps[step]!.target && (
              <button type="button" onClick={locate}>
                Show this area
              </button>
            )}
            <button type="button" onClick={() => close('dismissed')}>
              Close
            </button>
            <button type="button" onClick={() => setReading(true)}>
              Read the full guide
            </button>
          </div>
        </div>
      )}
      <Dialog open={reading} onOpenChange={setReading}>
        <DialogContent className="max-w-4xl">
          <DialogTitle>Guide</DialogTitle>
          <DialogDescription>Close to return to your task.</DialogDescription>
          {getGuide(tour.guide) && <GuideReader guide={getGuide(tour.guide)!} />}
        </DialogContent>
      </Dialog>
      {state.error && (
        <p role="status" className="mt-2 text-xs text-ink/70">
          {state.error}
        </p>
      )}
    </div>
  )
}
