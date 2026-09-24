'use client'

/**
 * Visual harness for tailor onboarding.
 *
 * Every state here renders from local mock data: no Supabase, no email, no
 * uploads, no camera. Most of these states are unreachable by hand in the real
 * flow — an upload stuck at 40%, a video rejected for length, a blocked trust
 * recorder — so this is the only way to look at them before shipping.
 *
 * One URL per state (`/signup-preview?state=<id>`) so Playwright can screenshot
 * each one at every viewport.
 */

import Link from 'next/link'
import { OnboardingField } from './onboarding-field'
import { MediaUploadField, type OnboardingMediaItem } from './media-upload-field'
import { PhoneVerificationPanel, type PhoneVerificationStage } from './phone-verification-panel'
import { SIGNUP_PREVIEW_STATES, type SignupPreviewStateId } from './preview-states'
import {
  OnboardingStepRail,
  TrustBlockedNotice,
  WhatsLeftPanel,
  type OnboardingOutstandingItem,
} from './onboarding-progress'



const SAMPLE_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#2D6A4F"/><rect x="0" y="210" width="400" height="90" fill="#1B4030"/><circle cx="200" cy="120" r="58" fill="#F5F0E8" opacity="0.92"/></svg>`
  )

const OUTSTANDING: OnboardingOutstandingItem[] = [
  { step: 0, field: 'profilePhoto', message: 'Add a clear profile photo so customers know who they are booking' },
  { step: 0, field: 'bio', message: 'Add at least 80 characters about your work to continue' },
  { step: 1, field: 'specialties', message: 'Choose at least one specialty to continue' },
  { step: 2, field: 'portfolio', message: 'Add at least 1 photo or video of your work to continue' },
]

function mediaItems(kind: SignupPreviewStateId): OnboardingMediaItem[] {
  if (kind === 'portfolio-empty') return []
  if (kind === 'portfolio-uploading')
    return [
      { id: 'a', kind: 'IMAGE', previewUrl: SAMPLE_IMAGE, status: 'uploading', progress: 41, title: 'Navy agbada' },
    ]
  if (kind === 'portfolio-failed')
    return [
      { id: 'a', kind: 'IMAGE', previewUrl: SAMPLE_IMAGE, status: 'added', title: 'Navy agbada' },
      {
        id: 'b',
        kind: 'VIDEO',
        previewUrl: null,
        status: 'failed',
        title: 'Studio walkthrough',
        errorMessage: 'This video is 48 seconds. Keep it to 30 seconds or less.',
      },
    ]
  if (kind === 'portfolio-at-cap')
    return Array.from({ length: 12 }, (_, index) => ({
      id: `item-${index}`,
      kind: index < 9 ? ('IMAGE' as const) : ('VIDEO' as const),
      previewUrl: index < 9 ? SAMPLE_IMAGE : null,
      status: 'added' as const,
      title: index === 0 ? 'Navy agbada' : '',
      durationSeconds: index >= 9 ? 22 : undefined,
    }))
  return [
    { id: 'a', kind: 'IMAGE', previewUrl: SAMPLE_IMAGE, status: 'added', title: 'Navy agbada' },
    { id: 'b', kind: 'IMAGE', previewUrl: SAMPLE_IMAGE, status: 'uploading', progress: 72 },
    {
      id: 'c',
      kind: 'VIDEO',
      previewUrl: null,
      status: 'failed',
      errorMessage: 'This file is 46 MB. Keep videos under 30 MB.',
    },
  ]
}

const PHONE_STATES: Record<string, { stage: PhoneVerificationStage; phone: string; error?: string; attemptsRemaining?: number }> = {
  'phone-missing': { stage: 'view', phone: '' },
  'phone-editing': { stage: 'editing', phone: '+234 802 555 0134' },
  'phone-code-sent': { stage: 'code-sent', phone: '+234 802 555 0134' },
  'phone-code-wrong': {
    stage: 'code-sent',
    phone: '+234 802 555 0134',
    error: 'That code is incorrect.',
    attemptsRemaining: 3,
  },
  'phone-password': { stage: 'password', phone: '+234 802 555 0134' },
  'phone-saved': { stage: 'saved', phone: '+234 802 555 0134' },
}

const inputClass =
  'min-h-12 w-full rounded-[8px] border border-ink/12 bg-white px-4 text-base text-ink outline-none transition focus:border-needle'

