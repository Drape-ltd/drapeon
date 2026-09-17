'use client'

import { Check, Pencil } from 'lucide-react'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'
import { OnboardingField } from './onboarding-field'

export type PhoneSetupStage = 'view' | 'editing' | 'saving' | 'saved'

/**
 * Collects a private phone number during tailor setup without claiming that
 * the number has been verified. Ownership verification is deferred until a
 * feature actually needs it, while the API and database still prevent the
 * same canonical number from being attached to multiple accounts.
 */
export function PhoneSetupPanel({
  phone,
  stage,
  error,
  onPhoneChange,
  onStageChange,
  onSave,
}: {
  phone: string
  stage: PhoneSetupStage
  error?: string | null
  onPhoneChange?: (value: string) => void
  onStageChange?: (stage: PhoneSetupStage) => void
  onSave?: () => void
}) {
  const busy = stage === 'saving'

  if (stage === 'view' || stage === 'saved') {
    return (
      <OnboardingField
        label="Phone number"
        helpKey="phone"
        hint="Used privately for order updates and account recovery. We will verify it only when a protected feature needs it."
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-ink/12 bg-white px-4 py-3">
          <span className="min-w-0">
            {phone ? (
              <span className="flex items-center gap-2 text-base text-ink">
                {phone}
                <span className="inline-flex items-center gap-1 rounded-full bg-needle/10 px-2 py-0.5 text-xs font-semibold text-needle">
                  <Check className="size-3" aria-hidden="true" /> Saved
                </span>
              </span>
            ) : (
              <span className="text-base text-rust-700">No phone number yet</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => onStageChange?.('editing')}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-ink/12 bg-white px-3.5 text-xs font-semibold text-needle transition-colors hover:bg-bone"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {phone ? 'Change' : 'Add phone number'}
          </button>
        </div>
      </OnboardingField>
    )
  }

  return (
    <section className="grid gap-3 rounded-[10px] border border-ink/12 bg-white p-4">
      <PhoneNumberField
        label="Phone number"
        value={phone}
        onValueChange={(value) => onPhoneChange?.(value)}
        hint="Used for order updates and account recovery. Never shown on your public profile."
        error={error ?? undefined}
        required
      />
      <p className="text-xs leading-5 text-ink/56">
        No code is needed now. This number must not belong to another Drapeon account, and we will
        verify it only before a protected feature needs it.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!phone.trim() || busy}
          onClick={() => onSave?.()}
          className="min-h-11 rounded-full bg-needle px-5 text-sm font-semibold text-white transition-colors hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/20"
        >
          {busy ? 'Saving…' : 'Save phone number'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onStageChange?.('view')}
          className="min-h-11 px-2 text-sm font-semibold text-ink/56 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}
