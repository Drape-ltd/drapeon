'use client'

import { useId, useState, type ReactNode } from 'react'
import { Info, X } from 'lucide-react'
import { ONBOARDING_FIELD_HELP, type OnboardingHelpKey } from './help-content'

/**
 * One field, one label, one answer.
 *
 * Every onboarding field renders a persistent visible label, whether it is
 * required, a one-line hint, and — where tailors ask "why do you need this?" —
 * an (i) disclosure carrying the answer.
 *
 * The disclosure is a tap target, not a hover tooltip: tailors finish this flow
 * on phones, where hover does not exist. It expands in place so the answer never
 * covers the field it describes.
 */
/**
 * The (i) toggle and its panel, on its own so components that render their own
 * label — the address search, the option pickers — can offer the same answer
 * without being rebuilt around OnboardingField.
 *
 * Returns the button; the caller places {panel} wherever it should appear.
 */
export function useFieldHelp(label: string, helpKey?: OnboardingHelpKey, help?: string) {
  const helpText = help ?? (helpKey ? ONBOARDING_FIELD_HELP[helpKey] : undefined)
  const [open, setOpen] = useState(false)
  const id = useId()
  if (!helpText) return { button: null, panel: null }
  return {
    button: (
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={`${id}-help`}
        aria-label={`About ${label.toLowerCase()}`}
        className={`grid size-5 shrink-0 place-items-center rounded-full border transition-colors ${
          open
            ? 'border-needle bg-needle text-white'
            : 'border-ink/20 bg-white text-ink/55 hover:border-needle/40 hover:text-needle'
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35`}
      >
        {open ? <X className="size-3" aria-hidden="true" /> : <Info className="size-3.5" aria-hidden="true" />}
      </button>
    ),
    panel: open ? (
      <p
        id={`${id}-help`}
        className="rounded-[8px] border border-needle/16 bg-needle/6 px-3 py-2.5 text-xs leading-5 text-ink/72"
      >
        {helpText}
      </p>
    ) : null,
  }
}

export function OnboardingField({
  label,
  helpKey,
  help,
  hint,
  error,
  optional = false,
  htmlFor,
  children,
  className = '',
}: {
  label: string
  helpKey?: OnboardingHelpKey
  help?: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  const helpText = help ?? (helpKey ? ONBOARDING_FIELD_HELP[helpKey] : undefined)
  const [helpOpen, setHelpOpen] = useState(false)
  const generatedId = useId()
  const helpId = `${generatedId}-help`
  const hintId = `${generatedId}-hint`
  const errorId = `${generatedId}-error`
  const describedBy = [error ? errorId : null, hint ? hintId : null, helpOpen ? helpId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`grid gap-2 ${className}`} data-field-error={error ? 'true' : undefined}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
          {label}
          {optional ? <span className="ml-1.5 font-normal text-ink/48">Optional</span> : null}
        </label>
        {helpText ? (
          <button
            type="button"
            onClick={() => setHelpOpen((open) => !open)}
            aria-expanded={helpOpen}
            aria-controls={helpId}
            aria-label={`About ${label.toLowerCase()}`}
            className={`grid size-5 shrink-0 place-items-center rounded-full border transition-colors ${
              helpOpen
                ? 'border-needle bg-needle text-white'
                : 'border-ink/20 bg-white text-ink/55 hover:border-needle/40 hover:text-needle'
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35`}
          >
            {helpOpen ? (
              <X className="size-3" aria-hidden="true" />
            ) : (
              <Info className="size-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>

      {helpOpen && helpText ? (
        <p
          id={helpId}
          className="rounded-[8px] border border-needle/16 bg-needle/6 px-3 py-2.5 text-xs leading-5 text-ink/72"
        >
          {helpText}
        </p>
      ) : null}

      <div aria-describedby={describedBy || undefined}>{children}</div>

      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium leading-5 text-rust-700">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs leading-5 text-ink/52">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
