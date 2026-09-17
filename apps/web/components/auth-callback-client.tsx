'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import {
  resolveAuthenticatedRole,
  shouldApplyFreshSignupRole,
  shouldChooseRoleAfterFreshProviderSignIn,
} from '@drape/shared/auth-role'
import { IDENTITY_CONSENT_POLICY_VERSION } from '@drape/shared'
import { createClient } from '../lib/supabase'
import { readFunctionErrorMessage } from '../lib/function-errors'
import { RECOVERY_HANDOFF_KEY, RECOVERY_INTENT_KEY } from '../lib/auth-recovery-intent'
import {
  clearIdentityLinkIntent,
  parseIdentityLinkProvider,
  readIdentityLinkIntent,
} from '../lib/auth-identity-link-intent'
import {
  bootstrapWebOnboarding,
  persistedWebOnboardingPayload,
  webOnboardingFromUser,
  type WebOnboardingPayload,
} from '../lib/account-bootstrap'
import { markWebSessionScope } from '../lib/web-session-scope'
import {
  clearOAuthSignupDraft,
  readOAuthSignupDraft,
} from '../lib/oauth-signup-draft'
import {
  cleanupQuarantinedSignupMedia,
  deleteSignupMediaDraft,
  readSignupMediaDraft,
  restoreQuarantinedSignupMedia,
  type SignupMediaDraftDescriptor,
} from '../lib/signup-media-draft'

type EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'

type OAuthIntent = {
  provider: 'apple' | 'google'
  mode: 'sign-in' | 'sign-up'
  role: 'CUSTOMER' | 'TAILOR' | null
  next: string
  startedAt: number
}

const OAUTH_INTENT_KEY = 'drapeon.web.auth.oauthIntent.v1'
const OAUTH_INTENT_MAX_AGE_MS = 15 * 60_000
const RECOVERY_INTENT_MAX_AGE_MS = 15 * 60_000

const emailOtpTypes = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

