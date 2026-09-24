'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { friendlyActionError } from '@drape/shared/action-errors'
import { IDENTITY_CONSENT_POLICY_VERSION } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { deleteSignupMediaDraft, SignupMediaDraftDescriptor } from '../../../lib/signup-media-draft'
import { safeUserText } from '../../../lib/safe-display'
import type { TailorProfile } from '../shared/account-data-contracts'
import { invokeAccountFunction, isPayoutReady } from '../shared/account-data-queries'
import { ActionNotice } from '../messages/account-messages-surface'
import { Button } from '../../../components/ui/button'
import { isVerifiedIdentityStatus } from '../shop/account-shop-surface'

const INVALID_PROFILE_IMAGE_REJECTION_CODE = 'INVALID_PROFILE_IMAGE'

const INVALID_PORTFOLIO_MEDIA_REJECTION_CODE = 'INVALID_PORTFOLIO_MEDIA'

export const PROFILE_IMAGE_REJECTION_MESSAGE =
  'Profile Photo Rejected: Please upload a clear headshot or business logo. Landscapes, solid colors, or anonymous placeholders are not permitted.'

export const TAILOR_SETUP_DRAFT_VERSION = 3

export function tailorWebSetupDraftKey(userId: string) {
  return `drape:tailor-setup-draft:v${TAILOR_SETUP_DRAFT_VERSION}:${userId}`
}

type IdentityHandoffRealtimeState = 'idle' | 'waiting' | 'opened' | 'submitted'

