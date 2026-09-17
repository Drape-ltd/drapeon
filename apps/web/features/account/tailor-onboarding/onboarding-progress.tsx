'use client'

import { Check, Lock } from 'lucide-react'
import type { TailorSetupStep } from '@drape/shared'

export const ONBOARDING_STEP_TITLES: Record<TailorSetupStep, string> = {
  0: 'You and your studio',
  1: 'What you make',
  2: 'Proof of work',
  3: 'Orders and verification',
}

export type OnboardingOutstandingItem = {
  step: TailorSetupStep
  field: string
  message: string
}

/**
 * Four steps, always visible, always honest about which are done.
 */
export function OnboardingStepRail({
  current,
  completed,
  onOpenStep,
}: {
  current: TailorSetupStep
  completed: Record<TailorSetupStep, boolean>
  onOpenStep?: (step: TailorSetupStep) => void
}) {
  const steps: TailorSetupStep[] = [0, 1, 2, 3]
  return (
    <nav aria-label={`Tailor setup, step ${current + 1} of 4`} className="grid gap-2">
      <ol className="flex gap-2">
        {steps.map((step) => {
          const isDone = completed[step]
          const isCurrent = step === current
          return (
            <li key={step} className="flex-1">
              <button
                type="button"
                onClick={() => onOpenStep?.(step)}
                aria-current={isCurrent ? 'step' : undefined}
                className="grid w-full gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
              >
                <span
                  className={`block h-1.5 rounded-full ${
                    isCurrent ? 'bg-needle' : isDone ? 'bg-needle/45' : 'bg-ink/12'
                  }`}
                />
                <span
                  className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                    isCurrent ? 'text-needle' : 'text-ink/45'
                  }`}
                >
                  {isDone ? <Check className="size-3" aria-hidden="true" /> : null}
                  Step {step + 1}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * Everything still outstanding, across every step, at once.
 *
 * The old flow revealed one requirement at a time: fix it, press Continue, meet
 * the next one. This panel is the whole list, and each row jumps to the field
 * that needs attention.
 */
export function WhatsLeftPanel({
  outstanding,
  onOpenField,
}: {
  outstanding: OnboardingOutstandingItem[]
  onOpenField?: (item: OnboardingOutstandingItem) => void
}) {
  if (!outstanding.length) {
    return (
      <section className="rounded-[10px] border border-needle/20 bg-needle/7 px-4 py-3.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-needle">
          <Check className="size-4" aria-hidden="true" /> Everything required is done
        </p>
        <p className="mt-1 text-xs leading-5 text-ink/62">
          Record your private trust video to send your studio for review.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="whats-left-heading"
      className="rounded-[10px] border border-ink/10 bg-white px-4 py-3.5"
    >
      <h2 id="whats-left-heading" className="text-sm font-semibold text-ink">
        What&apos;s left
        <span className="ml-1.5 font-normal text-ink/52">
          {outstanding.length} {outstanding.length === 1 ? 'item' : 'items'}
        </span>
      </h2>
      <ul className="mt-2.5 grid gap-1.5">
        {outstanding.map((item) => (
          <li key={`${item.step}-${item.field}`}>
            <button
              type="button"
              onClick={() => onOpenField?.(item)}
              className="flex w-full items-start gap-2 rounded-[6px] px-1.5 py-1.5 text-left text-xs leading-5 text-ink/72 transition-colors hover:bg-bone/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/30"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-rust-700"
              />
              <span className="min-w-0 flex-1">
                {item.message}
                <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/38">
                  Step {item.step + 1} · {ONBOARDING_STEP_TITLES[item.step]}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Shown when the trust recorder is blocked: the reason, in full, as a list.
 */
export function TrustBlockedNotice({
  outstanding,
  onOpenField,
}: {
  outstanding: OnboardingOutstandingItem[]
  onOpenField?: (item: OnboardingOutstandingItem) => void
}) {
  return (
    <section className="rounded-[10px] border border-amber-300/45 bg-amber-400/8 p-4">
      <div className="flex items-start gap-2.5">
        <Lock className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">
            Finish these {outstanding.length} {outstanding.length === 1 ? 'thing' : 'things'} before
            recording
          </h3>
          <p className="mt-1 text-xs leading-5 text-ink/64">
            The recorder opens once your studio is complete, so you never record a video and then get
            sent back.
          </p>
          <ul className="mt-2.5 grid gap-1.5">
            {outstanding.map((item) => (
              <li key={`${item.step}-${item.field}`}>
                <button
                  type="button"
                  onClick={() => onOpenField?.(item)}
                  className="text-left text-xs font-semibold leading-5 text-needle underline decoration-needle/30 underline-offset-2"
                >
                  {item.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