function Step1({ withErrors }: { withErrors: boolean }) {
  return (
    <div className="grid gap-5">
      <OnboardingField
        label="Display name"
        helpKey="displayName"
        hint="Your studio name or your own name."
        error={withErrors ? 'Add your public display name to continue' : null}
      >
        <input className={inputClass} defaultValue={withErrors ? '' : 'Amaka Okonkwo'} />
      </OnboardingField>

      <OnboardingField
        label="Phone number"
        helpKey="phone"
        hint="We send a code to your email to confirm changes."
        error={withErrors ? 'Add a valid phone number for order updates and account recovery' : null}
      >
        <input className={inputClass} defaultValue={withErrors ? '' : '+234 802 555 0134'} />
      </OnboardingField>

      <OnboardingField
        label="City or base location"
        helpKey="location"
        hint="Shown publicly. Your street address stays private."
      >
        <input className={inputClass} defaultValue="Lagos, Lagos, Nigeria" />
      </OnboardingField>

      <OnboardingField
        label="About your work"
        helpKey="bio"
        hint={withErrors ? undefined : '112 of 80 characters minimum'}
        error={withErrors ? 'Add at least 80 characters about your work to continue' : null}
      >
        <textarea
          rows={4}
          className="w-full rounded-[8px] border border-ink/12 bg-white px-4 py-3 text-base leading-7 text-ink outline-none focus:border-needle"
          defaultValue={
            withErrors
              ? 'I sew.'
              : 'I make occasion agbada and kaftans for men in Lagos, with two fittings for every order and a two to three week turnaround.'
          }
        />
      </OnboardingField>

      <OnboardingField label="Languages" helpKey="languages" hint="Shown on your public profile.">
        <input className={inputClass} defaultValue="English, Igbo" />
      </OnboardingField>
    </div>
  )
}

export function SignupPreviewHarness({ stateId }: { stateId?: string }) {
  const active = (SIGNUP_PREVIEW_STATES.find((entry) => entry.id === stateId)?.id ??
    'step1-empty') as SignupPreviewStateId

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-8">
      <div className="mx-auto grid max-w-3xl gap-6">
        <header className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
            Signup harness · development only
          </p>
          <h1 className="text-3xl leading-tight text-ink">Tailor onboarding states</h1>
          <p className="text-sm leading-6 text-ink/62">
            Mock data only. No account, no uploads, no email.
          </p>
          <nav aria-label="Preview states" className="mt-1 flex flex-wrap gap-1.5">
            {SIGNUP_PREVIEW_STATES.map((entry) => (
              <Link
                key={entry.id}
                href={`/signup-preview?state=${entry.id}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  entry.id === active
                    ? 'border-needle bg-needle text-white'
                    : 'border-ink/12 bg-white text-ink/68 hover:border-needle/40'
                }`}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
        </header>

        <section
          data-preview-state={active}
          className="grid gap-5 rounded-[10px] border border-ink/8 bg-white/92 p-5 shadow-[0_18px_60px_rgba(22,28,24,0.06)] sm:p-7"
        >
          <OnboardingStepRail
            current={active.startsWith('portfolio') ? 2 : active.startsWith('trust') ? 3 : 0}
            completed={{
              0: !active.startsWith('step1') && !active.startsWith('phone'),
              1: !active.startsWith('step1') && !active.startsWith('phone'),
              2: false,
              3: false,
            }}
          />

          {active === 'step1-empty' ? <Step1 withErrors={false} /> : null}
          {active === 'step1-errors' ? <Step1 withErrors /> : null}
          {active === 'step1-help-open' ? (
            <div className="grid gap-5">
              <p className="rounded-[8px] border border-ink/8 bg-bone/50 px-3 py-2 text-xs leading-5 text-ink/58">
                Open each (i) to check the layout shift at narrow widths.
              </p>
              <Step1 withErrors={false} />
            </div>
          ) : null}

          {PHONE_STATES[active] ? (
            <PhoneVerificationPanel
              phone={PHONE_STATES[active]!.phone}
              stage={PHONE_STATES[active]!.stage}
              maskedEmail="am****@gmail.com"
              hasPasswordIdentity={active === 'phone-editing' || active === 'phone-password'}
              error={PHONE_STATES[active]!.error}
              attemptsRemaining={PHONE_STATES[active]!.attemptsRemaining}
            />
          ) : null}

          {active.startsWith('portfolio') ? (
            <MediaUploadField
              items={mediaItems(active)}
              requiredCount={1}
              label="Your work"
              emptyHint="Add at least one photo or video of work you made."
            />
          ) : null}

          {active === 'whats-left' ? <WhatsLeftPanel outstanding={OUTSTANDING} /> : null}
          {active === 'whats-left-clear' ? <WhatsLeftPanel outstanding={[]} /> : null}
          {active === 'trust-blocked' ? <TrustBlockedNotice outstanding={OUTSTANDING} /> : null}
        </section>
      </div>
    </main>
  )
}