function sanitizeNext(value: string | null) {
  if (!value) return '/account/orders'
  if (value.startsWith('/') && !value.startsWith('//')) return value
  // Email templates pass `.RedirectTo`, which is a full URL. Accept it when it
  // points at this origin and use its path, so a confirmation link still lands
  // a tailor in setup rather than the customer order list.
  try {
    const parsed = new URL(value, window.location.origin)
    if (parsed.origin !== window.location.origin) return '/account/orders'
    const inner = parsed.searchParams.get('next')
    if (inner?.startsWith('/') && !inner.startsWith('//')) return inner
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`
    return path.startsWith('/auth/callback') ? '/account/orders' : path
  } catch {
    return '/account/orders'
  }
}

function normalizeEmailOtpType(value: string | null): EmailOtpType | null {
  return value && emailOtpTypes.has(value as EmailOtpType) ? (value as EmailOtpType) : null
}

function mapCallbackError(message: string | undefined, status?: number) {
  const normalized = (message ?? '').toLowerCase()
  if (message === 'DRAPEON_IDENTITY_LINK_EXPIRED') {
    return 'That sign-in connection expired. Return to account settings and start it again.'
  }
  if (message === 'DRAPEON_IDENTITY_LINK_ACCOUNT_MISMATCH') {
    return 'That sign-in belongs to a different Drapeon account. Nothing was linked.'
  }
  if (message === 'DRAPEON_IDENTITY_LINK_MISSING_PROVIDER') {
    return 'Google did not finish connecting to this account. Return to settings and try again.'
  }
  if (message === 'DRAPEON_CROSS_BROWSER_LINK') {
    return 'This link has to finish in the browser that started signup. If you have already confirmed your account, sign in here to continue.'
  }
  if (status === 401 || status === 403) {
    return 'Your session has expired. Return to sign in and try again.'
  }
  if (normalized.includes('access_denied') || normalized.includes('cancel')) {
    return 'Account access was cancelled. Nothing was changed.'
  }
  if (normalized.includes('expired') || normalized.includes('invalid')) {
    return 'This account link has expired or was already used. Request a fresh link and try again.'
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'We could not reach Drapeon. Check your connection and try again.'
  }
  return 'We could not finish this account link. Return to sign in and try again.'
}

function readOAuthIntent(): OAuthIntent | null {
  const raw = window.localStorage.getItem(OAUTH_INTENT_KEY)
  if (!raw) return null
  try {
    const intent = JSON.parse(raw) as OAuthIntent
    if (
      (intent.provider !== 'apple' && intent.provider !== 'google') ||
      (intent.mode !== 'sign-in' && intent.mode !== 'sign-up') ||
      !Number.isFinite(intent.startedAt) ||
      Date.now() - intent.startedAt > OAUTH_INTENT_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(OAUTH_INTENT_KEY)
      return null
    }
    return intent
  } catch {
    window.localStorage.removeItem(OAUTH_INTENT_KEY)
    return null
  }
}

function oauthRecoveryHref(intent: OAuthIntent | null, next: string) {
  if (intent?.mode === 'sign-up') {
    const role = intent.role === 'TAILOR' ? 'TAILOR' : 'CUSTOMER'
    return `/sign-up?role=${role}&notice=oauth-cancelled`
  }
  return `/sign-in?next=${encodeURIComponent(next)}&notice=oauth-cancelled`
}

function hasRecoveryMarker(searchParams: URLSearchParams) {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return (
    searchParams.get('type') === 'recovery' ||
    searchParams.get('flow') === 'recovery' ||
    hashParams.get('type') === 'recovery' ||
    hashParams.get('flow') === 'recovery'
  )
}

function hasFreshRecoveryIntent() {
  const raw = window.localStorage.getItem(RECOVERY_INTENT_KEY)
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as { requestedAt?: number }
    if (
      !Number.isFinite(parsed.requestedAt) ||
      Date.now() - parsed.requestedAt! > RECOVERY_INTENT_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(RECOVERY_INTENT_KEY)
      return false
    }
    return true
  } catch {
    window.localStorage.removeItem(RECOVERY_INTENT_KEY)
    return false
  }
}

function redirectRecoveryCallback(searchParams: {
  forEach(callback: (value: string, key: string) => void): void
}): void {
  const recoveryUrl = new URL('/auth/recover', window.location.origin)
  searchParams.forEach((value, key) => recoveryUrl.searchParams.set(key, value))
  recoveryUrl.searchParams.set('flow', 'recovery')
  const hash = window.location.hash
  window.localStorage.setItem(RECOVERY_HANDOFF_KEY, JSON.stringify({ handedOffAt: Date.now() }))
  window.localStorage.removeItem(RECOVERY_INTENT_KEY)
  window.location.replace(`${recoveryUrl.pathname}${recoveryUrl.search}${hash}`)
}

async function applySessionFromUrl(
  supabase: ReturnType<typeof createClient>,
  searchParams: { get(name: string): string | null }
) {
  const providerError = searchParams.get('error_description') ?? searchParams.get('error')
  if (providerError) {
    throw new Error(providerError)
  }

  const code = searchParams.get('code')
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      // Browser back/forward can replay an already-consumed OAuth callback.
      // Keep a valid session instead of turning that into a dead-end error.
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        // A PKCE code only verifies in the browser that started the flow. Older
        // confirmation emails still carry one, so opening those on a phone or
        // inside a mail app's webview lands here — after the link has already
        // been consumed server-side. Say what actually happened, and what to do.
        throw new Error('DRAPEON_CROSS_BROWSER_LINK')
      }
    }
    return
  }

  const tokenHash = searchParams.get('token_hash')
  const otpType = normalizeEmailOtpType(searchParams.get('type'))
  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    })
    if (error) throw error
    return
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (error) throw error
  }
}

async function syncRoleMirror(role: 'CUSTOMER' | 'TAILOR') {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  const userId = data.user?.id
  if (!userId) return

  const { error } = await supabase
    .from('users')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) throw error
}

function readStoredOnboarding() {
  const raw = window.localStorage.getItem('drapeon.web.auth.onboarding')
  if (!raw) return null
  try {
    const payload = JSON.parse(raw) as WebOnboardingPayload
    return payload?.source === 'web' ? payload : null
  } catch {
    return null
  }
}

async function uploadOnboardingAvatar(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  role: 'CUSTOMER' | 'TAILOR',
  avatarDataUrl: string
) {
  if (!avatarDataUrl.startsWith('data:image/jpeg;base64,')) return
  const blob = await fetch(avatarDataUrl).then((response) => response.blob())
  const path = `${userId}/avatar.jpg`
  const uploaded = await supabase.storage.from('avatars').upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: true,
  })
  if (uploaded.error) throw uploaded.error
  const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
  const avatarUrl = `${publicUrl}?v=${Date.now()}`
  const result = await supabase.functions.invoke('account-profile-action', {
    body: { action: 'update-avatar', role, avatarUrl },
  })
  if (result.error || (result.data as { error?: unknown } | null)?.error) {
    throw result.error ?? new Error('Profile photo could not be attached to this account.')
  }
}

async function uploadOnboardingAvatarDraft(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  role: 'CUSTOMER' | 'TAILOR',
  draft: SignupMediaDraftDescriptor
) {
  const blob = await readSignupMediaDraft(draft.key)
  if (!blob)
    throw new Error(
      'Your saved profile photo is missing from this browser. Return to signup and choose it again.'
    )
  const path = `${userId}/avatar.jpg`
  const uploaded = await supabase.storage.from('avatars').upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: true,
  })
  if (uploaded.error) throw uploaded.error
  const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
  const result = await supabase.functions.invoke('account-profile-action', {
    body: { action: 'update-avatar', role, avatarUrl: `${publicUrl}?v=${Date.now()}` },
  })
  if (result.error || (result.data as { error?: unknown } | null)?.error) {
    throw result.error ?? new Error('Profile photo could not be attached to this account.')
  }
  await deleteSignupMediaDraft(draft.key).catch(() => undefined)
}

async function uploadOnboardingPortfolio(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  dataUrls: string[]
) {
  const urls: string[] = []
  for (const [index, dataUrl] of dataUrls.slice(0, 4).entries()) {
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) continue
    const blob = await fetch(dataUrl).then((response) => response.blob())
    const path = `portfolio/${userId}/signup-${index + 1}-${Date.now()}.jpg`
    const uploaded = await supabase.storage.from('portfolio-photos').upload(path, blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploaded.error) throw uploaded.error
    urls.push(supabase.storage.from('portfolio-photos').getPublicUrl(path).data.publicUrl)
  }
  if (!urls.length) return
  const seeded = await supabase.functions.invoke('portfolio-item-action', {
    body: { action: 'seed-from-setup', photoUrls: urls },
  })
  if (seeded.error || (seeded.data as { error?: unknown } | null)?.error) {
    throw seeded.error ?? new Error('Portfolio photos could not be attached to this account.')
  }
}

async function uploadOnboardingPortfolioImages(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  drafts: SignupMediaDraftDescriptor[]
) {
  const urls: string[] = []
  for (const [index, draft] of drafts.slice(0, 12).entries()) {
    const blob = await readSignupMediaDraft(draft.key)
    if (!blob)
      throw new Error(
        'A saved portfolio photo is missing from this browser. Return to signup and choose it again.'
      )
    const path = `portfolio/${userId}/signup-${index + 1}-${Date.now()}.jpg`
    const uploaded = await supabase.storage.from('portfolio-photos').upload(path, blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploaded.error) throw uploaded.error
    urls.push(supabase.storage.from('portfolio-photos').getPublicUrl(path).data.publicUrl)
  }
  if (!urls.length) return
  const seeded = await supabase.functions.invoke('portfolio-item-action', {
    body: { action: 'seed-from-setup', photoUrls: urls },
  })
  if (seeded.error || (seeded.data as { error?: unknown } | null)?.error) {
    throw seeded.error ?? new Error('Portfolio photos could not be attached to this account.')
  }
  await Promise.all(drafts.map((draft) => deleteSignupMediaDraft(draft.key).catch(() => undefined)))
}

function videoExtension(contentType: string) {
  if (contentType === 'video/quicktime') return 'mov'
  if (contentType === 'video/webm') return 'webm'
  return 'mp4'
}

async function uploadOnboardingPortfolioVideos(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  drafts: SignupMediaDraftDescriptor[]
) {
  const urls: string[] = []
  for (const [index, draft] of drafts.slice(0, 4).entries()) {
    const blob = await readSignupMediaDraft(draft.key)
    if (!blob)
      throw new Error(
        'A saved portfolio video is missing from this browser. Return to signup and choose it again.'
      )
    const path = `portfolio/${userId}/videos/signup-${index + 1}-${Date.now()}.${videoExtension(draft.contentType)}`
    const uploaded = await supabase.storage.from('portfolio-photos').upload(path, blob, {
      contentType: draft.contentType,
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploaded.error) throw uploaded.error
    urls.push(supabase.storage.from('portfolio-photos').getPublicUrl(path).data.publicUrl)
  }
  if (!urls.length) return
  const updated = await supabase.functions.invoke('tailor-profile-action', {
    body: { action: 'update-portfolio-videos', videoUrls: urls },
  })
  if (updated.error || (updated.data as { error?: unknown } | null)?.error) {
    throw updated.error ?? new Error('Portfolio videos could not be attached to this account.')
  }
  await Promise.all(drafts.map((draft) => deleteSignupMediaDraft(draft.key).catch(() => undefined)))
}

async function submitOnboardingTrustVideo(
  supabase: ReturnType<typeof createClient>,
  onboarding: WebOnboardingPayload,
  deferSubmission: boolean
) {
  const draft = onboarding.trustVideoDraft
  const challengeId = onboarding.trustChallengeId
  if (!draft || !challengeId || onboarding.trustConsentGranted !== true) return null
  const blob = await readSignupMediaDraft(draft.key)
  if (!blob)
    throw new Error(
      'Your saved private trust video is missing from this browser. Return to setup and record it again.'
    )

  const created = await supabase.functions.invoke('identity-handoff-action', {
    body: { action: 'create', challengeId },
  })
  const createdData = (created.data ?? {}) as {
    token?: string
    challengeId?: string
    error?: string
  }
  if (created.error || !createdData.token || createdData.challengeId !== challengeId) {
    throw (
      created.error ??
      new Error(createdData.error ?? 'The private challenge could not be prepared.')
    )
  }
  const uploadRequest = await supabase.functions.invoke('identity-handoff-action', {
    body: { action: 'create-upload-url', token: createdData.token, contentType: draft.contentType },
  })
  const uploadData = (uploadRequest.data ?? {}) as {
    path?: string
    uploadToken?: string
    error?: string
  }
  if (uploadRequest.error || !uploadData.path || !uploadData.uploadToken) {
    throw (
      uploadRequest.error ??
      new Error(uploadData.error ?? 'The private video upload could not start.')
    )
  }
  const uploaded = await supabase.storage
    .from('trust-verification')
    .uploadToSignedUrl(uploadData.path, uploadData.uploadToken, blob, {
      contentType: draft.contentType,
      cacheControl: '0',
    })
  if (uploaded.error) throw uploaded.error
  if (deferSubmission) {
    return {
      token: createdData.token,
      storagePath: uploadData.path,
      draft,
      challengeId,
      challengeText: onboarding.trustChallengeText ?? '',
      consentGranted: true as const,
    }
  }
  const submitted = await supabase.functions.invoke('identity-handoff-action', {
    body: {
      action: 'submit',
      token: createdData.token,
      storagePath: uploadData.path,
      consentGranted: true,
      consentVersion: IDENTITY_CONSENT_POLICY_VERSION,
      consentSource: 'WEB_SETUP',
      locale: navigator.language || 'en',
    },
  })
  const submittedData = (submitted.data ?? {}) as { error?: string }
  if (submitted.error || submittedData.error) {
    throw (
      submitted.error ??
      new Error(submittedData.error ?? 'The private trust video could not be submitted.')
    )
  }
  await deleteSignupMediaDraft(draft.key).catch(() => undefined)
  return null
}

function preserveTailorSetupDraft(
  userId: string,
  onboarding: WebOnboardingPayload,
  trustResume?: {
    token: string
    storagePath: string
    draft: SignupMediaDraftDescriptor
    challengeId: string
    challengeText: string
    consentGranted: true
  } | null
) {
  const tailor = onboarding.tailor
  if (!tailor) return
  window.localStorage.setItem(
    `drape:tailor-setup-draft:v3:${userId}`,
    JSON.stringify({
      version: 3,
      displayName: onboarding.displayName,
      location: tailor.location,
      bio: tailor.bio ?? '',
      languages: tailor.languages,
      specialties: tailor.specialties,
      currency: onboarding.defaultCurrency,
      priceMin: tailor.priceRangeMin ? String(tailor.priceRangeMin / 100) : '',
      priceMax: tailor.priceRangeMax ? String(tailor.priceRangeMax / 100) : '',
      availability: tailor.availability ?? 'OPEN',
      sellerType: tailor.sellerType ?? 'TAILOR',
      supportsCustomOrders: tailor.supportsCustomOrders,
      supportsReadyMade: tailor.supportsReadyMade,
      acceptsCustomOrdersNow: tailor.supportsCustomOrders,
      shopPaused: false,
      pickupAvailable: tailor.fulfillment.includes('PICKUP'),
      deliveryAvailable: tailor.fulfillment.includes('DELIVERY'),
      shippingAvailable: tailor.fulfillment.includes('SHIPPING'),
      pickupAddress: tailor.pickupAddress ?? '',
      pickupCity: tailor.pickupCity ?? '',
      pickupRegion: tailor.pickupRegion ?? '',
      pickupPostalCode: tailor.pickupPostalCode ?? '',
      pickupCountryCode: tailor.pickupCountryCode ?? '',
      pickupInstructions: '',
      consultationMode: tailor.consultationMode ?? 'FREE',
      consultationRequirement: tailor.consultationRequirement ?? 'OPTIONAL',
      consultationFee: tailor.consultationFee ?? '',
      consultationDuration: tailor.consultationDuration ?? '30',
      consultationCallType: tailor.consultationCallType ?? 'VIDEO',
      consultationFeeCreditable: tailor.consultationFeeCreditable === true,
      signupTrustVideoDraft: trustResume?.draft ?? null,
      signupTrustChallengeId: trustResume?.challengeId ?? '',
      signupTrustChallengeText: trustResume?.challengeText ?? '',
      signupTrustConsentGranted: trustResume?.consentGranted === true,
      signupTrustHandoffToken: trustResume?.token ?? '',
      signupTrustStoragePath: trustResume?.storagePath ?? '',
    })
  )
}

export function AuthCallbackClient(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('Finishing sign in...')
  const [failed, setFailed] = useState(false)
  const [recoveryHref, setRecoveryHref] = useState('/sign-in')

  useEffect(() => {
    let active = true

    async function complete() {
      const next = sanitizeNext(searchParams.get('next'))
      const oauthIntent = readOAuthIntent()
      const identityLinkProvider = parseIdentityLinkProvider(searchParams.get('identity_link'))
      const identityLinkIntent = identityLinkProvider ? readIdentityLinkIntent() : null
      setRecoveryHref(
        identityLinkProvider ? '/account/settings' : oauthRecoveryHref(oauthIntent, next)
      )

      // Recovery must win over any existing authenticated session. Do this
      // before exchangeCodeForSession so the reset token can only be handled
      // by the recovery bridge, never by normal account-entry routing.
      if (hasRecoveryMarker(searchParams) || hasFreshRecoveryIntent()) {
        redirectRecoveryCallback(searchParams)
        return
      }

      if (identityLinkProvider && !identityLinkIntent) {
        setFailed(true)
        setMessage(mapCallbackError('DRAPEON_IDENTITY_LINK_EXPIRED'))
        return
      }

      const providerError = searchParams.get('error_description') ?? searchParams.get('error')
      if (providerError) {
        if (identityLinkProvider) clearIdentityLinkIntent()
        setFailed(true)
        setMessage(mapCallbackError(providerError))
        return
      }

      try {
        const supabase = createClient()
        await applySessionFromUrl(supabase, searchParams)

        const roleIntent = window.localStorage.getItem('drapeon.web.auth.roleIntent')
        const oauthSignupDraft = oauthIntent?.mode === 'sign-up' ? readOAuthSignupDraft() : null
        const { data, error: userError } = await supabase.auth.getUser()
        if (userError || !data.user) {
          throw userError ?? new Error('No authenticated account was found for this link.')
        }

        // Linking a provider is an in-account security action, not a new sign-in
        // or signup. Finish it before any role/bootstrap logic so connecting
        // Google can never replay onboarding or create a second profile.
        if (identityLinkProvider) {
          if (!identityLinkIntent || identityLinkIntent.provider !== identityLinkProvider) {
            throw new Error('DRAPEON_IDENTITY_LINK_EXPIRED')
          }
          if (identityLinkIntent.userId !== data.user.id) {
            throw new Error('DRAPEON_IDENTITY_LINK_ACCOUNT_MISMATCH')
          }
          const { data: identityData, error: identityError } =
            await supabase.auth.getUserIdentities()
          if (identityError) throw identityError
          const linked = identityData.identities.some(
            (identity) => identity.provider === identityLinkProvider
          )
          if (!linked) throw new Error('DRAPEON_IDENTITY_LINK_MISSING_PROVIDER')

          clearIdentityLinkIntent()
          markWebSessionScope(true)
          const destination = new URL(identityLinkIntent.returnTo, window.location.origin)
          destination.searchParams.set('identity_linked', identityLinkProvider)
          if (active) {
            setFailed(false)
            setMessage('Sign-in method connected. Returning to account settings…')
            router.replace(`${destination.pathname}${destination.search}` as Route)
          }
          return
        }

        let onboarding = readStoredOnboarding() ?? webOnboardingFromUser(data.user)
        const mediaClaimToken =
          typeof data.user.user_metadata?.signup_media_claim_token === 'string'
            ? data.user.user_metadata.signup_media_claim_token
            : ''
        let mediaAccessToken = ''
        if (mediaClaimToken && onboarding) {
          const { data: sessionData } = await supabase.auth.getSession()
          mediaAccessToken = sessionData.session?.access_token ?? ''
          if (mediaAccessToken) {
            try {
              const restored = await restoreQuarantinedSignupMedia({
                userId: data.user.id,
                claimToken: mediaClaimToken,
                accessToken: mediaAccessToken,
              })
              const avatarDraft = restored.find((entry) => entry.kind === 'avatar')
              const portfolioImageDrafts = restored.filter(
                (entry) => entry.kind === 'portfolio-image'
              )
              const portfolioVideoDrafts = restored.filter(
                (entry) => entry.kind === 'portfolio-video'
              )
              const trustVideoDraft = restored.find((entry) => entry.kind === 'trust-video')
              onboarding = {
                ...onboarding,
                avatarDraft: avatarDraft ?? onboarding.avatarDraft,
                portfolioImageDrafts: portfolioImageDrafts.length
                  ? portfolioImageDrafts
                  : onboarding.portfolioImageDrafts,
                portfolioVideoDrafts: portfolioVideoDrafts.length
                  ? portfolioVideoDrafts
                  : onboarding.portfolioVideoDrafts,
                trustVideoDraft: trustVideoDraft ?? onboarding.trustVideoDraft,
                trustChallengeId:
                  typeof data.user.user_metadata?.signup_trust_challenge_id === 'string'
                    ? data.user.user_metadata.signup_trust_challenge_id
                    : onboarding.trustChallengeId,
                trustChallengeText:
                  typeof data.user.user_metadata?.signup_trust_challenge_text === 'string'
                    ? data.user.user_metadata.signup_trust_challenge_text
                    : onboarding.trustChallengeText,
                trustConsentGranted:
                  data.user.user_metadata?.signup_trust_consent_granted === true ||
                  onboarding.trustConsentGranted,
              }
            } catch (mediaError) {
              // Media recovery is useful, but auth and the profile bootstrap are
              // critical. A transient storage failure here previously aborted
              // confirmation and stranded a real tailor account with no profile.
              console.warn('[web auth] Signup media could not be restored', mediaError)
            }
          }
        }
        const metadataRole = data.user.user_metadata?.role
        const { data: roleMirror } = await supabase
          .from('users')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle()
        const applyFreshSignupRole = shouldApplyFreshSignupRole({
          intentMode: oauthIntent?.mode,
          intentRole: roleIntent,
          createdAt: data.user.created_at,
          lastSignInAt: data.user.last_sign_in_at,
        })
        const chooseFreshSignInRole = shouldChooseRoleAfterFreshProviderSignIn({
          intentMode: oauthIntent?.mode,
          createdAt: data.user.created_at,
          lastSignInAt: data.user.last_sign_in_at,
        })
        const ignoreProvisionalRole = applyFreshSignupRole || chooseFreshSignInRole
        const establishedRole = ignoreProvisionalRole
          ? null
          : metadataRole === 'CUSTOMER' || metadataRole === 'TAILOR'
            ? metadataRole
            : roleIntent === 'CUSTOMER' || roleIntent === 'TAILOR'
              ? null
              : roleMirror?.role
        const role = resolveAuthenticatedRole({
          establishedRole,
          onboardingRole: ignoreProvisionalRole ? null : onboarding?.role,
          entryIntent: chooseFreshSignInRole ? null : roleIntent,
        })
        const matchingOnboarding = onboarding?.role === role ? onboarding : null
        const matchingOAuthSignupDraft = oauthSignupDraft?.role === role ? oauthSignupDraft : null

        if (!role) {
          window.localStorage.removeItem('drapeon.web.auth.roleIntent')
          window.localStorage.removeItem('drapeon.web.auth.onboarding')
          markWebSessionScope(true)
          if (active) {
            setFailed(false)
            setMessage('Choose how you will use Drapeon…')
            router.replace(`/account/choose-role?next=${encodeURIComponent(next)}` as Route)
          }
          return
        }

        if (role) {
          const persistedOnboarding = matchingOnboarding
            ? persistedWebOnboardingPayload(matchingOnboarding)
            : undefined
          const accountDisplayName =
            matchingOnboarding?.displayName ?? matchingOAuthSignupDraft?.displayName
          const accountPhone = matchingOnboarding?.phone ?? matchingOAuthSignupDraft?.phone
          const { error: metadataError } = await supabase.auth.updateUser({
            data: {
              role,
              ...(accountDisplayName ? { display_name: accountDisplayName } : {}),
              ...(accountPhone ? { phone: accountPhone } : {}),
              ...(persistedOnboarding ? { web_onboarding: persistedOnboarding } : {}),
            },
          })
          if (metadataError) throw metadataError

          if (matchingOnboarding) {
            try {
              await bootstrapWebOnboarding(supabase, {
                userId: data.user.id,
                onboarding: matchingOnboarding,
              })
            } catch (bootstrapError) {
              // Email verification already succeeded. Recover a minimal role
              // profile so a stale/partial onboarding payload cannot strand a
              // valid account on the callback screen.
              console.warn(
                '[web auth] Full onboarding bootstrap could not be applied',
                bootstrapError
              )
              const fallback = await supabase.functions.invoke('account-profile-action', {
                body: { action: 'switch-role', role },
              })
              const fallbackPayload = (fallback.data ?? {}) as {
                error?: string
                message?: string
              }
              if (fallback.error) {
                throw new Error(
                  await readFunctionErrorMessage(
                    fallback.error,
                    fallbackPayload.message ||
                      fallbackPayload.error ||
                      'Your account setup could not be prepared.'
                  )
                )
              }
              if (fallbackPayload.error) {
                throw new Error(
                  fallbackPayload.message ||
                    fallbackPayload.error ||
                    'Your account setup could not be prepared.'
                )
              }
              if (role === 'TAILOR') {
                preserveTailorSetupDraft(data.user.id, matchingOnboarding, null)
              }
            }
            try {
              if (matchingOnboarding.avatarDraft) {
                await uploadOnboardingAvatarDraft(
                  supabase,
                  data.user.id,
                  role,
                  matchingOnboarding.avatarDraft
                )
              } else if (matchingOnboarding.avatarDataUrl) {
                await uploadOnboardingAvatar(
                  supabase,
                  data.user.id,
                  role,
                  matchingOnboarding.avatarDataUrl
                )
              }
            } catch (mediaError) {
              // The account is already safe to enter. Keep a media outage from
              // turning a completed confirmation into a failed login.
              console.warn('[web auth] Signup avatar could not be attached', mediaError)
            }
            if (role === 'TAILOR') {
              try {
                if (matchingOnboarding.portfolioImageDrafts?.length) {
                  await uploadOnboardingPortfolioImages(
                    supabase,
                    data.user.id,
                    matchingOnboarding.portfolioImageDrafts
                  )
                } else if (matchingOnboarding.portfolioDataUrls?.length) {
                  await uploadOnboardingPortfolio(
                    supabase,
                    data.user.id,
                    matchingOnboarding.portfolioDataUrls
                  )
                }
                if (matchingOnboarding.portfolioVideoDrafts?.length) {
                  await uploadOnboardingPortfolioVideos(
                    supabase,
                    data.user.id,
                    matchingOnboarding.portfolioVideoDrafts
                  )
                }
                const sellerType = matchingOnboarding.tailor?.sellerType ?? 'TAILOR'
                const trustResume = await submitOnboardingTrustVideo(
                  supabase,
                  matchingOnboarding,
                  sellerType !== 'TAILOR'
                )
                preserveTailorSetupDraft(data.user.id, matchingOnboarding, trustResume)
              } catch (mediaError) {
                // Preserve the written setup fields for a retry in the profile
                // workspace, but never make media handoff a prerequisite for a
                // usable authenticated account.
                console.warn('[web auth] Tailor signup media could not be attached', mediaError)
                preserveTailorSetupDraft(data.user.id, matchingOnboarding, null)
              }
            }
            if (mediaClaimToken && mediaAccessToken) {
              // Best effort. Staged media is a nice-to-have; failing to move or
              // clear it must never fail the account link itself. A 503 here
              // (quarantine storage unavailable) used to abort the whole
              // callback — which meant the tailor profile was never created and
              // the tailor landed on "Tailor profile not found".
              try {
                await cleanupQuarantinedSignupMedia({
                  userId: data.user.id,
                  claimToken: mediaClaimToken,
                  accessToken: mediaAccessToken,
                })
              } catch (mediaError) {
                console.warn('[web auth] Signup media could not be claimed', mediaError)
              }
            }
          } else if (applyFreshSignupRole) {
            const { data: switchData, error: switchError } = await supabase.functions.invoke(
              'account-profile-action',
              { body: { action: 'switch-role', role } }
            )
            const switchPayload = (switchData ?? {}) as { error?: string; message?: string }
            if (switchError || switchPayload.error) {
              throw new Error(
                switchPayload.message ||
                  switchPayload.error ||
                  switchError?.message ||
                  'Your account setup could not be prepared.'
              )
            }
          } else {
            await syncRoleMirror(role)
          }

          if (matchingOAuthSignupDraft) {
            const { data: personalData, error: personalError } = await supabase.functions.invoke(
              'account-profile-action',
              {
                body: {
                  action: 'update-personal-info',
                  role,
                  displayName: matchingOAuthSignupDraft.displayName,
                  phone: matchingOAuthSignupDraft.phone,
                },
              }
            )
            const personalPayload = (personalData ?? {}) as { error?: string; message?: string }
            if (personalError || personalPayload.error) {
              // The account exists and the session is valid; only the phone
              // number did not stick — most often because that number is
              // already on another account. Failing the whole callback here
              // stranded the tailor on an error screen with no way forward.
              // Setup asks for the phone again, and can now confirm it by
              // email, so carry on instead of dead-ending.
              console.warn(
                '[web auth] OAuth signup phone not saved',
                personalPayload.message || personalPayload.error || personalError?.message
              )
            }
            if (matchingOAuthSignupDraft.avatarDraft) {
              // OAuth creates the account after leaving this page, unlike the
              // email flow where media can be quarantined against a known user
              // ID. The selected photo remains in IndexedDB on this exact
              // browser origin, so attach it once the provider callback has
              // created the profile. This keeps signup and setup to one photo
              // for both customers and tailors.
              await uploadOnboardingAvatarDraft(
                supabase,
                data.user.id,
                role,
                matchingOAuthSignupDraft.avatarDraft
              )
            }
          }
        }

        window.localStorage.removeItem('drapeon.web.auth.roleIntent')
        window.localStorage.removeItem('drapeon.web.auth.onboarding')
        window.localStorage.removeItem('drapeon.web.auth.signup-draft.v1')
        clearOAuthSignupDraft()
        window.localStorage.removeItem(OAUTH_INTENT_KEY)
        markWebSessionScope(true)

        if (active) {
          setFailed(false)
          setMessage('Account link confirmed. Opening your Drapeon account...')
          router.replace(next as Route)
        }
      } catch (error) {
        if (active) {
          setFailed(true)
          setMessage(
            mapCallbackError(
              error instanceof Error ? error.message : undefined,
              typeof error === 'object' && error !== null && 'status' in error
                ? Number((error as { status?: unknown }).status) || undefined
                : undefined
            )
          )
        }
        return
      }
    }

    void complete()

    return () => {
      active = false
    }
  }, [router, searchParams])

  return (
    <main className="min-h-screen bg-ui-canvas px-5 py-8">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-lg place-items-center">
        <div className="w-full rounded-[8px] border border-ink/8 bg-white/88 p-7 text-center shadow-[0_18px_60px_rgba(22,28,24,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
            Drapeon
          </p>
          <h1 className="mt-3 text-4xl text-ink">Opening your account</h1>
          <p className="mt-4 text-sm leading-7 text-ink/66">{message}</p>
          {failed ? (
            <div className="mt-5 flex flex-col items-center gap-3">
              <Link
                href={recoveryHref as Route}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-needle px-5 py-2.5 text-sm font-semibold text-white"
              >
                Try again
              </Link>
              <Link href={recoveryHref as Route} className="text-sm font-semibold text-needle">
                {recoveryHref.startsWith('/account/settings')
                  ? 'Return to account settings'
                  : recoveryHref.startsWith('/sign-up')
                    ? 'Return to create account'
                    : 'Return to sign in'}
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
