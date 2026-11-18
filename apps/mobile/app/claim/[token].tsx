import { useEffect, useState, type ComponentProps } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import * as AuthSession from 'expo-auth-session'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BottomSheetScaffold } from '@/components/ui/BottomSheetScaffold'
import { clearPendingTailorClaim, savePendingTailorClaim } from '@/lib/pending-tailor-claim'
import { supabase } from '@/lib/supabase'
import { sha256Hex, type LinkedAuthProvider } from '@/lib/auth'
import {
  DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
} from '@/components/ui/DrapePrimitives'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

const CLAIM_TOKEN = /^[A-Za-z0-9_-]{40,60}$/u
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const CODE = /^\d{6}$/u
const GOOGLE_CLAIM_ENABLED = process.env.EXPO_PUBLIC_TAILOR_CLAIM_GOOGLE_ENABLED === 'true'
type ClaimState = 'checking' | 'ready' | 'unavailable' | 'retryable'
type AccountStep = 'review' | 'email' | 'code' | 'provider' | 'details' | 'phone-recovery' | 'complete'
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

function claimFailureCopy(error: unknown) {
  switch (error) {
    case 'INVALID_EMAIL':
      return [
        'Invalid email address',
        'Enter a complete email address, such as name@example.com.',
      ] as const
    case 'EMAIL_LOCKED':
      return [
        'Email codes locked',
        `Too many email-code requests or guesses were made for this link. Continue with Apple${GOOGLE_CLAIM_ENABLED ? ' or Google' : ''}, or ask Drapeon staff for a new link.`,
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
        'This shop is missing approved media or required staff review. Ask Drapeon staff to finish preparing it.',
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
        'This link expired, was revoked, or has already been used. Contact Drapeon staff for a new link.',
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
        'This interrupted claim cannot be resumed automatically. Contact Drapeon staff for help.',
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
        'The earlier sign-in was closed for safety. Try Apple sign-in again, or request a new six-digit email code to continue.',
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
        'Drapeon could not verify the prepared media. Contact Drapeon staff before trying again.',
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

async function checkClaim(token: string): Promise<{ state: ClaimState; profile?: ClaimProfile; media?: ClaimMedia[] }> {
  try {
    const { data, error } = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'RESOLVE', token },
    })
    if (error) return { state: 'retryable' }
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
  const claimScroll = useDrapeCapsuleNavScroll()
  const { token } = useLocalSearchParams<{ token?: string }>()
  const validToken = typeof token === 'string' && CLAIM_TOKEN.test(token)
  const [state, setState] = useState<ClaimState>(validToken ? 'checking' : 'unavailable')
  const [accountStep, setAccountStep] = useState<AccountStep>('review')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [linkedProvider, setLinkedProvider] = useState<LinkedAuthProvider | null>(null)
  const [claimMedia, setClaimMedia] = useState<ClaimMedia[]>([])
  const [claimProfile, setClaimProfile] = useState<ClaimProfile | null>(null)
  const [editSection, setEditSection] = useState<EditSection>(null)
  const [editDraft, setEditDraft] = useState<ClaimProfile | null>(null)
  const [editError, setEditError] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [consentTextVersion, setConsentTextVersion] = useState('')
  const [phone, setPhone] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('US')
  const [password, setPassword] = useState('')
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [claimSessionId, setClaimSessionId] = useState('')

  async function openClaimDetails(provider: LinkedAuthProvider | null, sessionId: string) {
    const context = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'GET_CLAIM_CONTEXT', token },
    })
    if (
      context.error ||
      context.data?.available !== true ||
      !Array.isArray(context.data?.media) ||
      !context.data?.profile ||
      typeof context.data?.consentTextVersion !== 'string'
    ) {
      const [title, detail] = context.error
        ? connectionFailureCopy()
        : claimFailureCopy(context.data?.error)
      setMessage(detail)
      Alert.alert(title, detail)
      return false
    }
    setLinkedProvider(provider)
    setClaimSessionId(sessionId)
    setClaimMedia(context.data.media as ClaimMedia[])
    setClaimProfile(context.data.profile as ClaimProfile)
    setConsentTextVersion(context.data.consentTextVersion)
    setAccountStep('details')
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
  }, [token, validToken])

  async function retryClaim() {
    if (!validToken) return
    setState('checking')
    const result = await checkClaim(token)
    setState(result.state)
    if (result.profile) setClaimProfile(result.profile)
    if (result.media) setClaimMedia(result.media)
    if (result.state === 'ready') setAccountStep('review')
  }

  async function requestCode() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!validToken || !EMAIL.test(normalizedEmail)) {
      setMessage('Enter the email address you want to use for this shop.')
      return
    }
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'REQUEST_EMAIL_CODE', token, email: normalizedEmail },
    })
    setBusy(false)
    if (error || data?.sent !== true) {
      const [title, detail] = error ? connectionFailureCopy() : claimFailureCopy(data?.error)
      setMessage(detail)
      Alert.alert(title, detail)
      return
    }
    setEmail(normalizedEmail)
    setAccountStep('code')
    setMessage('Enter the six-digit code we sent. It expires in 10 minutes.')
  }

  async function bootstrapEmailSession() {
    if (!validToken || !CODE.test(code)) {
      setMessage('Enter the six-digit code from your email.')
      return
    }
    setBusy(true)
    setMessage(null)
    const verified = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'VERIFY_EMAIL_CODE', token, email, code },
    })
    if (verified.error || verified.data?.verified !== true) {
      setBusy(false)
      const [title, detail] = verified.error
        ? connectionFailureCopy()
        : claimFailureCopy(verified.data?.error)
      setMessage(detail)
      Alert.alert(title, detail)
      return
    }
    const bootstrap = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'BOOTSTRAP_EMAIL_SESSION', token, email, code },
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
      const [title, detail] = bootstrap.error
        ? connectionFailureCopy()
        : claimFailureCopy(bootstrap.data?.error)
      setMessage(detail)
      Alert.alert(title, detail)
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
      Alert.alert('Secure session not installed', detail)
      return
    }
    await openClaimDetails(null, session.claimSessionId)
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

    const prepared = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'PREPARE_PROVIDER_PROOF', token, provider },
    })
    const proofId = prepared.data?.proofId
    const nonce = prepared.data?.nonce
    if (
      prepared.error ||
      prepared.data?.prepared !== true ||
      typeof proofId !== 'string' ||
      typeof nonce !== 'string'
    ) {
      setBusy(false)
      const [title, detail] = prepared.error
        ? connectionFailureCopy()
        : claimFailureCopy(prepared.data?.error)
      setMessage(detail)
      Alert.alert(title, detail)
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

    const bootstrap = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'SUBMIT_PROVIDER_PROOF', token, provider, proofId, nonce, idToken },
    })
    const session = bootstrap.data?.session
    if (bootstrap.data?.error === 'ACCOUNT_CONFLICT') {
      setBusy(false)
      const [title, detail] = claimFailureCopy('ACCOUNT_CONFLICT')
      setMessage(detail)
      Alert.alert(title, detail)
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
      const [title, detail] = bootstrap.error
        ? connectionFailureCopy()
        : claimFailureCopy(bootstrap.data?.error)
      setMessage(detail)
      Alert.alert(title, detail)
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
    const proof = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'VERIFY_LINKED_PROVIDER', token, provider },
    })
    setBusy(false)
    if (proof.error || proof.data?.verified !== true || proof.data?.provider !== provider) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
      const [title, detail] = proof.error
        ? connectionFailureCopy()
        : claimFailureCopy(proof.data?.error ?? 'PROVIDER_IDENTITY_MISMATCH')
      setMessage(detail)
      Alert.alert(title, detail)
      return
    }
    await openClaimDetails(provider, session.claimSessionId)
  }

  async function claimShop() {
    if (!validToken || busy || !claimSessionId) return
    if (!consentAccepted) {
      const consentMessage = 'Confirm that Drapeon may publish the listed photos and videos.'
      setMessage(consentMessage)
      Alert.alert('Consent required', consentMessage)
      return
    }
    setBusy(true)
    setMessage(null)
    const pickupAddress = [addressLine1, city, region, postalCode, countryCode]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ')
    const result = await supabase.functions.invoke('tailor-claim-action', {
      body: {
        action: 'CLAIM',
        token,
        idempotencyKey: `tailor-claim:${claimSessionId}`,
        email: linkedProvider ? undefined : email,
        password: linkedProvider ? undefined : password,
        phone,
        pickupAddress,
        pickupAddressLine1: addressLine1,
        pickupCity: city,
        pickupRegion: region,
        pickupPostalCode: postalCode,
        pickupCountryCode: countryCode,
        consentAccepted: true,
        consentTextVersion,
        consentMediaManifest: claimMedia.map((item) => item.id),
      },
    })
    if (result.error || result.data?.claimed !== true) {
      setBusy(false)
      const [failureTitle, failureMessage] = claimFailureCopy(result.data?.error)
      setMessage(failureMessage)
      if (result.data?.recovery === 'CORRECT_PHONE') setAccountStep('phone-recovery')
      Alert.alert(failureTitle, failureMessage)
      return
    }
    await clearPendingTailorClaim()
    await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
    setBusy(false)
    setAccountStep('complete')
    setMessage('Your shop is now yours. Sign in with the account you just confirmed to continue.')
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
    const result = await supabase.functions.invoke('tailor-claim-action', {
      body: {
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
      },
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
    const result = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'REMOVE_CLAIM_MEDIA', token, mediaId },
    })
    setBusy(false)
    if (result.error || result.data?.removed !== true) {
      const detail =
        result.data?.error === 'AVATAR_REQUIRED'
          ? 'Your shop needs a profile photo before it can go live.'
          : result.data?.error === 'COVER_REQUIRED'
            ? 'Choose a different cover before removing this photo.'
            : result.data?.error === 'PHOTO_REQUIRED'
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
      const [title, detail] = claimFailureCopy('INVALID_PHONE')
      setMessage(detail)
      Alert.alert(title, detail)
      return
    }
    setBusy(true)
    setMessage(null)
    const result = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'CLAIM', token, phone: correctedPhone },
    })
    setBusy(false)
    if (result.error || result.data?.claimed !== true) {
      const [title, detail] = result.error
        ? connectionFailureCopy()
        : claimFailureCopy(result.data?.error)
      setMessage(detail)
      Alert.alert(title, detail)
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
          : accountStep === 'provider'
            ? 'Choose the provider account that should open this staff-built shop.'
            : accountStep === 'details'
              ? 'Add your contact details and approve the exact media imported by Drapeon staff.'
              : accountStep === 'phone-recovery'
                ? 'Your sign-in is secure. Change only the phone number to safely finish the interrupted claim.'
                : 'Sign in again to verify your phone and finish making the shop live.'
      : state === 'retryable'
        ? 'Your connection may have been interrupted. Try checking the same private link again.'
        : state === 'unavailable'
          ? 'Return to the private link Drapeon staff sent you and try again.'
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
            : !consentAccepted
              ? 'Confirm that the listed work is yours to continue.'
              : !phone.trim() || !addressLine1.trim() || !city.trim() || !region.trim() || !postalCode.trim() || countryCode.trim().length !== 2
                ? 'Complete your phone and pickup address to continue.'
                : !linkedProvider && password.length < 10
                  ? 'Create a password with at least 10 characters.'
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
                  : ['email', 'code', 'provider'].includes(accountStep)
                    ? 'Step 2 of 5 · Sign in'
                    : accountStep === 'details' || accountStep === 'phone-recovery'
                      ? 'Step 3 of 5 · Contact & pickup'
                      : 'Step 4 of 5 · Verify phone'}
              </Text>
              <View style={styles.stepTrack}>
                <View style={[
                  styles.stepProgress,
                  { width: accountStep === 'review' ? '20%' : ['email', 'code', 'provider'].includes(accountStep) ? '40%' : accountStep === 'details' || accountStep === 'phone-recovery' ? '60%' : '80%' },
                ]} />
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
                <Image source={{ uri: claimMedia.find((item) => item.cover)?.previewUrl ?? '' }} style={styles.heroImage} />
              ) : null}
              <View style={styles.previewIdentity}>
                {claimMedia.find((item) => item.kind === 'AVATAR')?.previewUrl ? (
                  <Image source={{ uri: claimMedia.find((item) => item.kind === 'AVATAR')?.previewUrl ?? '' }} style={styles.previewAvatar} />
                ) : null}
                <View style={styles.previewIdentityText}>
                  <Text style={styles.reviewTitle}>{claimProfile?.displayName ?? 'Your shop'}</Text>
                  <Text style={styles.reviewMeta}>{claimProfile?.location ?? 'Your location'}</Text>
                </View>
              </View>
              {claimProfile?.bio ? <Text style={styles.reviewBody}>{claimProfile.bio}</Text> : null}
              <View style={styles.previewPortfolio}>
                {claimMedia.filter((item) => item.kind !== 'AVATAR').slice(0, 3).map((item) => item.previewUrl ? (
                  <Image key={item.id} source={{ uri: item.previewUrl }} style={styles.previewPortfolioImage} />
                ) : null)}
              </View>
              <Text style={styles.privacyNote}>Private link · Only people with this link can review this shop before it goes live.</Text>
            </View>
          ) : null}
          {state === 'ready' && accountStep === 'email' ? (
            <>
              <TextInput
                accessibilityLabel="Claim email"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor={Colors.midGrey}
                style={styles.input}
                value={email}
                onChangeText={setEmail}
              />
              <Text style={styles.orText}>or use a provider</Text>
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
            </>
          ) : null}
          {state === 'ready' && accountStep === 'code' ? (
            <TextInput
              accessibilityLabel="Six-digit claim code"
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={Colors.midGrey}
              style={styles.input}
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/gu, ''))}
            />
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
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionEyebrow}>ABOUT</Text>
                  <TouchableOpacity accessibilityRole="button" onPress={() => openProfileEditor('about')}>
                    <Text style={styles.editLink}>Edit</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.reviewTitle}>{claimProfile?.displayName ?? 'Your shop'}</Text>
                {claimProfile?.location ? (
                  <Text style={styles.reviewMeta}>{claimProfile.location}</Text>
                ) : null}
                {claimProfile?.bio ? <Text style={styles.reviewBody}>{claimProfile.bio}</Text> : null}
                {claimProfile?.priceMin != null && claimProfile?.priceMax != null ? (
                  <Text style={styles.reviewMeta}>
                    {claimProfile.currency ?? ''} {claimProfile.priceMin}–{claimProfile.priceMax}
                  </Text>
                ) : null}
              </View>
              <View style={styles.reviewCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionEyebrow}>SPECIALTIES</Text>
                  <TouchableOpacity accessibilityRole="button" onPress={() => openProfileEditor('specialties')}>
                    <Text style={styles.editLink}>Edit</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.reviewBody}>
                  {(claimProfile?.specialties ?? []).join(' · ') || 'Add at least one specialty'}
                </Text>
              </View>
              <View style={styles.reviewCard}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionEyebrow}>PRICES</Text>
                  <TouchableOpacity accessibilityRole="button" onPress={() => openProfileEditor('prices')}>
                    <Text style={styles.editLink}>Edit</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.reviewMeta}>
                  {claimProfile?.currency ?? ''} {claimProfile?.priceMin ?? '—'}–{claimProfile?.priceMax ?? '—'}
                </Text>
              </View>
              <Text style={styles.sectionTitle}>Contact and pickup</Text>
              <TextInput
                accessibilityLabel="Phone number"
                keyboardType="phone-pad"
                placeholder="Phone number"
                placeholderTextColor={Colors.midGrey}
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
              />
              <TextInput
                accessibilityLabel="Pickup address"
                placeholder="Pickup street address"
                placeholderTextColor={Colors.midGrey}
                style={styles.input}
                value={addressLine1}
                onChangeText={setAddressLine1}
              />
              <TextInput
                accessibilityLabel="Pickup city"
                placeholder="City"
                placeholderTextColor={Colors.midGrey}
                style={styles.input}
                value={city}
                onChangeText={setCity}
              />
              <TextInput
                accessibilityLabel="Pickup region"
                placeholder="State / region"
                placeholderTextColor={Colors.midGrey}
                style={styles.input}
                value={region}
                onChangeText={setRegion}
              />
              <TextInput
                accessibilityLabel="Pickup postal code"
                placeholder="Postal code"
                placeholderTextColor={Colors.midGrey}
                style={styles.input}
                value={postalCode}
                onChangeText={setPostalCode}
              />
              <TextInput
                accessibilityLabel="Pickup country code"
                autoCapitalize="characters"
                maxLength={2}
                placeholder="US"
                placeholderTextColor={Colors.midGrey}
                style={styles.input}
                value={countryCode}
                onChangeText={(value) => setCountryCode(value.toUpperCase())}
              />
              {!linkedProvider ? (
                <TextInput
                  accessibilityLabel="Claim account password"
                  autoCapitalize="none"
                  secureTextEntry
                  placeholder="Create a password (10+ characters)"
                  placeholderTextColor={Colors.midGrey}
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                />
              ) : null}
              <View style={styles.mediaConsent}>
                <Text style={styles.noticeTitle}>Photos and videos Drapeon will publish</Text>
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
                        {item.label}{item.cover ? ' · Cover' : ''}
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
                <View style={styles.consentRow}>
                  <Switch
                    accessibilityLabel="Consent to imported media"
                    value={consentAccepted}
                    onValueChange={setConsentAccepted}
                  />
                  <Text style={styles.consentText}>
                    I confirm these are my photos and videos and allow Drapeon to publish them on my
                    shop.
                  </Text>
                </View>
              </View>
            </>
          ) : null}
          {state === 'ready' && accountStep === 'phone-recovery' ? (
            <TextInput
              accessibilityLabel="Different phone number"
              keyboardType="phone-pad"
              placeholder="Different phone number"
              placeholderTextColor={Colors.midGrey}
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
            />
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {claimDisabledReason ? <Text style={styles.inlineError}>{claimDisabledReason}</Text> : null}
          {busy ? <ActivityIndicator color={Colors.needleGreen} /> : null}
          {state === 'ready' && accountStep !== 'review' ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Private claim</Text>
              <Text style={styles.noticeText}>
                No account or shop is claimed until the final claim receipt is issued.
              </Text>
            </View>
          ) : null}
        </ScrollView>
        {state === 'retryable' ? (
          <ClaimActionDock label="Try again" icon="refresh-cw" testID="claim-retry-action-dock" onPress={() => void retryClaim()} />
        ) : state === 'ready' && accountStep === 'review' ? (
          <ClaimActionDock label="Make it mine" icon="arrow-right" testID="claim-review-action-dock" onPress={() => setAccountStep('email')} />
        ) : state === 'ready' && accountStep === 'email' ? (
          <ClaimActionDock label="Send email code" icon="mail" testID="claim-email-action-dock" disabled={busy} onPress={() => void requestCode()} />
        ) : state === 'ready' && accountStep === 'code' ? (
          <ClaimActionDock label="Verify and continue" icon="arrow-right" testID="claim-code-action-dock" disabled={busy} onPress={() => void bootstrapEmailSession()} />
        ) : state === 'ready' && accountStep === 'details' ? (
          <ClaimActionDock label="Claim my shop" icon="check" testID="claim-final-action-dock" disabled={busy || !!claimDisabledReason} onPress={() => void claimShop()} />
        ) : state === 'ready' && accountStep === 'phone-recovery' ? (
          <ClaimActionDock label="Use a different number" icon="phone" testID="claim-phone-recovery-action-dock" disabled={busy} onPress={() => void retryClaimWithPhone()} />
        ) : state === 'ready' && accountStep === 'complete' ? (
          <ClaimActionDock label={linkedProvider === 'apple' ? 'Sign in with Apple to finish' : 'Sign in to finish'} icon="log-in" testID="claim-complete-action-dock" onPress={continueToClaimedAccountSignIn} />
        ) : null}
      </SafeAreaView>
      <BottomSheetScaffold
        visible={editSection !== null}
        title={editSection === 'about' ? 'Edit about' : editSection === 'specialties' ? 'Edit specialties' : 'Edit prices'}
        subtitle="These changes will appear on your public shop."
        onDismiss={() => setEditSection(null)}
        scrollable
        primaryAction={{ label: 'Save changes', onPress: () => void saveProfileEdits(), loading: busy }}
      >
        {editSection === 'about' && editDraft ? (
          <View style={styles.sheetFields}>
            <TextInput accessibilityLabel="Shop name" placeholder="Shop name" style={styles.input} value={editDraft.displayName ?? ''} onChangeText={(value) => setEditDraft({ ...editDraft, displayName: value })} />
            <TextInput accessibilityLabel="Public location" placeholder="City, country" style={styles.input} value={editDraft.location ?? ''} onChangeText={(value) => setEditDraft({ ...editDraft, location: value })} />
            <TextInput accessibilityLabel="Shop bio" multiline placeholder="Tell customers about your work" style={[styles.input, styles.bioInput]} value={editDraft.bio ?? ''} onChangeText={(value) => setEditDraft({ ...editDraft, bio: value })} />
            <TextInput accessibilityLabel="Languages" placeholder="English, Yoruba" style={styles.input} value={(editDraft.languages ?? []).join(', ')} onChangeText={(value) => setEditDraft({ ...editDraft, languages: value.split(',').map((item) => item.trim()).filter(Boolean) })} />
          </View>
        ) : null}
        {editSection === 'specialties' && editDraft ? (
          <TextInput accessibilityLabel="Specialties" multiline placeholder="Alterations, Bridal, Menswear" style={[styles.input, styles.bioInput]} value={(editDraft.specialties ?? []).join(', ')} onChangeText={(value) => setEditDraft({ ...editDraft, specialties: value.split(',').map((item) => item.trim()).filter(Boolean) })} />
        ) : null}
        {editSection === 'prices' && editDraft ? (
          <View style={styles.sheetFields}>
            <TextInput accessibilityLabel="Currency" autoCapitalize="characters" maxLength={3} placeholder="USD" style={styles.input} value={editDraft.currency ?? ''} onChangeText={(value) => setEditDraft({ ...editDraft, currency: value.toUpperCase() })} />
            <TextInput accessibilityLabel="Minimum price" keyboardType="number-pad" placeholder="Minimum price" style={styles.input} value={editDraft.priceMin == null ? '' : String(editDraft.priceMin)} onChangeText={(value) => setEditDraft({ ...editDraft, priceMin: Number(value.replace(/\D/gu, '')) })} />
            <TextInput accessibilityLabel="Maximum price" keyboardType="number-pad" placeholder="Maximum price" style={styles.input} value={editDraft.priceMax == null ? '' : String(editDraft.priceMax)} onChangeText={(value) => setEditDraft({ ...editDraft, priceMax: Number(value.replace(/\D/gu, '')) })} />
          </View>
        ) : null}
        {editError ? <Text style={styles.inlineError}>{editError}</Text> : null}
      </BottomSheetScaffold>
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
          <DrapeIconButton icon={icon!} accessibilityLabel={label} tone="primary" disabled={disabled} onPress={onPress} />
        ) : (
          <DrapeCapsuleButton label={label} icon={icon} style={styles.actionDockPrimary} disabled={disabled} onPress={onPress} />
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  card: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
    paddingBottom: DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
    gap: Spacing.md,
  },
  stepHeader: { gap: Spacing.xs },
  stepText: { color: Colors.needleGreenDark, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  stepTrack: { height: 4, overflow: 'hidden', borderRadius: 2, backgroundColor: Colors.lightGrey },
  stepProgress: { height: '100%', borderRadius: 2, backgroundColor: Colors.needleGreen },
  eyebrow: {
    color: Colors.needleGreen,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.6,
  },
  title: { color: Colors.ink, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  body: { color: Colors.inkLight, fontSize: FontSize.md, lineHeight: 24 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    color: Colors.ink,
    fontSize: FontSize.md,
    paddingHorizontal: Spacing.md,
  },
  providerList: { gap: Spacing.sm },
  orText: { color: Colors.midGrey, fontSize: FontSize.xs, textAlign: 'center' },
  providerButton: {
    minHeight: 50,
    borderRadius: Radius.full,
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  providerButtonText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  disabled: { opacity: 0.55 },
  actionDockPrimary: { width: '100%', flexShrink: 1 },
  message: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
  notice: { marginTop: Spacing.md, backgroundColor: Colors.white, padding: Spacing.lg },
  noticeTitle: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  noticeText: {
    marginTop: Spacing.xs,
    color: Colors.inkLight,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  mediaConsent: { gap: Spacing.sm, backgroundColor: Colors.white, padding: Spacing.lg },
  sectionEyebrow: {
    color: Colors.needleGreen,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.2,
  },
  sectionTitle: { color: Colors.ink, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  reviewCard: {
    gap: Spacing.xs,
    borderRadius: Radius.lg,
    backgroundColor: Colors.needleGreenLight,
    padding: Spacing.lg,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editLink: { color: Colors.needleGreenDark, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  reviewTitle: { color: Colors.ink, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  reviewMeta: { color: Colors.needleGreenDark, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  reviewBody: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
  storefrontPreview: { overflow: 'hidden', gap: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.white, paddingBottom: Spacing.lg },
  heroImage: { width: '100%', aspectRatio: 1.4, backgroundColor: Colors.boneDeep },
  previewIdentity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, marginTop: -34 },
  previewAvatar: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: Colors.white, backgroundColor: Colors.boneDeep },
  previewIdentityText: { flex: 1, paddingTop: 34 },
  previewPortfolio: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.lg },
  previewPortfolioImage: { flex: 1, minWidth: 0, aspectRatio: 0.8, borderRadius: Radius.md, backgroundColor: Colors.boneDeep },
  privacyNote: { paddingHorizontal: Spacing.lg, color: Colors.midGrey, fontSize: FontSize.xs, lineHeight: 18 },
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
  mediaRemoveText: { color: Colors.white, fontSize: 22, lineHeight: 24 },
  mediaImage: { width: '100%', aspectRatio: 0.8, borderRadius: Radius.md, backgroundColor: Colors.bone },
  mediaPlaceholder: {
    width: '100%',
    aspectRatio: 0.8,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
  },
  mediaPlaceholderText: { color: Colors.midGrey, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  mediaItem: { color: Colors.inkLight, fontSize: FontSize.sm },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  consentText: { flex: 1, color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
  inlineError: { color: Colors.error, fontSize: FontSize.sm, lineHeight: 20 },
  sheetFields: { gap: Spacing.md },
  bioInput: { minHeight: 120, paddingTop: Spacing.md, textAlignVertical: 'top' },
})
