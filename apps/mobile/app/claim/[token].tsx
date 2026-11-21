import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import {
  ActivityIndicator,
  Alert,
  Appearance,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import * as AuthSession from 'expo-auth-session'
import { Feather } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BottomSheetScaffold } from '@/components/ui/BottomSheetScaffold'
import { clearPendingTailorClaim, savePendingTailorClaim } from '@/lib/pending-tailor-claim'
import {
  clearTailorClaimResume,
  getTailorClaimResume,
  getVerifiedClaimEmail,
  saveTailorClaimResume,
  saveVerifiedClaimEmail,
} from '@/lib/tailor-claim-resume'
import { supabase } from '@/lib/supabase'
import {
  claimActionServerError,
  TAILOR_SPECIALTY_GROUPS,
  SUPPORTED_ACCOUNT_CURRENCIES,
} from '@drape/shared'
import { claimPickupPostcodeRequired } from '@drape/shared/claim-pickup-postcode'
import { sha256Hex, type LinkedAuthProvider } from '@/lib/auth'
import {
  DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
} from '@/components/ui/DrapePrimitives'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { AddressAutocompleteInput, ChoiceSheet, Input, PhoneNumberInput } from '@/components/ui'
import {
  Colors,
  FontSize,
  FontWeight,
  Radius,
  Spacing,
  getDrapeColors,
  type DrapeColorPalette,
} from '@/constants/theme'
import {
  PHONE_COUNTRIES,
  getPhoneCountryOption,
  type PhoneCountryCode,
} from '@drape/shared/phone-countries'

const CLAIM_TOKEN = /^[A-Za-z0-9_-]{40,60}$/u
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const CODE = /^\d{6}$/u
const GOOGLE_CLAIM_ENABLED = process.env.EXPO_PUBLIC_TAILOR_CLAIM_GOOGLE_ENABLED === 'true'
const postcodeRequired = claimPickupPostcodeRequired
type ClaimState = 'checking' | 'ready' | 'unavailable' | 'retryable'
type AccountStep =
  | 'review'
  | 'email'
  | 'code'
  | 'password'
  | 'provider'
  | 'details'
  | 'phone-recovery'
  | 'complete'
type ClaimMedia = {
  id: string
  kind: 'AVATAR' | 'PHOTO' | 'VIDEO'
  label: string
  cover: boolean
  previewUrl: string | null
}
type ClaimProfile = {
  displayName: string | null
  businessName: string | null
  bio: string | null
  location: string | null
  languages: string[] | null
  specialties: string[] | null
  priceMin: number | null
  priceMax: number | null
  currency: string | null
}
type EditSection = 'about' | 'specialties' | 'prices' | null

function claimCountryDefaults(location: string | null | undefined) {
  const value = location?.toLowerCase() ?? ''
  if (/nigeria|lagos|abuja|ibadan|port harcourt/u.test(value))
    return { country: 'NG', phone: '+234 ' }
  if (/ghana|accra|kumasi/u.test(value)) return { country: 'GH', phone: '+233 ' }
  if (/kenya|nairobi|mombasa/u.test(value)) return { country: 'KE', phone: '+254 ' }
  if (/united kingdom|england|scotland|wales|london|manchester/u.test(value))
    return { country: 'GB', phone: '+44 ' }
  if (/canada|toronto|vancouver/u.test(value)) return { country: 'CA', phone: '+1 ' }
  return { country: 'US', phone: '+1 ' }
}

function claimFailureCopy(error: unknown, provider?: LinkedAuthProvider | null) {
  switch (error) {
    case 'INVALID_EMAIL':
      return [
        'Invalid email address',
        'Enter a complete email address, such as name@example.com.',
      ] as const
    case 'EMAIL_LOCKED':
      return [
        'Email codes locked',
        `Too many email-code requests or guesses were made for this link. Continue with Apple${GOOGLE_CLAIM_ENABLED ? ' or Google' : ''}, or ask Drapeon for a new link.`,
      ] as const
    case 'CODE_EXPIRED':
      return [
        'Email code expired',
        'That six-digit code has expired. Request a new code and try again.',
      ] as const
    case 'INVALID_CODE':
      return [
        'Incorrect email code',
        'That code does not match. Check the email and enter the latest six-digit code.',
      ] as const
    case 'INVALID_PROVIDER':
      return [
        'Sign-in option unavailable',
        'That sign-in provider is not enabled for this claim. Choose email or Apple.',
      ] as const
    case 'INVALID_PROVIDER_PROOF':
    case 'PROVIDER_PROOF_INVALID':
      return [
        'Provider verification invalid',
        'The Apple or Google verification could not be validated. Start that sign-in again.',
      ] as const
    case 'PROVIDER_PROOF_EXPIRED':
      return [
        'Provider verification expired',
        'The Apple or Google verification took too long. Start that sign-in again.',
      ] as const
    case 'BOOTSTRAP_ALREADY_STARTED':
      return [
        'Claim sign-in needs a fresh code',
        'The earlier secure sign-in was interrupted. Reopen this link on the device where you started it, or wait up to 10 minutes for it to expire, then request a new email code.',
      ] as const
    case 'NOT_READY':
      return [
        'Shop not ready to claim',
        'This shop is missing approved media or a final review. Ask Drapeon to finish preparing it.',
      ] as const
    case 'PHONE_ALREADY_IN_USE':
      return [
        'Phone already in use',
        'That phone number belongs to another Drapeon account. Use a different number or sign in to that account.',
      ] as const
    case 'ACCOUNT_CONFLICT':
      return [
        'Account already exists',
        'That email or provider belongs to another Drapeon account. Use a different sign-in.',
      ] as const
    case 'CONSENT_MANIFEST_STALE':
      return [
        'Shop media changed',
        'Staff updated the shop media. Reopen the link and approve the current photos and videos.',
      ] as const
    case 'CONSENT_MANIFEST_INVALID':
      return [
        'Media approval incomplete',
        'Review and approve every listed photo and video before claiming the shop.',
      ] as const
    case 'INVALID_PHONE':
      return [
        'Invalid phone number',
        'Enter a complete mobile number, including its country code.',
      ] as const
    case 'INVALID_CLAIM':
      return [
        'Details incomplete',
        'Check the phone number, pickup address, country, and media consent, then try again.',
      ] as const
    case 'EMAIL_CREDENTIALS_REQUIRED':
      return [
        'Email sign-in incomplete',
        'Enter the verified email and create a password of at least 10 characters.',
      ] as const
    case 'EMAIL_VERIFICATION_REQUIRED':
      return [
        'Email code expired',
        'Request and verify a new six-digit email code before claiming the shop.',
      ] as const
    case 'PROVIDER_EMAIL_REQUIRED':
      return [
        'Provider email unavailable',
        'Apple or Google did not share an email address. Choose another sign-in method.',
      ] as const
    case 'PROVIDER_VERIFICATION_REQUIRED':
    case 'PROVIDER_IDENTITY_MISMATCH':
      return [
        'Provider verification failed',
        'The linked Apple or Google account did not match the account you verified. Start again.',
      ] as const
    case 'CLAIM_SESSION_EXPIRED':
      return [
        'Claim session expired',
        'Reopen the private link and verify your sign-in again. Your shop has not been lost.',
      ] as const
    case 'UNAVAILABLE':
      return [
        'Claim link unavailable',
        'This link expired, was revoked, or has already been used. Contact Drapeon for a new link.',
      ] as const
    case 'CLAIM_IN_PROGRESS':
      return [
        'Claim already in progress',
        'Sign in with the account you just confirmed so Drapeon can safely finish the interrupted claim.',
      ] as const
    case 'CLAIM_STATE_CHANGED':
      return [
        'Shop status changed',
        'The shop changed while you were claiming it. Reopen the private link to continue safely.',
      ] as const
    case 'CLAIM_RECEIPT_FAILED':
    case 'CLAIM_RECEIPT_MISSING':
      return [
        'Claim recovery unavailable',
        'This interrupted claim cannot be resumed automatically. Contact Drapeon for help.',
      ] as const
    case 'AUTH_HANDOVER_RETRY':
    case 'CLAIM_COMPLETION_RETRY':
      return [
        'Claim temporarily interrupted',
        'Your account information is safe. Check your connection and try again.',
      ] as const
    case 'CLAIM_PREPARE_RETRY':
      return [
        'Claim preparation interrupted',
        'No account details were changed. Check your connection and try claiming again.',
      ] as const
    case 'SECURE_SESSION_PREPARE_RETRY':
      return [
        'Secure session not ready',
        'Drapeon could not prepare the protected claim session. Request a new six-digit email code and try again.',
      ] as const
    case 'SECURE_SESSION_SETUP_RETRY':
      return [
        'Secure sign-in interrupted',
        provider === 'apple'
          ? 'The earlier sign-in was closed for safety. Try Apple sign-in again, or request a new six-digit email code to continue.'
          : 'The earlier sign-in was closed for safety. Request a new six-digit email code to continue.',
      ] as const
    case 'PROVIDER_PROOF_RECORD_RETRY':
    case 'PROVIDER_SESSION_RECORD_RETRY':
      return [
        'Sign-in status not saved',
        'Drapeon could not safely record the provider result. Check your connection and try again.',
      ] as const
    case 'INVALID_FINALIZE':
      return [
        'Setup details incomplete',
        'Add the required phone and shop setup details before making the shop live.',
      ] as const
    case 'RATE_LIMITED':
      return [
        'Too many attempts',
        'Wait a few minutes before trying this claim action again.',
      ] as const
    case 'AUTH_REQUIRED':
      return [
        'Sign-in required',
        'Your secure sign-in is no longer active. Reopen the private link and verify again.',
      ] as const
    case 'MEDIA_PROMOTION_RETRY':
    case 'MEDIA_RECORD_RETRY':
      return [
        'Media still processing',
        'Your account is safe, but Drapeon could not finish publishing the shop media. Try again shortly.',
      ] as const
    case 'SOURCE_MANIFEST_INVALID':
      return [
        'Shop media configuration error',
        'Drapeon could not verify the prepared media. Contact us before trying again.',
      ] as const
    default:
      return [
        'Claim not completed',
        'Drapeon could not complete the claim. Try again; if it continues, contact support.',
      ] as const
  }
}

