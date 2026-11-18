import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import * as AuthSession from 'expo-auth-session'
import { SafeAreaView } from 'react-native-safe-area-context'
import { savePendingTailorClaim } from '@/lib/pending-tailor-claim'
import { supabase } from '@/lib/supabase'
import { sha256Hex, type LinkedAuthProvider } from '@/lib/auth'
import {
  DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
} from '@/components/ui/DrapePrimitives'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

const CLAIM_TOKEN = /^[A-Za-z0-9_-]{40,60}$/u
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const CODE = /^\d{6}$/u
const GOOGLE_CLAIM_ENABLED = process.env.EXPO_PUBLIC_TAILOR_CLAIM_GOOGLE_ENABLED === 'true'
type ClaimState = 'checking' | 'ready' | 'unavailable' | 'retryable'
type AccountStep = 'email' | 'code' | 'provider' | 'details' | 'complete'
type ClaimMedia = { id: string; kind: 'AVATAR' | 'PHOTO' | 'VIDEO'; label: string; cover: boolean }

async function checkClaim(token: string): Promise<ClaimState> {
  try {
    const { data, error } = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'RESOLVE', token },
    })
    if (error) return 'retryable'
    if (data?.actionable !== true) return 'unavailable'
    return (await savePendingTailorClaim(token)) ? 'ready' : 'retryable'
  } catch {
    return 'retryable'
  }
}

export default function TailorClaimEntryScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>()
  const validToken = typeof token === 'string' && CLAIM_TOKEN.test(token)
  const [state, setState] = useState<ClaimState>(validToken ? 'checking' : 'unavailable')
  const [accountStep, setAccountStep] = useState<AccountStep>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [linkedProvider, setLinkedProvider] = useState<LinkedAuthProvider | null>(null)
  const [claimMedia, setClaimMedia] = useState<ClaimMedia[]>([])
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
      typeof context.data?.consentTextVersion !== 'string'
    ) {
      setMessage('Your secure claim details could not be loaded. Try again.')
      return false
    }
    setLinkedProvider(provider)
    setClaimSessionId(sessionId)
    setClaimMedia(context.data.media as ClaimMedia[])
    setConsentTextVersion(context.data.consentTextVersion)
    setAccountStep('details')
    setMessage(null)
    return true
  }

  useEffect(() => {
    if (!validToken) return
    let active = true
    void checkClaim(token).then((result) => {
      if (active) setState(result)
    })
    return () => {
      active = false
    }
  }, [token, validToken])

  async function retryClaim() {
    if (!validToken) return
    setState('checking')
    setState(await checkClaim(token))
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
      setMessage(
        data?.error === 'EMAIL_LOCKED'
          ? `Email codes are locked for this link. Continue with Apple${GOOGLE_CLAIM_ENABLED ? ' or Google' : ''}, or contact Drapeon.`
          : 'We could not send a code. Check your connection and try again.'
      )
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
      setMessage(
        verified.data?.error === 'ACCOUNT_CONFLICT'
          ? `That email already belongs to another Drapeon account. Use Apple${GOOGLE_CLAIM_ENABLED ? ' or Google' : ''}, or choose another email.`
          : 'That code is not valid. Check it and try again.'
      )
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
      setMessage('We could not open the secure claim session. Try the code again.')
      return
    }
    const installed = await supabase.auth.setSession({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
    })
    setBusy(false)
    if (installed.error || installed.data.user?.id == null) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
      setMessage('The secure claim session could not be verified. Request a new code.')
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
      setMessage('Drapeon could not start provider verification. Try again.')
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
      setMessage(
        'That provider already belongs to another Drapeon account. Choose a different account or use email.'
      )
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
      setMessage('Drapeon could not verify that provider account. Try again.')
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
      setMessage(
        'Drapeon could not match the linked provider to the account you proved. Start again.'
      )
      return
    }
    await openClaimDetails(provider, session.claimSessionId)
  }

  async function claimShop() {
    if (!validToken || busy || !claimSessionId) return
    if (!consentAccepted) {
      setMessage('Confirm that Drapeon may publish the listed photos and videos.')
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
      setMessage(
        result.data?.error === 'ACCOUNT_CONFLICT'
          ? 'That email or provider belongs to another Drapeon account. Use a different sign-in.'
          : result.data?.error === 'CONSENT_MANIFEST_STALE'
            ? 'Staff updated the shop media. Reopen the link to review the current list.'
            : 'The claim could not be completed. Your information is safe; try again.'
      )
      return
    }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
    setBusy(false)
    setAccountStep('complete')
    setMessage('Your shop is now yours. Sign in with the account you just confirmed to continue.')
  }

  const title =
    state === 'ready'
      ? accountStep === 'details'
        ? 'Review and claim your shop.'
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
      ? accountStep === 'email'
        ? 'Start with an email code. This does not create a second Drapeon account.'
        : accountStep === 'code'
          ? `We sent a code to ${email}.`
          : accountStep === 'provider'
            ? 'Choose the provider account that should open this staff-built shop.'
            : accountStep === 'details'
              ? 'Add your contact details and approve the exact media imported by Drapeon staff.'
              : 'Sign in again to verify your phone and finish making the shop live.'
      : state === 'retryable'
        ? 'Your connection may have been interrupted. Try checking the same private link again.'
        : state === 'unavailable'
          ? 'Return to the private link Drapeon staff sent you and try again.'
          : 'This takes only a moment.'

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>YOUR DRAPEON SHOP</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {state === 'checking' ? <ActivityIndicator color={Colors.needleGreen} /> : null}
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
              <Text style={styles.noticeTitle}>Media Drapeon will publish</Text>
              {claimMedia.map((item) => (
                <Text key={item.id} style={styles.mediaItem}>
                  • {item.label}
                  {item.cover ? ' — cover' : ''}
                </Text>
              ))}
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
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {busy ? <ActivityIndicator color={Colors.needleGreen} /> : null}
        {state === 'ready' ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Private claim</Text>
            <Text style={styles.noticeText}>
              No account or shop is claimed until the final claim receipt is issued.
            </Text>
          </View>
        ) : null}
      </ScrollView>
      {state === 'retryable' ? (
        <DrapeFloatingActionDock compactOnScroll={false} testID="claim-retry-action-dock">
          <DrapeCapsuleButton
            label="Try again"
            icon="refresh-cw"
            onPress={() => void retryClaim()}
          />
        </DrapeFloatingActionDock>
      ) : state === 'ready' && accountStep === 'email' ? (
        <DrapeFloatingActionDock compactOnScroll={false} testID="claim-email-action-dock">
          <DrapeCapsuleButton
            label="Send email code"
            icon="mail"
            disabled={busy}
            onPress={() => void requestCode()}
          />
        </DrapeFloatingActionDock>
      ) : state === 'ready' && accountStep === 'code' ? (
        <DrapeFloatingActionDock compactOnScroll={false} testID="claim-code-action-dock">
          <DrapeCapsuleButton
            label="Verify and continue"
            icon="arrow-right"
            disabled={busy}
            onPress={() => void bootstrapEmailSession()}
          />
        </DrapeFloatingActionDock>
      ) : state === 'ready' && accountStep === 'details' ? (
        <DrapeFloatingActionDock compactOnScroll={false} testID="claim-final-action-dock">
          <DrapeCapsuleButton
            label="Claim my shop"
            icon="check"
            disabled={busy}
            onPress={() => void claimShop()}
          />
        </DrapeFloatingActionDock>
      ) : null}
    </SafeAreaView>
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
  mediaItem: { color: Colors.inkLight, fontSize: FontSize.sm },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  consentText: { flex: 1, color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
})