function readStringField(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return null
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function readIdentityRejectionCode(profile: Pick<TailorProfile, 'id_verification_metadata'>) {
  const metadata =
    profile.id_verification_metadata && typeof profile.id_verification_metadata === 'object'
      ? profile.id_verification_metadata
      : null
  const nested =
    metadata?.identity_verification && typeof metadata.identity_verification === 'object'
      ? (metadata.identity_verification as Record<string, unknown>)
      : null
  return (
    readStringField(metadata, ['rejection_code', 'rejectionCode']) ??
    readStringField(nested, ['rejection_code', 'rejectionCode']) ??
    ''
  ).toUpperCase()
}

export function isInvalidProfileImageRejected(
  profile:
    | Pick<TailorProfile, 'id_verification_status' | 'id_verification_metadata'>
    | null
    | undefined
) {
  return (
    profile?.id_verification_status === 'REJECTED' &&
    readIdentityRejectionCode(profile) === INVALID_PROFILE_IMAGE_REJECTION_CODE
  )
}

function identityRejectionMessage(
  profile: Pick<TailorProfile, 'id_verification_rejection_reason' | 'id_verification_metadata'>
) {
  const rejectionCode = readIdentityRejectionCode(profile)
  if (rejectionCode === INVALID_PROFILE_IMAGE_REJECTION_CODE) return PROFILE_IMAGE_REJECTION_MESSAGE

  const direct = profile.id_verification_rejection_reason?.trim()
  if (direct) return safeUserText(direct, 'Identity review needs a clearer retake.')

  const metadata =
    profile.id_verification_metadata && typeof profile.id_verification_metadata === 'object'
      ? profile.id_verification_metadata
      : null
  const nested =
    metadata?.identity_verification && typeof metadata.identity_verification === 'object'
      ? (metadata.identity_verification as Record<string, unknown>)
      : null
  const reason =
    readStringField(metadata, [
      'rejection_reason',
      'rejectionReason',
      'moderation_note',
      'moderationMessage',
      'reason',
      'note',
    ]) ??
    readStringField(nested, [
      'rejection_reason',
      'rejectionReason',
      'moderation_note',
      'moderationMessage',
      'reason',
      'note',
    ])

  return safeUserText(
    reason,
    'Trust review needs a clearer retake. Record the challenge again with your face, voice, and full private phrase clearly captured.'
  )
}

type IdentityHandoffSession = {
  handoffId?: string
  token?: string
  path?: string
  url?: string
  expiresAt?: string
  challengeId?: string
  challengeText?: string
}

type IdentityProfileStatus = {
  status?: string
  rejectionReason?: string | null
  rejectionCode?: string | null
}

type SignupTrustResume = {
  token: string
  storagePath: string
  challengeId: string
  challengeText: string
  consentGranted: true
  draft: SignupMediaDraftDescriptor
}

function readSignupTrustResume(userId: string): SignupTrustResume | null {
  try {
    const raw = window.localStorage.getItem(tailorWebSetupDraftKey(userId))
    if (!raw) return null
    const value = JSON.parse(raw) as Record<string, unknown>
    const draft = value.signupTrustVideoDraft as SignupMediaDraftDescriptor | null
    if (
      !draft?.key ||
      typeof value.signupTrustHandoffToken !== 'string' ||
      !value.signupTrustHandoffToken ||
      typeof value.signupTrustStoragePath !== 'string' ||
      !value.signupTrustStoragePath ||
      typeof value.signupTrustChallengeId !== 'string' ||
      value.signupTrustConsentGranted !== true
    ) return null
    return {
      token: value.signupTrustHandoffToken,
      storagePath: value.signupTrustStoragePath,
      challengeId: value.signupTrustChallengeId,
      challengeText: typeof value.signupTrustChallengeText === 'string' ? value.signupTrustChallengeText : '',
      consentGranted: true,
      draft,
    }
  } catch {
    return null
  }
}

function clearSignupTrustResume(userId: string) {
  try {
    const key = tailorWebSetupDraftKey(userId)
    const raw = window.localStorage.getItem(key)
    if (!raw) return
    const value = JSON.parse(raw) as Record<string, unknown>
    window.localStorage.setItem(key, JSON.stringify({
      ...value,
      signupTrustVideoDraft: null,
      signupTrustChallengeId: '',
      signupTrustChallengeText: '',
      signupTrustConsentGranted: false,
      signupTrustHandoffToken: '',
      signupTrustStoragePath: '',
    }))
  } catch {
    // The authoritative submitted state still wins if local cleanup fails.
  }
}

export function IdentityHandoffCard({
  userId,
  profile,
  onRefresh,
  onReplaceProfilePhoto,
  onUpdatePortfolio,
}: {
  userId: string | null
  profile: TailorProfile
  onRefresh: () => void
  onReplaceProfilePhoto?: () => void
  onUpdatePortfolio?: () => void
}) {
  const [session, setSession] = useState<IdentityHandoffSession | null>(null)
  const [delivery, setDelivery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [handoffState, setHandoffState] = useState<IdentityHandoffRealtimeState>('idle')
  const [signupResume, setSignupResume] = useState<SignupTrustResume | null>(() =>
    userId ? readSignupTrustResume(userId) : null
  )
  const [authoritativeStatus, setAuthoritativeStatus] = useState<string | null>(null)
  const [authoritativeRejectionReason, setAuthoritativeRejectionReason] = useState<string | null>(null)
  const [authoritativeRejectionCode, setAuthoritativeRejectionCode] = useState<string | null>(null)
  const signupResumeAttemptedRef = useRef(false)
  const status = authoritativeStatus ?? profile.id_verification_status ?? 'NOT_SUBMITTED'
  const handoffUrl = session?.url ?? ''
  const pending = status === 'PENDING'
  const verified =
    isVerifiedIdentityStatus(status) || profile.is_verified === true || profile.is_live === true
  const rejected = status === 'REJECTED'
  const profileImageRejected = rejected && (
    authoritativeRejectionCode === INVALID_PROFILE_IMAGE_REJECTION_CODE ||
    isInvalidProfileImageRejected(profile)
  )
  const portfolioRejected = rejected && (
    authoritativeRejectionCode === INVALID_PORTFOLIO_MEDIA_REJECTION_CODE ||
    readIdentityRejectionCode(profile) === INVALID_PORTFOLIO_MEDIA_REJECTION_CODE
  )
  const rejectionMessage = rejected
    ? profileImageRejected
      ? PROFILE_IMAGE_REJECTION_MESSAGE
      : authoritativeRejectionReason
        ? safeUserText(authoritativeRejectionReason, 'Identity review needs a clearer retake.')
        : identityRejectionMessage(profile)
    : null
  const handoffStatusText =
    handoffState === 'opened'
      ? 'Recording device connected. Complete the private challenge there...'
      : handoffState === 'submitted'
        ? 'Trust video submitted for review. Our team completes reviews within 24 hours.'
        : 'Waiting for a secure recording connection...'
  const payoutReady = isPayoutReady(profile)

  const finishSavedSignupVideo = useCallback(async () => {
    if (!userId || !signupResume) return
    setBusy('signup-resume')
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('identity-handoff-action', {
        action: 'submit',
        token: signupResume.token,
        storagePath: signupResume.storagePath,
        consentGranted: true,
        consentVersion: IDENTITY_CONSENT_POLICY_VERSION,
        consentSource: 'WEB_SETUP',
        locale: navigator.language || 'en',
      })
      await deleteSignupMediaDraft(signupResume.draft.key).catch(() => undefined)
      clearSignupTrustResume(userId)
      setSignupResume(null)
      setHandoffState('submitted')
      setSuccess('Your saved private video was submitted for trust review.')
      onRefresh()
    } catch (resumeError) {
      setError(friendlyActionError(
        resumeError,
        'Your private video is saved. Complete the remaining portfolio or ready-made proof, then retry.',
      ))
    } finally {
      setBusy(null)
    }
  }, [onRefresh, signupResume, userId])

  useEffect(() => {
    if (!signupResume || signupResumeAttemptedRef.current || pending || verified) return
    signupResumeAttemptedRef.current = true
    void finishSavedSignupVideo()
  }, [finishSavedSignupVideo, pending, signupResume, verified])

  const checkLatestStatus = useCallback(async () => {
    if (!userId) return
    const result = await invokeAccountFunction<IdentityProfileStatus>(
      'identity-handoff-action',
      { action: 'profile-status' }
    )
    const nextStatus = result.status ?? null
    if (nextStatus) setAuthoritativeStatus(nextStatus)
    setAuthoritativeRejectionReason(result.rejectionReason?.trim() || null)
    setAuthoritativeRejectionCode(result.rejectionCode?.trim().toUpperCase() || null)
    if (nextStatus === 'PENDING') {
      setHandoffState('submitted')
      setSuccess('Trust video submitted. Review is now pending.')
      onRefresh()
    }
  }, [onRefresh, userId])

  // Status tracking depends on the signed-in tailor and nothing else.
  //
  // This used to poll only while `session` — the handoff created in *this tab*
  // — was in memory, and otherwise relied on `visibilitychange`. A tailor who
  // recorded on her phone while leaving this tab open therefore saw nothing
  // change: the tab never lost visibility, so nothing ever re-checked, and the
  // page sat on "waiting for a secure recording connection" until she reloaded
  // by hand. Polling now runs on an interval whenever the status is not
  // terminal, whether or not this tab created the session.
  useEffect(() => {
    if (!userId || pending || verified) return undefined
    const initialRefresh = window.setTimeout(() => {
      void checkLatestStatus()
    }, 0)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void checkLatestStatus()
    }
    const interval = window.setInterval(refreshWhenVisible, 15_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [checkLatestStatus, pending, userId, verified])

  // Restores the waiting state after a reload. The raw handoff token is hashed
  // on creation and never stored, so the QR code itself cannot come back — but
  // the fact that a recording session is live can, which is what keeps the page
  // honest instead of pretending nothing is in flight.
  useEffect(() => {
    if (!userId || pending || verified || session) return
    let active = true
    void invokeAccountFunction<{ active?: boolean; status?: string }>('identity-handoff-action', {
      action: 'active-session',
    })
      .then((result) => {
        if (!active || !result?.active) return
        setHandoffState(result.status === 'CAPTURED' || result.status === 'OPENED' ? 'opened' : 'waiting')
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [pending, session, userId, verified])

  // Subscribes on the tailor, not on this tab's handoff session. The session
  // gate meant a reload — or recording from a link opened elsewhere — silently
  // disabled live updates.
  useEffect(() => {
    if (!userId || pending || verified) return undefined
    const supabase = createClient()
    const channel = supabase
      .channel(`tailor-idv-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tailor_profiles',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const nextStatus = String(
            (payload.new as { id_verification_status?: string | null })?.id_verification_status ??
              ''
          )
          if (nextStatus === 'PENDING') {
            setHandoffState('submitted')
            setSuccess('Trust video submitted. Review is now pending.')
            onRefresh()
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [onRefresh, pending, userId, verified])

  useEffect(() => {
    if (!session?.handoffId || pending || verified) return undefined
    const supabase = createClient()
    const channel = supabase
      .channel(`identity-handoff-session-${session.handoffId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'identity_verification_handoffs',
          filter: `id=eq.${session.handoffId}`,
        },
        (payload) => {
          const nextStatus = String((payload.new as { status?: string | null })?.status ?? '')
          if (nextStatus === 'OPENED' || nextStatus === 'CAPTURED') {
            setHandoffState('opened')
          }
          if (nextStatus === 'SUBMITTED') {
            setHandoffState('submitted')
            onRefresh()
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [onRefresh, pending, session?.handoffId, verified])

  async function startSession() {
    if (!userId) return
    setBusy('create')
    setError(null)
    setSuccess(null)
    try {
      const result = await invokeAccountFunction<IdentityHandoffSession>(
        'identity-handoff-action',
        {
          action: 'create',
        }
      )
      setSession(result)
      setHandoffState('waiting')
      setSuccess('Scan the QR code or email yourself the secure recorder link.')
    } catch (handoffError) {
      setError(friendlyActionError(handoffError, 'Trust-video handoff could not start.'))
    } finally {
      setBusy(null)
    }
  }

  async function sendLink() {
    if (!session?.token) return
    const email = delivery.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      setError('Enter a valid email address.')
      return
    }
    setBusy('send')
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('identity-handoff-action', {
        action: 'send-link',
        token: session.token,
        channel: 'EMAIL',
        requestedDelivery: email,
      })
      setSuccess('Trust-video recorder link sent by email.')
    } catch (handoffError) {
      setError(friendlyActionError(handoffError, 'Trust-video handoff link could not send.'))
    } finally {
      setBusy(null)
    }
  }

  if (profileImageRejected) {
    return (
      <section className="rounded-[8px] border border-rust/20 bg-rust/8 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust">
          Marketplace trust review
        </p>
        <h3 className="mt-2 text-xl font-semibold text-ink">Profile photo needs replacement</h3>
        <p className="mt-2 text-sm leading-6 text-rust/90">{PROFILE_IMAGE_REJECTION_MESSAGE}</p>
        <p className="mt-2 text-sm leading-6 text-ink/64">
          Your private challenge video remains on file. Upload a clearer avatar below, then submit
          setup again so ops can re-review the public photo.
        </p>
        <button
          type="button"
          onClick={() => {
            if (onReplaceProfilePhoto) {
              onReplaceProfilePhoto()
              return
            }
            document.getElementById('profile-photo')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          className="mt-4 inline-flex rounded-full bg-rust px-4 py-2 text-sm font-semibold text-white"
        >
          Upload replacement photo
        </button>
      </section>
    )
  }

  if (portfolioRejected) {
    return (
      <section className="rounded-[8px] border border-rust/20 bg-rust/8 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rust">
          Marketplace trust review
        </p>
        <h3 className="mt-2 text-xl font-semibold text-ink">Portfolio needs an update</h3>
        <p className="mt-2 text-sm leading-6 text-rust/90">{rejectionMessage}</p>
        <p className="mt-2 text-sm leading-6 text-ink/64">
          Your private challenge video remains on file. Replace or remove the portfolio media named
          in the reason, then save it to send the profile back to Ops.
        </p>
        <button
          type="button"
          onClick={() => {
            if (onUpdatePortfolio) {
              onUpdatePortfolio()
              return
            }
            document.getElementById('portfolio')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          className="mt-4 inline-flex rounded-full bg-rust px-4 py-2 text-sm font-semibold text-white"
        >
          Update portfolio
        </button>
      </section>
    )
  }

  if (verified || pending) {
    return (
      <section
        className={`rounded-[8px] border p-5 shadow-sm transition-all duration-500 ${verified ? 'border-needle/14 bg-needle/6' : 'border-emerald-400/25 bg-emerald-400/10'}`}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">
          Marketplace trust review
        </p>
        <h3 className="mt-2 text-xl font-semibold text-ink">
          {verified ? 'Trust review approved' : 'Trust video submitted for review'}
        </h3>
        <p className="mt-2 text-sm leading-6 text-ink/64">
          {verified
            ? 'Your private challenge video and public profile have passed review.'
            : 'Our team completes reviews within 24 hours. Keep your profile details accurate while Drapeon Trust reviews them.'}
        </p>
        <Link
          href="/account/work"
          className="mt-4 inline-flex rounded-full bg-needle px-4 py-2 text-sm font-semibold text-white"
        >
          Continue to dashboard
        </Link>
        {!payoutReady ? (
          <Link
            href="/account/payout"
            className="ml-3 mt-4 inline-flex text-sm font-semibold text-needle"
          >
            Set up payouts →
          </Link>
        ) : null}
      </section>
    )
  }

  if (signupResume) {
    return (
      <section className="rounded-[8px] border border-needle/14 bg-needle/6 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">
          Private video saved during signup
        </p>
        <h3 className="mt-2 text-xl font-semibold text-ink">
          {busy === 'signup-resume' ? 'Checking your studio proof…' : 'Your challenge video is ready.'}
        </h3>
        <p className="mt-2 text-sm leading-6 text-ink/64">
          Drapeon keeps this video private. Boutique and Tailor Shop accounts must add their required ready-made listing before the trust review can begin.
        </p>
        {signupResume.challengeText ? (
          <p className="mt-3 rounded-[8px] border border-needle/12 bg-white/70 p-3 text-xs leading-5 text-ink/62">
            Recorded challenge: {signupResume.challengeText}
          </p>
        ) : null}
        <ActionNotice error={error} success={success} />
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" onClick={() => void finishSavedSignupVideo()} disabled={!!busy}>
            {busy === 'signup-resume' ? 'Checking…' : 'Finish trust submission'}
          </Button>
          {profile.supports_ready_made ? (
            <Button asChild variant="secondary">
              <Link href="/account/shop">Add ready-made listing</Link>
            </Button>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-[8px] border border-needle/12 bg-white/84 p-5 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/70">
            Private trust video
          </p>
          <h3 className="mt-2 text-2xl text-ink">Record a Private Challenge Video.</h3>
          <p className="mt-2 text-sm leading-6 text-ink/64">
            Record here with this computer’s camera, or continue on your phone or in the Drapeon
            app. Keep your face visible and say the private challenge phrase in full. Drapeon does
            not collect a government ID or create a biometric template.
          </p>
          {session?.challengeText ? (
            <div className="mt-4 rounded-[8px] border border-needle/14 bg-needle/6 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/70">
                Your private challenge
              </p>
              <p className="mt-2 text-sm leading-6 text-ink/72">{session.challengeText}</p>
            </div>
          ) : null}
          {!payoutReady ? (
            <p className="mt-4 text-sm leading-6 text-ink/58">
              Payout setup is not required for this review. We will prompt you after submission,
              before you can accept paid work.
            </p>
          ) : null}
          {rejected ? (
            <div className="mt-4 rounded-[8px] border border-rust/20 bg-rust/8 p-4">
              <p className="text-sm font-semibold text-rust">Challenge-video retake needed</p>
              <p className="mt-1.5 text-sm leading-6 text-rust/90">{rejectionMessage}</p>
            </div>
          ) : null}
          <ActionNotice error={error} success={success} />
        </div>

        <div className="w-full max-w-sm rounded-[8px] border border-ink/8 bg-bone/70 p-4 transition-all duration-500">
          {handoffState === 'submitted' ? (
            <div className="mb-4 translate-y-0 rounded-[8px] border border-emerald-400/25 bg-emerald-400/10 p-4 opacity-100 transition-all duration-500">
              <p className="text-sm font-semibold text-needle">Trust video submitted for review</p>
              <p className="mt-1.5 text-sm leading-6 text-ink/64">
                Our team completes reviews within 24 hours.
              </p>
            </div>
          ) : null}
          {handoffUrl ? (
            <div
              className={`grid justify-items-center gap-4 transition-all duration-500 ${handoffState === 'submitted' ? 'max-h-0 -translate-y-2 overflow-hidden opacity-0' : 'max-h-[560px] translate-y-0 opacity-100'}`}
            >
              <a
                href={handoffUrl}
                className="flex w-full items-center justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
              >
                Record on this laptop
              </a>
              <p className="text-center text-xs leading-5 text-ink/56">
                Or scan the QR code to record on your phone.
              </p>
              <div
                className="rounded-[8px] border border-ink/8 bg-white p-3 shadow-inner"
                aria-label="Trust-video handoff QR code"
              >
                <QRCodeSVG value={handoffUrl} size={180} includeMargin={true} />
              </div>
              <div className="grid w-full justify-items-center gap-2">
                <div className="flex items-center gap-2 rounded-full border border-ink/8 bg-white/80 px-3 py-2 text-xs font-semibold text-ink/68">
                  {handoffState === 'opened' ? (
                    <span
                      className="h-3 w-3 animate-spin rounded-full border-2 border-needle/25 border-t-needle"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-needle opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-needle" />
                    </span>
                  )}
                  <span>{handoffStatusText}</span>
                </div>
                {/* Live updates now run on an interval, but a tailor who has
                    finished on her phone should never have to trust that — or
                    reload the page — to find out. */}
                <button
                  type="button"
                  onClick={() => {
                    void checkLatestStatus()
                  }}
                  className="min-h-9 rounded-full px-3 text-xs font-semibold text-needle underline decoration-needle/30 underline-offset-2"
                >
                  I&apos;ve recorded it — check now
                </button>
              </div>
              <div className="grid w-full gap-2">
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={delivery}
                  onChange={(event) => setDelivery(event.target.value)}
                  placeholder="Email address"
                  aria-label="Email address"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <button
                  type="button"
                  onClick={() => {
                    void sendLink()
                  }}
                  disabled={busy === 'send' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(delivery.trim())}
                  className="rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:bg-ink/20"
                >
                  {busy === 'send' ? 'Sending...' : 'Email link to myself'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                void startSession()
              }}
              disabled={busy === 'create'}
              className="flex w-full justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:bg-ink/20"
            >
              {busy === 'create' ? 'Starting...' : 'Start private trust video'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