function connectionFailureCopy() {
  return [
    'Connection interrupted',
    'Drapeon could not reach the claim service. Check your connection and try again.',
  ] as const
}

type ClaimActionResult = {
  // Claim responses intentionally vary by action and are narrowed at each call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  error: unknown
  serverError: string | null
}

async function invokeClaimAction(body: Record<string, unknown>): Promise<ClaimActionResult> {
  const result = await supabase.functions.invoke('tailor-claim-action', { body })
  const serverError = await claimActionServerError(result)

  return { data: result.data, error: result.error, serverError }
}

function claimActionFailureCopy(
  result: ClaimActionResult,
  fallback?: string,
  provider?: LinkedAuthProvider | null
) {
  if (result.serverError) return claimFailureCopy(result.serverError, provider)
  if (result.error) return connectionFailureCopy()
  return claimFailureCopy(result.data?.error ?? fallback, provider)
}

async function checkClaim(
  token: string
): Promise<{ state: ClaimState; profile?: ClaimProfile; media?: ClaimMedia[] }> {
  try {
    const result = await invokeClaimAction({ action: 'RESOLVE', token })
    const { data, error } = result
    if (error) {
      if (result.serverError === 'UNAVAILABLE') {
        await clearPendingTailorClaim()
        return { state: 'unavailable' }
      }
      return { state: 'retryable' }
    }
    if (data?.actionable !== true) {
      if (data?.retryable === true) return { state: 'retryable' }
      await clearPendingTailorClaim()
      return { state: 'unavailable' }
    }
    return (await savePendingTailorClaim(token))
      ? { state: 'ready', profile: data.preview?.profile, media: data.preview?.media }
      : { state: 'retryable' }
  } catch {
    return { state: 'retryable' }
  }
}

