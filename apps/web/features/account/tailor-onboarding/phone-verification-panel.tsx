'use client'

import { useState } from 'react'
import { Check, Mail, Pencil } from 'lucide-react'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'
import { OnboardingField } from './onboarding-field'

export type PhoneVerificationStage =
  | 'view'
  | 'editing'
  | 'sending'
  | 'code-sent'
  | 'verifying'
  | 'password'
  | 'saved'

/**
 * Setting a phone number without leaving onboarding.
 *
 * Two things were wrong before. The change was confirmed with the account
 * password, which a Google or Apple tailor does not have, and the only way in
 * was a link to /account/settings — a route the account runtime bounces
 * straight back to setup while the profile is incomplete. Between them, a
 * social-signup tailor had no path at all to the phone number setup requires.
 *
 * Here the field lives in the step, and the change is confirmed by a code sent
 * to the account email. Accounts that do have a password can use it instead.
 */
export function PhoneVerificationPanel({
  phone,
  stage,
  maskedEmail,
  hasPasswordIdentity,
  error,
  notice,
  attemptsRemaining,
  onPhoneChange,
  onStageChange,
  onSendCode,
  onVerifyCode,
  onVerifyPassword,
  onUsePassword,
}: {
  phone: string
  stage: PhoneVerificationStage
  maskedEmail: string
  hasPasswordIdentity: boolean
  error?: string | null
  notice?: string | null
  attemptsRemaining?: number
  onPhoneChange?: (value: string) => void
  onStageChange?: (stage: PhoneVerificationStage) => void
  onSendCode?: () => void
  onVerifyCode?: (code: string) => void
  onVerifyPassword?: (password: string) => void
  onUsePassword?: () => void
}) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const busy = stage === 'sending' || stage === 'verifying'

  if (stage === 'view' || stage === 'saved') {
    return (
      <OnboardingField
        label="Phone number"
        helpKey="phone"
        hint={
          stage === 'saved'
            ? undefined
            : 'Used for order updates and account recovery. Never shown publicly.'
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-ink/12 bg-white px-4 py-3">
          <span className="min-w-0">
            {phone ? (
              <span className="flex items-center gap-2 text-base text-ink">
                {phone}
                {stage === 'saved' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-needle/10 px-2 py-0.5 text-xs font-semibold text-needle">
                    <Check className="size-3" aria-hidden="true" /> Confirmed
                  </span>
                ) : null}
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

  if (stage === 'code-sent' || stage === 'verifying') {
    return (
      <section className="grid gap-3 rounded-[10px] border border-needle/20 bg-needle/6 p-4">
        <div className="flex items-start gap-2.5">
          <Mail className="mt-0.5 size-4 shrink-0 text-needle" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">Confirm it is you</h3>
            <p className="mt-1 text-xs leading-5 text-ink/66">
              We sent a six-digit code to <span className="font-semibold text-ink">{maskedEmail}</span>.
              Enter it to save {phone || 'your phone number'}.
            </p>
          </div>
        </div>

        <OnboardingField
          label="Confirmation code"
          hint="The code expires in 10 minutes."
          error={
            error
              ? [
                  error,
                  typeof attemptsRemaining === 'number' && attemptsRemaining > 0
                    ? `${attemptsRemaining} ${attemptsRemaining === 1 ? 'try' : 'tries'} left before you need a new code.`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              : null
          }
        >
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label="Six-digit confirmation code"
            className="min-h-13 w-full rounded-[8px] border border-ink/12 bg-white px-4 text-center font-mono text-xl tracking-[0.3em] text-ink outline-none focus:border-needle"
          />
        </OnboardingField>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={code.length !== 6 || busy}
            onClick={() => onVerifyCode?.(code)}
            className="min-h-11 rounded-full bg-needle px-5 text-sm font-semibold text-white transition-colors hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/20"
          >
            {stage === 'verifying' ? 'Confirming…' : 'Confirm and save'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSendCode?.()}
            className="min-h-11 rounded-full border border-ink/12 bg-white px-4 text-sm font-semibold text-needle"
          >
            Send a new code
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onStageChange?.('editing')}
            className="min-h-11 px-2 text-sm font-semibold text-ink/56 hover:text-ink"
          >
            Back
          </button>
        </div>
      </section>
    )
  }

  if (stage === 'password') {
    return (
      <section className="grid gap-3 rounded-[10px] border border-ink/12 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink">Confirm with your password</h3>
        <p className="text-xs leading-5 text-ink/64">
          Enter your Drapeon password to save {phone || 'your phone number'}.
        </p>
        <OnboardingField label="Current password" error={error}>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="min-h-12 w-full rounded-[8px] border border-ink/12 bg-white px-4 text-base text-ink outline-none focus:border-needle"
          />
        </OnboardingField>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!password || busy}
            onClick={() => onVerifyPassword?.(password)}
            className="min-h-11 rounded-full bg-needle px-5 text-sm font-semibold text-white transition-colors hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/20"
          >
            {stage === 'password' && busy ? 'Confirming…' : 'Confirm and save'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSendCode?.()}
            className="min-h-11 rounded-full border border-ink/12 bg-white px-4 text-sm font-semibold text-needle"
          >
            Email me a code instead
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onStageChange?.('editing')}
            className="min-h-11 px-2 text-sm font-semibold text-ink/56 hover:text-ink"
          >
            Back
          </button>
        </div>
      </section>
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
      {notice ? (
        <p role="status" className="text-xs leading-5 text-ink/62">
          {notice}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-ink/56">
        To save this, we send a six-digit code to {maskedEmail}. No SMS, no charge.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!phone.trim() || busy}
          onClick={() => onSendCode?.()}
          className="min-h-11 rounded-full bg-needle px-5 text-sm font-semibold text-white transition-colors hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/20"
        >
          {stage === 'sending' ? 'Sending code…' : 'Email me a code'}
        </button>
        {hasPasswordIdentity ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onUsePassword?.()}
            className="min-h-11 rounded-full border border-ink/12 bg-white px-4 text-sm font-semibold text-needle"
          >
            Use my password instead
          </button>
        ) : null}
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