export default function TailorClaimEntryScreen() {
  const router = useRouter()
  useEffect(() => {
    Appearance.setColorScheme(null)
    return () => Appearance.setColorScheme('light')
  }, [])
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const palette = useMemo(() => getDrapeColors(scheme), [scheme])
  const styles = useMemo(() => createClaimStyles(palette), [palette])
  const claimScroll = useDrapeCapsuleNavScroll()
  const { token } = useLocalSearchParams<{ token?: string }>()
  const validToken = typeof token === 'string' && CLAIM_TOKEN.test(token)
  const [state, setState] = useState<ClaimState>(validToken ? 'checking' : 'unavailable')
  const [entryAttempt, setEntryAttempt] = useState(0)
  const [accountStep, setAccountStep] = useState<AccountStep>('review')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [resendSeconds, setResendSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [linkedProvider, setLinkedProvider] = useState<LinkedAuthProvider | null>(null)
  const [claimMedia, setClaimMedia] = useState<ClaimMedia[]>([])
  const [claimProfile, setClaimProfile] = useState<ClaimProfile | null>(null)
  const [editSection, setEditSection] = useState<EditSection>(null)
  const [editDraft, setEditDraft] = useState<ClaimProfile | null>(null)
  const [editError, setEditError] = useState('')
  const [locationQuery, setLocationQuery] = useState('')
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([])
  const [mediaError, setMediaError] = useState('')
  const [consentTextVersion, setConsentTextVersion] = useState('')
  const [phone, setPhone] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('US')
  const [password, setPassword] = useState('')
  const [manualAddress, setManualAddress] = useState(false)
  const [addressConfirmed, setAddressConfirmed] = useState(false)
  const [countryPickerVisible, setCountryPickerVisible] = useState(false)
  const [editPicker, setEditPicker] = useState<'specialties' | 'currency' | null>(null)
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [claimSessionId, setClaimSessionId] = useState('')

  useEffect(() => {
    if (editSection !== 'about' || locationQuery.trim().length < 3) {
      setLocationSuggestions([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationQuery.trim())}&format=json&addressdetails=1&limit=6&featuretype=city`,
          {
            headers: { 'Accept-Language': 'en', 'User-Agent': 'Drapeon/1.0' },
            signal: controller.signal,
          }
        )
        if (!response.ok) throw new Error('Location search unavailable')
        const rows = (await response.json()) as Array<{
          display_name?: string
          address?: {
            city?: string
            town?: string
            village?: string
            county?: string
            country?: string
          }
        }>
        setLocationSuggestions([
          ...new Set(
            rows
              .map((row) => {
                const city =
                  row.address?.city ??
                  row.address?.town ??
                  row.address?.village ??
                  row.address?.county ??
                  row.display_name?.split(',')[0]
                return city ? [city, row.address?.country].filter(Boolean).join(', ') : ''
              })
              .filter(Boolean)
          ),
        ])
      } catch {
        if (!controller.signal.aborted) setLocationSuggestions([])
      }
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [editSection, locationQuery])

  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => clearTimeout(timer)
  }, [resendSeconds])

  async function openClaimDetails(
    provider: LinkedAuthProvider | null,
    sessionId: string,
    nextStep: 'password' | 'details' = 'details',
    existingContext?: ClaimActionResult
  ) {
    const context =
      existingContext ?? (await invokeClaimAction({ action: 'GET_CLAIM_CONTEXT', token }))
    if (
      context.error ||
      context.data?.available !== true ||
      !Array.isArray(context.data?.media) ||
      !context.data?.profile ||
      typeof context.data?.consentTextVersion !== 'string'
    ) {
      const [, detail] = claimActionFailureCopy(context)
      setMessage(detail)
      return false
    }
    setLinkedProvider(provider)
    setClaimSessionId(sessionId)
    setClaimMedia(context.data.media as ClaimMedia[])
    setClaimProfile(context.data.profile as ClaimProfile)
    const defaults = claimCountryDefaults((context.data.profile as ClaimProfile).location)
    setCountryCode((current) => (current === 'US' ? defaults.country : current))
    setPhone((current) => (current.trim() ? current : defaults.phone))
    setConsentTextVersion(context.data.consentTextVersion)
    setAccountStep(nextStep)
    setMessage(null)
    return true
  }

  useEffect(() => {
    if (!validToken) return
    let active = true
    void (async () => {
      const refreshed = await supabase.auth.refreshSession().catch(() => null)
      const user = refreshed?.data?.session?.user
      if (user?.app_metadata?.account_origin === 'CLAIMED') {
        const replay = await supabase.functions.invoke('tailor-claim-action', {
          body: { action: 'CLAIM', token },
        })
        if (replay.data?.claimed === true) {
          if (!active) return
          setState('ready')
          setAccountStep('complete')
          setMessage('Your shop is now yours. Continue to verify your phone and go live.')
          return
        }
        if (replay.data?.recovery === 'CORRECT_PHONE') {
          if (!active) return
          setState('ready')
          setAccountStep('phone-recovery')
          setMessage(
            'That phone number is already used by another Drapeon account. Enter a different number to finish this claim.'
          )
          return
        }
      }
      if (
        user?.app_metadata?.account_origin === 'STAFF_DRAFT' &&
        typeof user.app_metadata.claim_session_id === 'string'
      ) {
        const sessionId = user.app_metadata.claim_session_id
        const context = await invokeClaimAction({ action: 'GET_CLAIM_CONTEXT', token })
        if (context.data?.available === true) {
          const provider =
            context.data.provider === 'apple' || context.data.provider === 'google'
              ? (context.data.provider as LinkedAuthProvider)
              : null
          if (provider) {
            const linked = await invokeClaimAction({
              action: 'VERIFY_LINKED_PROVIDER',
              token,
              provider,
            })
            if (linked.data?.verified !== true) {
              await clearTailorClaimResume()
              await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
            } else {
              const resumed = await openClaimDetails(provider, sessionId, 'details', context)
              if (active && resumed) {
                setState('ready')
                return
              }
              if (active) setState('retryable')
              return
            }
          } else {
            const saved = await getTailorClaimResume(token, sessionId)
            const verifiedEmail = saved?.email ?? (await getVerifiedClaimEmail(token))
            if (!verifiedEmail) {
              await clearTailorClaimResume()
              await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
              if (active)
                setMessage(
                  'Secure email progress was lost on this device. Request a new code to continue.'
                )
            } else {
              const nextStep = saved?.step === 'details' && saved.password ? 'details' : 'password'
              const resumed = await openClaimDetails(null, sessionId, nextStep, context)
              if (active && resumed) {
                setEmail(verifiedEmail)
                setPassword(saved?.password ?? '')
                setState('ready')
                return
              }
              if (active) setState('retryable')
              return
            }
          }
        } else if (
          context.serverError === 'CLAIM_SESSION_EXPIRED' ||
          context.serverError === 'UNAVAILABLE'
        ) {
          await clearTailorClaimResume()
          await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
        } else {
          if (active) setState('retryable')
          return
        }
      }
      const result = await checkClaim(token)
      if (active) {
        setState(result.state)
        if (result.profile) setClaimProfile(result.profile)
        if (result.media) setClaimMedia(result.media)
        if (result.state === 'ready') setAccountStep('review')
      }
    })()
    return () => {
      active = false
    }
  }, [token, validToken, entryAttempt])

  async function retryClaim() {
    if (!validToken) return
    setState('checking')
    setEntryAttempt((attempt) => attempt + 1)
  }

  async function requestCode() {
    if (busy || resendSeconds > 0) return
    const normalizedEmail = email.trim().toLowerCase()
    if (!validToken || !EMAIL.test(normalizedEmail)) {
      setMessage('Enter the email address you want to use for this shop.')
      return
    }
    setBusy(true)
    setMessage(null)
    setCodeError('')
    const result = await invokeClaimAction({
      action: 'REQUEST_EMAIL_CODE',
      token,
      email: normalizedEmail,
    })
    setBusy(false)
    if (result.error || result.data?.sent !== true) {
      const [, detail] = claimActionFailureCopy(result)
      setMessage(detail)
      return
    }
    setEmail(normalizedEmail)
    setCode('')
    setResendSeconds(60)
    setAccountStep('code')
    setMessage('Enter the six-digit code we sent. It expires in 10 minutes.')
  }

  async function bootstrapEmailSession() {
    if (!validToken || !CODE.test(code)) {
      setCodeError('Enter the six-digit code from your email.')
      return
    }
    setBusy(true)
    setMessage(null)
    const verified = await invokeClaimAction({ action: 'VERIFY_EMAIL_CODE', token, email, code })
    if (verified.error || verified.data?.verified !== true) {
      setBusy(false)
      const [, detail] = claimActionFailureCopy(verified)
      setCodeError(detail)
      return
    }
    if (!(await saveVerifiedClaimEmail(token, email))) {
      setBusy(false)
      setCodeError('This device could not save your verified email securely. Try again.')
      return
    }
    const bootstrap = await invokeClaimAction({
      action: 'BOOTSTRAP_EMAIL_SESSION',
      token,
      email,
      code,
    })
    const session = bootstrap.data?.session
    if (
      bootstrap.error ||
      bootstrap.data?.bootstrapped !== true ||
      typeof session?.claimSessionId !== 'string' ||
      typeof session?.accessToken !== 'string' ||
      typeof session?.refreshToken !== 'string'
    ) {
      setBusy(false)
      const [, detail] = claimActionFailureCopy(bootstrap)
      if (bootstrap.serverError === 'CODE_EXPIRED' || bootstrap.serverError === 'INVALID_CODE') {
        setCodeError(detail)
      } else {
        setMessage(detail)
      }
      return
    }
    const installed = await supabase.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    })
    setBusy(false)
    if (installed.error || installed.data.user?.id == null) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
      const detail =
        'The secure claim session could not be installed on this device. Request a new code and sign in again.'
      setMessage(detail)
      return
    }
    await saveTailorClaimResume({
      token,
      sessionId: session.claimSessionId,
      email,
      step: 'password',
    })
    await openClaimDetails(null, session.claimSessionId, 'password')
  }

  async function connectProvider(provider: LinkedAuthProvider) {
    if (!validToken || busy) return
    setBusy(true)
    setMessage(null)
    const current = await supabase.auth.getSession()
    if (current.data.session) {
      setBusy(false)
      setMessage(
        'Sign out of the current Drapeon account, then reopen this private link. An existing account cannot take over this shop.'
      )
      return
    }

    const prepared = await invokeClaimAction({ action: 'PREPARE_PROVIDER_PROOF', token, provider })
    const proofId = prepared.data?.proofId
    const nonce = prepared.data?.nonce
    if (
      prepared.error ||
      prepared.data?.prepared !== true ||
      typeof proofId !== 'string' ||
      typeof nonce !== 'string'
    ) {
      setBusy(false)
      const [, detail] = claimActionFailureCopy(prepared)
      setMessage(detail)
      return
    }

    let idToken: string | null = null
    try {
      if (provider === 'apple') {
        if (Platform.OS !== 'ios') throw new Error('Apple sign-in requires an iPhone or iPad.')
        const AppleAuthentication = await import('expo-apple-authentication')
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
          nonce: sha256Hex(nonce),
        })
        idToken = credential.identityToken
      } else {
        const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID?.trim()
        if (!clientId) throw new Error('Google sign-in is not configured.')
        const request = new AuthSession.AuthRequest({
          clientId,
          scopes: ['openid', 'email', 'profile'],
          redirectUri: AuthSession.makeRedirectUri({ scheme: 'drape', path: 'claim/provider' }),
          responseType: AuthSession.ResponseType.IdToken,
          usePKCE: false,
          extraParams: { nonce: sha256Hex(nonce), prompt: 'select_account' },
        })
        const result = await request.promptAsync({
          authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        })
        idToken =
          result.type === 'success' && typeof result.params.id_token === 'string'
            ? result.params.id_token
            : null
      }
    } catch (error) {
      setBusy(false)
      setMessage(error instanceof Error ? error.message : 'Provider sign-in was cancelled.')
      return
    }
    if (!idToken) {
      setBusy(false)
      setMessage(`${provider === 'apple' ? 'Apple' : 'Google'} sign-in was cancelled.`)
      return
    }

    const bootstrap = await invokeClaimAction({
      action: 'SUBMIT_PROVIDER_PROOF',
      token,
      provider,
      proofId,
      nonce,
      idToken,
    })
    const session = bootstrap.data?.session
    if (bootstrap.serverError === 'ACCOUNT_CONFLICT') {
      setBusy(false)
      const [, detail] = claimFailureCopy('ACCOUNT_CONFLICT')
      setMessage(detail)
      return
    }
    if (
      bootstrap.error ||
      bootstrap.data?.bootstrapped !== true ||
      typeof session?.claimSessionId !== 'string' ||
      typeof session?.accessToken !== 'string' ||
      typeof session?.refreshToken !== 'string'
    ) {
      setBusy(false)
      const [, detail] = claimActionFailureCopy(bootstrap, undefined, provider)
      setMessage(detail)
      return
    }
    const installed = await supabase.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    })
    if (installed.error || installed.data.user?.app_metadata?.account_origin !== 'STAFF_DRAFT') {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
      setBusy(false)
      setMessage('The secure provider session could not be verified. Try again.')
      return
    }

    const linked = await supabase.auth.linkIdentity({ provider, token: idToken, nonce })
    if (linked.error) {
      const identities = await supabase.auth.getUserIdentities()
      const sameProviderIsPresent = identities.data?.identities.some(
        (identity) => identity.provider === provider
      )
      const identityAlreadyExists = linked.error.code === 'identity_already_exists'
      if (identityAlreadyExists && !sameProviderIsPresent) {
        await supabase.functions
          .invoke('tailor-claim-action', {
            body: { action: 'REPORT_PROVIDER_CONFLICT', token, provider },
          })
          .catch(() => null)
        await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
        setBusy(false)
        setMessage(
          'That provider already belongs to another Drapeon account. Choose a different account or use email.'
        )
        return
      }
      if (!sameProviderIsPresent) {
        await supabase.functions
          .invoke('tailor-claim-action', {
            body: { action: 'FAIL_PROVIDER_SESSION', token, provider },
          })
          .catch(() => null)
        await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
        setBusy(false)
        setMessage('The provider could not be connected. Check your connection and try again.')
        return
      }
    }
    const proof = await invokeClaimAction({ action: 'VERIFY_LINKED_PROVIDER', token, provider })
    setBusy(false)
    if (proof.error || proof.data?.verified !== true || proof.data?.provider !== provider) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
      const [, detail] = claimActionFailureCopy(proof, 'PROVIDER_IDENTITY_MISMATCH')
      setMessage(detail)
      return
    }
    await openClaimDetails(provider, session.claimSessionId)
  }

  async function claimShop() {
    if (!validToken || busy || !claimSessionId) return
    if (!consentAccepted) {
      const consentMessage = 'Confirm that Drapeon may publish the listed photos and videos.'
      setMessage(consentMessage)
      return
    }
    setBusy(true)
    setMessage(null)
    const pickupAddress = [addressLine1, addressLine2, city, region, postalCode, countryCode]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ')
    const result = await invokeClaimAction({
      action: 'CLAIM',
      token,
      idempotencyKey: `tailor-claim:${claimSessionId}`,
      email: linkedProvider ? undefined : email,
      password: linkedProvider ? undefined : password,
      phone,
      pickupAddress,
      pickupAddressLine1: [addressLine1, addressLine2].filter(Boolean).join(', '),
      pickupCity: city,
      pickupRegion: region,
      pickupPostalCode: postalCode,
      pickupCountryCode: countryCode,
      consentAccepted: true,
      consentTextVersion,
      consentMediaManifest: claimMedia.map((item) => item.id),
    })
    if (result.error || result.data?.claimed !== true) {
      setBusy(false)
      const [, failureMessage] = claimActionFailureCopy(result)
      setMessage(failureMessage)
      if (result.data?.recovery === 'CORRECT_PHONE') setAccountStep('phone-recovery')
      return
    }
    await clearPendingTailorClaim()
    await clearTailorClaimResume()
    const refreshed = await supabase.auth.refreshSession().catch(() => null)
    setBusy(false)
    if (refreshed?.data?.session?.user.app_metadata?.account_origin === 'CLAIMED') {
      router.replace('/(tailor)/profile/setup')
      return
    }
    setAccountStep('complete')
    setMessage('Your shop is yours. Continue with the sign-in you just confirmed to finish setup.')
  }

  function openProfileEditor(section: Exclude<EditSection, null>) {
    if (!claimProfile) return
    setEditDraft({
      ...claimProfile,
      languages: [...(claimProfile.languages ?? [])],
      specialties: [...(claimProfile.specialties ?? [])],
    })
    setEditError('')
    setEditSection(section)
  }

  async function saveProfileEdits() {
    if (!validToken || !editDraft || busy) return
    setBusy(true)
    setEditError('')
    const result = await invokeClaimAction({
      action: 'UPDATE_CLAIM_PROFILE',
      token,
      displayName: editDraft.displayName,
      businessName: editDraft.businessName,
      bio: editDraft.bio,
      location: editDraft.location,
      languages: editDraft.languages,
      specialties: editDraft.specialties,
      currency: editDraft.currency,
      priceMin: editDraft.priceMin,
      priceMax: editDraft.priceMax,
    })
    setBusy(false)
    if (result.error || result.data?.updated !== true) {
      setEditError(
        typeof result.data?.detail === 'string'
          ? result.data.detail
          : 'Your changes could not be saved. Check the fields and try again.'
      )
      return
    }
    setClaimProfile(editDraft)
    setEditSection(null)
    setMessage('Shop details saved.')
  }

  function confirmRemoveMedia(item: ClaimMedia) {
    const approvedPhotoCount = claimMedia.filter((media) => media.kind === 'PHOTO').length
    const blockedReason =
      item.kind === 'AVATAR'
        ? 'Your shop needs a profile photo before it can go live.'
        : item.cover
          ? 'Choose a different cover before removing this photo.'
          : item.kind === 'PHOTO' && approvedPhotoCount <= 1
            ? 'Your shop needs at least one approved portfolio photo.'
            : null
    if (blockedReason) {
      setMediaError(blockedReason)
      return
    }
    Alert.alert('Remove this media?', `${item.label} will not appear on your public shop.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeMedia(item.id) },
    ])
  }

  async function removeMedia(mediaId: string) {
    if (!validToken || busy) return
    setBusy(true)
    setMediaError('')
    const result = await invokeClaimAction({ action: 'REMOVE_CLAIM_MEDIA', token, mediaId })
    setBusy(false)
    if (result.error || result.data?.removed !== true) {
      const detail =
        (result.serverError ?? result.data?.error) === 'AVATAR_REQUIRED'
          ? 'Your shop needs a profile photo before it can go live.'
          : (result.serverError ?? result.data?.error) === 'COVER_REQUIRED'
            ? 'Choose a different cover before removing this photo.'
            : (result.serverError ?? result.data?.error) === 'PHOTO_REQUIRED'
              ? 'Your shop needs at least one approved portfolio photo.'
              : 'This media could not be removed. Try again.'
      setMediaError(detail)
      return
    }
    setClaimMedia((current) => current.filter((item) => item.id !== mediaId))
    setConsentAccepted(false)
    setMessage('Media removed. Review the remaining work and confirm consent again.')
  }

  function continueToClaimedAccountSignIn() {
    router.replace({ pathname: '/(auth)/sign-in', params: { intent: 'TAILOR' } })
  }

  async function retryClaimWithPhone() {
    if (!validToken || busy) return
    const correctedPhone = phone.trim()
    if (!correctedPhone) {
      const [, detail] = claimFailureCopy('INVALID_PHONE')
      setMessage(detail)
      return
    }
    setBusy(true)
    setMessage(null)
    const result = await invokeClaimAction({ action: 'CLAIM', token, phone: correctedPhone })
    setBusy(false)
    if (result.error || result.data?.claimed !== true) {
      const [, detail] = claimActionFailureCopy(result)
      setMessage(detail)
      return
    }
    setAccountStep('complete')
    setMessage(
      'Your corrected phone was saved and your shop is now yours. Continue to verify it and go live.'
    )
  }

  const title =
    state === 'ready'
      ? accountStep === 'review'
        ? 'This is your shop. Make it yours.'
        : accountStep === 'details'
          ? 'Review and claim your shop.'
          : accountStep === 'password'
            ? 'Create your secure password.'
            : accountStep === 'phone-recovery'
              ? 'Use a different phone number.'
              : accountStep === 'complete'
                ? 'Your shop is claimed.'
                : 'Secure your shop account.'
      : state === 'checking'
        ? 'Checking your private claim…'
        : state === 'retryable'
          ? 'We could not check your link.'
          : 'This claim link is not available.'
  const body =
    state === 'ready'
      ? accountStep === 'review'
        ? 'Review the storefront Drapeon prepared from your work. You can edit every detail after securing the account.'
        : accountStep === 'email'
          ? 'Start with an email code. This does not create a second Drapeon account.'
          : accountStep === 'code'
            ? `We sent a code to ${email}.`
            : accountStep === 'password'
              ? 'Your email is verified. Create the password you will use to sign in to Drapeon.'
              : accountStep === 'provider'
                ? 'Choose the Apple account you want to use with this shop.'
                : accountStep === 'details'
                  ? 'Add your contact details and approve the photos and videos prepared for your shop.'
                  : accountStep === 'phone-recovery'
                    ? 'Your sign-in is secure. Change only the phone number to safely finish the interrupted claim.'
                    : 'Continue to verify your phone and finish making the shop live.'
      : state === 'retryable'
        ? 'Your connection may have been interrupted. Try checking the same private link again.'
        : state === 'unavailable'
          ? 'Return to the private link Drapeon sent you and try again.'
          : 'This takes only a moment.'
  const claimDisabledReason =
    accountStep !== 'details'
      ? null
      : !claimProfile
        ? 'Your shop details are still loading.'
        : claimMedia.filter((item) => item.kind === 'AVATAR').length < 1
          ? 'Keep one profile photo to continue.'
          : claimMedia.filter((item) => item.kind === 'PHOTO').length < 1
            ? 'Keep one approved portfolio photo to continue.'
            : !phone.trim()
              ? 'Add your phone number to continue.'
              : !addressLine1.trim()
                ? 'Add your pickup street address to continue.'
                : !city.trim()
                  ? 'Add your pickup city to continue.'
                  : !region.trim()
                    ? 'Add your state or region to continue.'
                    : postcodeRequired(countryCode) && !postalCode.trim()
                      ? 'Add your postal code to continue.'
                      : countryCode.trim().length !== 2
                        ? 'Choose your pickup country to continue.'
                        : !consentAccepted
                          ? 'Confirm that the listed work is yours to continue.'
                          : null
  const passwordDisabledReason =
    accountStep === 'password' && password.length < 10
      ? 'Create a password with at least 10 characters to continue.'
      : null

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.card}
          keyboardShouldPersistTaps="handled"
          onScroll={claimScroll.onScroll}
          scrollEventThrottle={claimScroll.scrollEventThrottle}
        >
          {state === 'ready' ? (
            <View style={styles.stepHeader}>
              <Text style={styles.stepText}>
                {accountStep === 'review'
                  ? 'Step 1 of 5 · Review shop'
                  : ['email', 'code', 'password', 'provider'].includes(accountStep)
                    ? 'Step 2 of 5 · Sign in'
                    : accountStep === 'details' || accountStep === 'phone-recovery'
                      ? 'Step 3 of 5 · Contact & pickup'
                      : 'Step 4 of 5 · Verify phone'}
              </Text>
              <View style={styles.stepTrack}>
                <View
                  style={[
                    styles.stepProgress,
                    {
                      width:
                        accountStep === 'review'
                          ? '20%'
                          : ['email', 'code', 'password', 'provider'].includes(accountStep)
                            ? '40%'
                            : accountStep === 'details' || accountStep === 'phone-recovery'
                              ? '60%'
                              : '80%',
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}
          <Text style={styles.eyebrow}>YOUR DRAPEON SHOP</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          {state === 'checking' ? <ActivityIndicator color={Colors.needleGreen} /> : null}
          {state === 'ready' && accountStep === 'review' ? (
            <View style={styles.storefrontPreview}>
              {claimMedia.find((item) => item.cover && item.previewUrl)?.previewUrl ? (
                <Image
                  source={{ uri: claimMedia.find((item) => item.cover)?.previewUrl ?? '' }}
                  style={styles.heroImage}
                />
              ) : null}
              <View style={styles.previewIdentity}>
                {claimMedia.find((item) => item.kind === 'AVATAR')?.previewUrl ? (
                  <Image
                    source={{
                      uri: claimMedia.find((item) => item.kind === 'AVATAR')?.previewUrl ?? '',
                    }}
                    style={styles.previewAvatar}
                  />
                ) : null}
                <View style={styles.previewIdentityText}>
                  <Text style={styles.reviewTitle}>{claimProfile?.displayName ?? 'Your shop'}</Text>
                  <Text style={styles.reviewMeta}>{claimProfile?.location ?? 'Your location'}</Text>
                </View>
              </View>
              {claimProfile?.bio ? <Text style={styles.reviewBody}>{claimProfile.bio}</Text> : null}
              <View style={styles.previewPortfolio}>
                {claimMedia
                  .filter((item) => item.kind !== 'AVATAR')
                  .slice(0, 3)
                  .map((item) =>
                    item.previewUrl && item.kind !== 'VIDEO' ? (
                      <Image
                        key={item.id}
                        source={{ uri: item.previewUrl }}
                        style={styles.previewPortfolioImage}
                      />
                    ) : item.kind === 'VIDEO' ? (
                      <View
                        key={item.id}
                        style={[styles.previewPortfolioImage, styles.videoPreview]}
                      >
                        <Feather name="play" size={24} color={Colors.needleGreen} />
                        <Text style={styles.videoPreviewLabel}>Video</Text>
                      </View>
                    ) : null
                  )}
              </View>
              <Text style={styles.privacyNote}>
                Private link · Only people with this link can review this shop before it goes live.
              </Text>
              <View style={styles.reviewCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionEyebrow}>ABOUT</Text>
                </View>
                <Text style={styles.reviewTitle}>{claimProfile?.displayName ?? 'Your shop'}</Text>
                {claimProfile?.location ? (
                  <Text style={styles.reviewMeta}>{claimProfile.location}</Text>
                ) : null}
                {claimProfile?.bio ? (
                  <Text style={styles.reviewBody}>{claimProfile.bio}</Text>
                ) : null}
              </View>
              <View style={styles.reviewCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionEyebrow}>SPECIALTIES</Text>
                </View>
                <Text style={styles.reviewBody}>
                  {(claimProfile?.specialties ?? []).join(' · ') || 'Add at least one specialty'}
                </Text>
              </View>
              <View style={styles.reviewCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionEyebrow}>PRICES</Text>
                </View>
                <Text style={styles.reviewMeta}>
                  {claimProfile?.currency ?? ''} {claimProfile?.priceMin ?? '—'}–
                  {claimProfile?.priceMax ?? '—'}
                </Text>
              </View>
              <Text style={styles.privacyNote}>
                You can review and edit these details after sign-in.
              </Text>
              <TouchableOpacity
                accessibilityRole="link"
                onPress={() =>
                  void Linking.openURL(
                    'mailto:support@drapeon.co?subject=This%20is%20not%20my%20shop'
                  )
                }
              >
                <Text style={styles.notYourShop}>Not your shop? Contact us</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {state === 'ready' && accountStep === 'email' ? (
            <>
              <Input
                appearance={scheme}
                label="Email address"
                required
                accessibilityLabel="Claim email"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
                returnKeyType="send"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={() => void requestCode()}
              />
              {GOOGLE_CLAIM_ENABLED || Platform.OS === 'ios' ? (
                <Text style={styles.orText}>or continue another way</Text>
              ) : null}
              {GOOGLE_CLAIM_ENABLED || Platform.OS === 'ios' ? (
                <View style={styles.providerList}>
                  {GOOGLE_CLAIM_ENABLED ? (
                    <ProviderButton
                      label="Continue with Google"
                      disabled={busy}
                      onPress={() => void connectProvider('google')}
                    />
                  ) : null}
                  {Platform.OS === 'ios' ? (
                    <ProviderButton
                      label="Continue with Apple"
                      disabled={busy}
                      onPress={() => void connectProvider('apple')}
                    />
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
          {state === 'ready' && accountStep === 'code' ? (
            <>
              <Input
                appearance={scheme}
                label="Six-digit email code"
                error={codeError}
                onClearError={() => setCodeError('')}
                required
                accessibilityLabel="Six-digit claim code"
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
                returnKeyType="done"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                value={code}
                onChangeText={(value) => {
                  setCode(value.replace(/\D/gu, ''))
                  setCodeError('')
                }}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Send a new claim code"
                disabled={busy || resendSeconds > 0}
                onPress={() => void requestCode()}
              >
                <Text style={styles.termsLink}>
                  {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.noticeText}>Still waiting? Check your spam or junk folder.</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Use a different claim email"
                style={styles.emailChange}
                onPress={() => {
                  setCode('')
                  setCodeError('')
                  setMessage(null)
                  setAccountStep('email')
                }}
              >
                <Text style={styles.termsLink}>Use a different email</Text>
              </TouchableOpacity>
            </>
          ) : null}
          {state === 'ready' && accountStep === 'password' ? (
            <View style={styles.fieldStack}>
              <Input
                appearance={scheme}
                label="Create password"
                required
                accessibilityLabel="Claim account password"
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                secureTextEntry
                placeholder="Create a secure password"
                value={password}
                onChangeText={setPassword}
                hint={password.length >= 10 ? '✓ 10+ characters' : '10+ characters'}
              />
            </View>
          ) : null}
          {state === 'ready' && accountStep === 'provider' ? (
            <View style={styles.providerList}>
              {GOOGLE_CLAIM_ENABLED ? (
                <ProviderButton
                  label="Continue with Google"
                  disabled={busy}
                  onPress={() => void connectProvider('google')}
                />
              ) : null}
              {Platform.OS === 'ios' ? (
                <ProviderButton
                  label="Continue with Apple"
                  disabled={busy}
                  onPress={() => void connectProvider('apple')}
                />
              ) : null}
            </View>
          ) : null}
          {state === 'ready' && accountStep === 'details' ? (
            <>
              <View style={styles.reviewCard}>
                <Text style={styles.sectionTitle}>Review & edit your shop</Text>
                <Text style={styles.reviewBody}>Make any changes before you claim it.</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => openProfileEditor('about')}
                >
                  <Text style={styles.editLink}>Edit name, location and bio</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => openProfileEditor('specialties')}
                >
                  <Text style={styles.editLink}>Edit specialties</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => openProfileEditor('prices')}
                >
                  <Text style={styles.editLink}>Edit prices</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionTitle}>Contact and pickup</Text>
              <PhoneNumberInput
                appearance={scheme}
                label="Phone number"
                required
                defaultCountryCode={countryCode as PhoneCountryCode}
                returnKeyType="next"
                placeholder="Mobile number"
                value={phone}
                onChangeText={setPhone}
              />
              {!manualAddress && !addressConfirmed ? (
                <View style={styles.fieldStack}>
                  <AddressAutocompleteInput
                    appearance={scheme}
                    label="Pickup address"
                    required
                    countryCode={countryCode}
                    value={addressLine1}
                    placeholder="Search your street address"
                    hint="Search OpenStreetMap or enter the address manually."
                    returnKeyType="search"
                    onChangeText={setAddressLine1}
                    onBlurWithoutSuggestions={() => setManualAddress(true)}
                    onSubmitEditing={() => setManualAddress(true)}
                    onManualFallback={() => setManualAddress(true)}
                    onSelectAddress={(address) => {
                      setAddressLine1(address.line1 || address.displayValue)
                      setCity(address.city)
                      setRegion(address.stateRegion)
                      setPostalCode(address.postcode)
                      if (address.countryCode) setCountryCode(address.countryCode.toUpperCase())
                      setAddressConfirmed(true)
                      setManualAddress(false)
                      if (
                        !address.city.trim() ||
                        !address.stateRegion.trim() ||
                        (postcodeRequired(address.countryCode || countryCode) &&
                          !address.postcode.trim())
                      ) {
                        setManualAddress(true)
                      }
                    }}
                  />
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => setManualAddress(true)}
                  >
                    <Text style={styles.termsLink}>Enter manually</Text>
                  </TouchableOpacity>
                </View>
              ) : addressConfirmed && !manualAddress ? (
                <View style={styles.addressConfirmation}>
                  <View style={styles.addressConfirmationCopy}>
                    <Text style={styles.noticeTitle}>Confirm your address</Text>
                    <Text style={styles.noticeText}>
                      {[addressLine1, addressLine2, city, region, postalCode, countryCode]
                        .filter(Boolean)
                        .join(', ')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => setManualAddress(true)}
                  >
                    <Text style={styles.editLink}>Edit</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {manualAddress ? (
                <View style={styles.fieldStack}>
                  <Input
                    appearance={scheme}
                    label="Street address"
                    required
                    returnKeyType="next"
                    value={addressLine1}
                    onChangeText={setAddressLine1}
                  />
                  <Input
                    appearance={scheme}
                    label="Apartment / unit (optional)"
                    returnKeyType="next"
                    value={addressLine2}
                    onChangeText={setAddressLine2}
                  />
                  <Input
                    appearance={scheme}
                    label="City"
                    required
                    returnKeyType="next"
                    textContentType="addressCity"
                    autoComplete="postal-address-locality"
                    value={city}
                    onChangeText={setCity}
                  />
                  <Input
                    appearance={scheme}
                    label="State / region"
                    required
                    returnKeyType="next"
                    textContentType="addressState"
                    autoComplete="postal-address-region"
                    value={region}
                    onChangeText={setRegion}
                  />
                  <Input
                    appearance={scheme}
                    label={`Postal code${postcodeRequired(countryCode) ? '' : ' (optional)'}`}
                    required={postcodeRequired(countryCode)}
                    returnKeyType="next"
                    textContentType="postalCode"
                    autoComplete="postal-code"
                    value={postalCode}
                    onChangeText={setPostalCode}
                  />
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Choose pickup country"
                    activeOpacity={0.8}
                    onPress={() => setCountryPickerVisible(true)}
                  >
                    <Input
                      appearance={scheme}
                      label="Country"
                      required
                      editable={false}
                      pointerEvents="none"
                      value={`${getPhoneCountryOption(countryCode as PhoneCountryCode).flag} ${getPhoneCountryOption(countryCode as PhoneCountryCode).name}`}
                      rightElement={<Text style={styles.editLink}>Choose</Text>}
                    />
                  </TouchableOpacity>
                </View>
              ) : null}
              {addressConfirmed && !manualAddress ? (
                <Input
                  appearance={scheme}
                  label="Apartment / unit (optional)"
                  returnKeyType="done"
                  value={addressLine2}
                  onChangeText={setAddressLine2}
                />
              ) : null}
              <View style={styles.mediaConsent}>
                <Text style={styles.noticeTitle}>Photos and videos Drapeon will publish</Text>
                <View style={styles.consentRow}>
                  <TouchableOpacity
                    accessibilityRole="checkbox"
                    accessibilityLabel="Consent to imported media"
                    accessibilityState={{ checked: consentAccepted }}
                    onPress={() => setConsentAccepted((current) => !current)}
                  >
                    <Feather
                      name={consentAccepted ? 'check-square' : 'square'}
                      size={26}
                      color={Colors.needleGreen}
                    />
                  </TouchableOpacity>
                  <Text style={styles.consentText}>
                    These photos are my work and I&apos;m happy for Drapeon to show them.{' '}
                    <Text
                      style={styles.termsLink}
                      onPress={() => {
                        void Linking.openURL('https://drapeon.co/terms')
                      }}
                    >
                      Full terms
                    </Text>
                  </Text>
                </View>
                <View style={styles.mediaGrid}>
                  {claimMedia.map((item) => (
                    <View key={item.id} style={styles.mediaTile}>
                      {item.previewUrl && item.kind !== 'VIDEO' ? (
                        <Image source={{ uri: item.previewUrl }} style={styles.mediaImage} />
                      ) : (
                        <View style={styles.mediaPlaceholder}>
                          <Text style={styles.mediaPlaceholderText}>
                            {item.kind === 'VIDEO' ? 'VIDEO' : 'PHOTO'}
                          </Text>
                        </View>
                      )}
                      <Text numberOfLines={2} style={styles.mediaItem}>
                        {item.label}
                        {item.cover ? ' · Cover' : ''}
                      </Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.label}`}
                        style={styles.mediaRemove}
                        onPress={() => confirmRemoveMedia(item)}
                      >
                        <Text style={styles.mediaRemoveText}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
                {mediaError ? <Text style={styles.inlineError}>{mediaError}</Text> : null}
              </View>
            </>
          ) : null}
          {state === 'ready' && accountStep === 'phone-recovery' ? (
            <PhoneNumberInput
              appearance={scheme}
              label="Different phone number"
              required
              defaultCountryCode={countryCode as PhoneCountryCode}
              value={phone}
              onChangeText={setPhone}
            />
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {claimDisabledReason ? (
            <Text style={styles.inlineError}>{claimDisabledReason}</Text>
          ) : null}
          {passwordDisabledReason ? (
            <Text style={styles.inlineError}>{passwordDisabledReason}</Text>
          ) : null}
          {busy ? <ActivityIndicator color={Colors.needleGreen} /> : null}
          {state === 'ready' && accountStep !== 'review' ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Private claim</Text>
              <Text style={styles.noticeText}>
                Nothing changes until you confirm the final claim.
              </Text>
            </View>
          ) : null}
          {state === 'ready' && accountStep === 'details' ? (
            <Text style={styles.nextStepHint}>Next: verify your phone to go live.</Text>
          ) : null}
        </ScrollView>
        {state === 'retryable' ? (
          <ClaimActionDock
            label="Try again"
            icon="refresh-cw"
            testID="claim-retry-action-dock"
            onPress={() => void retryClaim()}
          />
        ) : state === 'ready' && accountStep === 'review' ? (
          <ClaimActionDock
            label="Make it mine"
            icon="arrow-right"
            testID="claim-review-action-dock"
            onPress={() => setAccountStep('email')}
          />
        ) : state === 'ready' && accountStep === 'email' ? (
          <ClaimActionDock
            label="Send email code"
            icon="mail"
            testID="claim-email-action-dock"
            disabled={busy}
            onPress={() => void requestCode()}
          />
        ) : state === 'ready' && accountStep === 'code' ? (
          <ClaimActionDock
            label="Verify and continue"
            icon="arrow-right"
            testID="claim-code-action-dock"
            disabled={busy}
            onPress={() => void bootstrapEmailSession()}
          />
        ) : state === 'ready' && accountStep === 'password' ? (
          <ClaimActionDock
            label="Continue to contact details"
            icon="arrow-right"
            testID="claim-password-action-dock"
            disabled={busy || password.length < 10}
            onPress={() => {
              if (!validToken || !claimSessionId) return
              void saveTailorClaimResume({
                token,
                sessionId: claimSessionId,
                email,
                password,
                step: 'details',
              }).then((saved) => {
                if (saved) setAccountStep('details')
                else setMessage('Secure progress could not be saved on this device. Try again.')
              })
            }}
          />
        ) : state === 'ready' && accountStep === 'details' ? (
          <ClaimActionDock
            label="Claim and continue"
            icon="arrow-right"
            testID="claim-final-action-dock"
            disabled={busy || !!claimDisabledReason}
            onPress={() => void claimShop()}
          />
        ) : state === 'ready' && accountStep === 'phone-recovery' ? (
          <ClaimActionDock
            label="Use a different number"
            icon="phone"
            testID="claim-phone-recovery-action-dock"
            disabled={busy}
            onPress={() => void retryClaimWithPhone()}
          />
        ) : state === 'ready' && accountStep === 'complete' ? (
          <ClaimActionDock
            label={
              linkedProvider === 'apple' ? 'Sign in with Apple to finish' : 'Sign in to finish'
            }
            icon="log-in"
            testID="claim-complete-action-dock"
            onPress={continueToClaimedAccountSignIn}
          />
        ) : null}
      </SafeAreaView>
      <BottomSheetScaffold
        visible={editSection !== null}
        title={
          editSection === 'about'
            ? 'Edit about'
            : editSection === 'specialties'
              ? 'Edit specialties'
              : 'Edit prices'
        }
        subtitle="These changes will appear on your public shop."
        onDismiss={() => setEditSection(null)}
        scrollable
        primaryAction={{
          label: 'Save changes',
          onPress: () => void saveProfileEdits(),
          loading: busy,
        }}
      >
        {editSection === 'about' && editDraft ? (
          <View style={styles.sheetFields}>
            <TextInput
              accessibilityLabel="Shop name"
              placeholder="Shop name"
              style={styles.input}
              value={editDraft.displayName ?? ''}
              onChangeText={(value) => setEditDraft({ ...editDraft, displayName: value })}
            />
            <Input
              label="Public location"
              placeholder="City, country"
              value={editDraft.location ?? ''}
              onChangeText={(value) => {
                setEditDraft({ ...editDraft, location: value })
                setLocationQuery(value)
              }}
              autoCorrect={false}
              autoComplete="off"
            />
            {locationSuggestions.length > 0 ? (
              <View style={styles.locationSuggestions}>
                {locationSuggestions.map((suggestion) => (
                  <TouchableOpacity
                    key={suggestion}
                    style={styles.locationSuggestion}
                    accessibilityRole="button"
                    accessibilityLabel={`Use location ${suggestion}`}
                    onPress={() => {
                      setEditDraft({ ...editDraft, location: suggestion })
                      setLocationQuery('')
                      setLocationSuggestions([])
                    }}
                  >
                    <Text style={{ color: palette.ink }}>{suggestion}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <TextInput
              accessibilityLabel="Shop bio"
              multiline
              placeholder="Tell customers about your work"
              style={[styles.input, styles.bioInput]}
              value={editDraft.bio ?? ''}
              onChangeText={(value) => setEditDraft({ ...editDraft, bio: value })}
            />
            <TextInput
              accessibilityLabel="Languages"
              placeholder="English, Yoruba"
              style={styles.input}
              value={(editDraft.languages ?? []).join(', ')}
              onChangeText={(value) =>
                setEditDraft({
                  ...editDraft,
                  languages: value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
            />
          </View>
        ) : null}
        {editSection === 'specialties' && editDraft ? (
          <TouchableOpacity
            style={styles.input}
            accessibilityRole="button"
            accessibilityLabel="Choose specialties"
            onPress={() => setEditPicker('specialties')}
          >
            <Text style={{ color: palette.ink }}>
              {editDraft.specialties?.length
                ? editDraft.specialties.join(', ')
                : 'Choose specialties'}
            </Text>
          </TouchableOpacity>
        ) : null}
        {editSection === 'prices' && editDraft ? (
          <View style={styles.sheetFields}>
            <TouchableOpacity
              style={styles.input}
              accessibilityRole="button"
              accessibilityLabel="Choose currency"
              onPress={() => setEditPicker('currency')}
            >
              <Text style={{ color: palette.ink }}>{editDraft.currency || 'Choose currency'}</Text>
            </TouchableOpacity>
            <TextInput
              accessibilityLabel="Minimum price"
              keyboardType="number-pad"
              placeholder="Minimum price"
              style={styles.input}
              value={editDraft.priceMin == null ? '' : String(editDraft.priceMin)}
              onChangeText={(value) =>
                setEditDraft({
                  ...editDraft,
                  priceMin:
                    value.replace(/\D/gu, '') === '' ? null : Number(value.replace(/\D/gu, '')),
                })
              }
            />
            <TextInput
              accessibilityLabel="Maximum price"
              keyboardType="number-pad"
              placeholder="Maximum price"
              style={styles.input}
              value={editDraft.priceMax == null ? '' : String(editDraft.priceMax)}
              onChangeText={(value) =>
                setEditDraft({
                  ...editDraft,
                  priceMax:
                    value.replace(/\D/gu, '') === '' ? null : Number(value.replace(/\D/gu, '')),
                })
              }
            />
          </View>
        ) : null}
        {editError ? <Text style={styles.inlineError}>{editError}</Text> : null}
      </BottomSheetScaffold>
      <ChoiceSheet
        appearance={scheme}
        visible={countryPickerVisible}
        title="Choose pickup country"
        subtitle="Choose the country where customers' orders are picked up."
        sheetHeight="78%"
        searchable
        searchPlaceholder="Search pickup countries"
        options={PHONE_COUNTRIES.map((country) => ({
          value: country.code,
          title: `${country.flag} ${country.name}`,
          meta: country.code,
        }))}
        selectedValue={countryCode}
        onClose={() => setCountryPickerVisible(false)}
        onSelect={(value) => {
          setCountryCode(value)
          setCountryPickerVisible(false)
        }}
      />
      <ChoiceSheet
        appearance={scheme}
        visible={editPicker !== null}
        title={editPicker === 'specialties' ? 'Choose specialties' : 'Choose currency'}
        options={
          editPicker === 'specialties'
            ? [...new Set(TAILOR_SPECIALTY_GROUPS.flatMap((group) => group.items))].map((item) => ({
                value: item,
                title: item,
              }))
            : SUPPORTED_ACCOUNT_CURRENCIES.map((currency) => ({ value: currency, title: currency }))
        }
        selectedValue={editPicker === 'currency' ? editDraft?.currency : null}
        selectedValues={editPicker === 'specialties' ? (editDraft?.specialties ?? []) : []}
        multiple={editPicker === 'specialties'}
        searchable={editPicker === 'specialties'}
        sheetHeight="78%"
        onClose={() => setEditPicker(null)}
        onDone={() => setEditPicker(null)}
        onSelect={(value) => {
          if (!editDraft) return
          if (editPicker === 'specialties') {
            const selected = editDraft.specialties ?? []
            setEditDraft({
              ...editDraft,
              specialties: selected.includes(value)
                ? selected.filter((item) => item !== value)
                : [...selected, value],
            })
          } else {
            setEditDraft({ ...editDraft, currency: value })
            setEditPicker(null)
          }
        }}
      />
    </>
  )
}

function ClaimActionDock({
  label,
  icon,
  testID,
  disabled = false,
  onPress,
}: {
  label: string
  icon: ComponentProps<typeof DrapeCapsuleButton>['icon']
  testID: string
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <DrapeFloatingActionDock compactWidth={76} testID={testID}>
      {(compact) =>
        compact ? (
          <DrapeIconButton
            icon={icon!}
            accessibilityLabel={label}
            tone="primary"
            disabled={disabled}
            onPress={onPress}
          />
        ) : (
          <DrapeCapsuleButton
            label={label}
            icon={icon}
            style={styles.actionDockPrimary}
            disabled={disabled}
            onPress={onPress}
          />
        )
      }
    </DrapeFloatingActionDock>
  )
}

function ProviderButton({
  label,
  disabled,
  onPress,
}: {
  label: string
  disabled: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.providerButton, disabled && styles.disabled]}
    >
      <Text style={styles.providerButtonText}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = createClaimStyles(getDrapeColors('light'))

function createClaimStyles(palette: DrapeColorPalette) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: palette.bone },
    card: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: Spacing.xl,
      paddingBottom: DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
      gap: Spacing.md,
    },
    stepHeader: { gap: Spacing.xs },
    stepText: {
      color: palette.needleGreenDark,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
    },
    stepTrack: {
      height: 4,
      overflow: 'hidden',
      borderRadius: 2,
      backgroundColor: palette.lightGrey,
    },
    stepProgress: { height: '100%', borderRadius: 2, backgroundColor: palette.needleGreen },
    eyebrow: {
      color: palette.needleGreen,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
      letterSpacing: 1.6,
    },
    title: { color: palette.ink, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
    body: { color: palette.inkLight, fontSize: FontSize.md, lineHeight: 24 },
    input: {
      minHeight: 52,
      borderWidth: 1,
      borderColor: palette.lightGrey,
      borderRadius: Radius.md,
      backgroundColor: palette.white,
      color: palette.ink,
      fontSize: FontSize.md,
      paddingHorizontal: Spacing.md,
    },
    providerList: { gap: Spacing.sm },
    orText: { color: palette.midGrey, fontSize: FontSize.xs, textAlign: 'center' },
    providerButton: {
      minHeight: 50,
      borderRadius: Radius.full,
      backgroundColor: palette.ink,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.lg,
    },
    providerButtonText: {
      color: palette.textInverse,
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
    },
    disabled: { opacity: 0.55 },
    actionDockPrimary: { width: '100%', flexShrink: 1 },
    message: { color: palette.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
    notice: { marginTop: Spacing.md, backgroundColor: palette.white, padding: Spacing.lg },
    noticeTitle: { color: palette.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
    noticeText: {
      marginTop: Spacing.xs,
      color: palette.inkLight,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    nextStepHint: {
      marginTop: Spacing.md,
      color: palette.inkLight,
      fontSize: FontSize.xs,
      lineHeight: 18,
      textAlign: 'center',
    },
    mediaConsent: { gap: Spacing.sm, backgroundColor: palette.white, padding: Spacing.lg },
    sectionEyebrow: {
      color: palette.needleGreen,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
      letterSpacing: 1.2,
    },
    sectionTitle: { color: palette.ink, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
    fieldStack: { gap: Spacing.md },
    addressConfirmation: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.md,
      borderWidth: 1,
      borderColor: palette.lightGrey,
      borderRadius: Radius.lg,
      backgroundColor: palette.white,
      padding: Spacing.lg,
    },
    addressConfirmationCopy: { flex: 1 },
    reviewCard: {
      gap: Spacing.xs,
      borderRadius: Radius.lg,
      backgroundColor: palette.needleGreenLight,
      padding: Spacing.lg,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    editLink: {
      color: palette.needleGreenDark,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    reviewTitle: { color: palette.ink, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
    reviewMeta: {
      color: palette.needleGreenDark,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    reviewBody: { color: palette.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
    storefrontPreview: {
      overflow: 'hidden',
      gap: Spacing.md,
      borderRadius: Radius.lg,
      backgroundColor: palette.white,
      paddingBottom: Spacing.lg,
    },
    heroImage: { width: '100%', aspectRatio: 1.4, backgroundColor: palette.boneDeep },
    previewIdentity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.lg,
      marginTop: -34,
    },
    previewAvatar: {
      width: 74,
      height: 74,
      borderRadius: 37,
      borderWidth: 4,
      borderColor: palette.white,
      backgroundColor: palette.boneDeep,
    },
    previewIdentityText: { flex: 1, paddingTop: 34 },
    previewPortfolio: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.lg },
    previewPortfolioImage: {
      flex: 1,
      minWidth: 0,
      aspectRatio: 0.8,
      borderRadius: Radius.md,
      backgroundColor: palette.boneDeep,
    },
    videoPreview: { alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
    videoPreviewLabel: { color: palette.needleGreen, fontSize: FontSize.xs, fontWeight: '800' },
    privacyNote: {
      paddingHorizontal: Spacing.lg,
      color: palette.midGrey,
      fontSize: FontSize.xs,
      lineHeight: 18,
    },
    notYourShop: {
      paddingHorizontal: Spacing.lg,
      color: palette.needleGreen,
      fontSize: FontSize.sm,
      fontWeight: '800',
      textDecorationLine: 'underline',
    },
    mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    mediaTile: { width: '47%', gap: Spacing.xs },
    mediaRemove: {
      position: 'absolute',
      top: Spacing.xs,
      right: Spacing.xs,
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(20,20,18,0.78)',
    },
    mediaRemoveText: { color: palette.white, fontSize: 22, lineHeight: 24 },
    mediaImage: {
      width: '100%',
      aspectRatio: 0.8,
      borderRadius: Radius.md,
      backgroundColor: palette.bone,
    },
    mediaPlaceholder: {
      width: '100%',
      aspectRatio: 0.8,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.boneDeep,
    },
    mediaPlaceholderText: {
      color: palette.midGrey,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
    },
    mediaItem: { color: palette.inkLight, fontSize: FontSize.sm },
    consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
    consentText: { flex: 1, color: palette.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
    termsLink: {
      color: palette.needleGreenDark,
      fontWeight: FontWeight.semibold,
      textDecorationLine: 'underline',
    },
    emailChange: { alignSelf: 'flex-start', paddingVertical: Spacing.sm },
    inlineError: { color: palette.error, fontSize: FontSize.sm, lineHeight: 20 },
    sheetFields: { gap: Spacing.md },
    locationSuggestions: {
      borderWidth: 1,
      borderColor: palette.lightGrey,
      borderRadius: Radius.md,
      backgroundColor: palette.white,
    },
    locationSuggestion: {
      padding: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.lightGrey,
    },
    bioInput: { minHeight: 120, paddingTop: Spacing.md, textAlignVertical: 'top' },
  })
}
