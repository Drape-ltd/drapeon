import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { savePendingTailorClaim } from '@/lib/pending-tailor-claim'
import { supabase } from '@/lib/supabase'
import { useAuth, type LinkedAuthProvider } from '@/lib/auth'
import { DRAPE_FLOATING_ACTION_DOCK_CLEARANCE, DrapeCapsuleButton, DrapeFloatingActionDock } from '@/components/ui/DrapePrimitives'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

const CLAIM_TOKEN = /^[A-Za-z0-9_-]{40,60}$/u
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const CODE = /^\d{6}$/u
type ClaimState = 'checking' | 'ready' | 'unavailable' | 'retryable'
type AccountStep = 'email' | 'code' | 'provider' | 'linked'

async function checkClaim(token: string): Promise<ClaimState> {
  try {
    const { data, error } = await supabase.functions.invoke('tailor-claim-action', { body: { action: 'RESOLVE', token } })
    if (error) return 'retryable'
    if (data?.actionable !== true) return 'unavailable'
    return await savePendingTailorClaim(token) ? 'ready' : 'retryable'
  } catch {
    return 'retryable'
  }
}

export default function TailorClaimEntryScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>()
  const { linkIdentityWithProvider } = useAuth()
  const validToken = typeof token === 'string' && CLAIM_TOKEN.test(token)
  const [state, setState] = useState<ClaimState>(validToken ? 'checking' : 'unavailable')
  const [accountStep, setAccountStep] = useState<AccountStep>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [linkedProvider, setLinkedProvider] = useState<LinkedAuthProvider | null>(null)

  useEffect(() => {
    if (!validToken) return
    let active = true
    void checkClaim(token).then((result) => { if (active) setState(result) })
    return () => { active = false }
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
      setMessage(data?.error === 'EMAIL_LOCKED'
        ? 'Email codes are locked for this link. Continue with Apple or Google, or contact Drapeon.'
        : 'We could not send a code. Check your connection and try again.')
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
      setMessage(verified.data?.error === 'ACCOUNT_CONFLICT'
        ? 'That email already belongs to another Drapeon account. Use Apple or Google, or choose another email.'
        : 'That code is not valid. Check it and try again.')
      return
    }
    const bootstrap = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'BOOTSTRAP_EMAIL_SESSION', token, email, code },
    })
    const session = bootstrap.data?.session
    if (bootstrap.error || bootstrap.data?.bootstrapped !== true
        || typeof session?.accessToken !== 'string' || typeof session?.refreshToken !== 'string') {
      setBusy(false)
      setMessage('We could not open the secure claim session. Try the code again.')
      return
    }
    const installed = await supabase.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken })
    setBusy(false)
    if (installed.error || installed.data.user?.id == null) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => null)
      setMessage('The secure claim session could not be verified. Request a new code.')
      return
    }
    setAccountStep('provider')
    setMessage('Now connect the Apple or Google account you will use to sign in to this shop.')
  }

  async function connectProvider(provider: LinkedAuthProvider) {
    if (!validToken || busy) return
    setBusy(true)
    setMessage(null)
    const current = await supabase.auth.getSession()
    if (current.data.session?.user.app_metadata?.account_origin !== 'STAFF_DRAFT') {
      if (current.data.session) {
        setBusy(false)
        setMessage('Sign out of the current Drapeon account, then reopen this private link. An existing account cannot take over this shop.')
        return
      }
      const bootstrap = await supabase.functions.invoke('tailor-claim-action', {
        body: { action: 'BOOTSTRAP_PROVIDER_SESSION', token, provider },
      })
      const session = bootstrap.data?.session
      if (bootstrap.error || bootstrap.data?.bootstrapped !== true
          || typeof session?.accessToken !== 'string' || typeof session?.refreshToken !== 'string') {
        setBusy(false)
        setMessage('Drapeon could not open the secure provider session. Try again.')
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
      setAccountStep('provider')
    }
    const linked = await linkIdentityWithProvider(provider)
    if (linked.error || !linked.linked) {
      setBusy(false)
      setMessage(linked.error ?? `${provider === 'apple' ? 'Apple' : 'Google'} sign-in was cancelled.`)
      return
    }
    const identities = await supabase.auth.getUserIdentities()
    const identity = identities.data?.identities.find((candidate) => candidate.provider === provider)
    if (identities.error || !identity?.id) {
      setBusy(false)
      setMessage('The provider connected, but Drapeon could not verify it. Try again.')
      return
    }
    const proof = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'VERIFY_LINKED_PROVIDER', token, provider, identityId: identity.id },
    })
    setBusy(false)
    if (proof.error || proof.data?.verified !== true
        || proof.data?.identityId !== identity.id || proof.data?.provider !== provider) {
      setMessage('Drapeon could not match that provider account to this secure claim session.')
      return
    }
    setLinkedProvider(provider)
    setAccountStep('linked')
    setMessage('Provider verified. Your shop has not been claimed yet; the final claim step comes next.')
  }

  const title = state === 'ready'
    ? accountStep === 'linked' ? `${linkedProvider === 'apple' ? 'Apple' : 'Google'} is verified.` : 'Secure your shop account.'
    : state === 'checking' ? 'Checking your private claim…'
      : state === 'retryable' ? 'We could not check your link.' : 'This claim link is not available.'
  const body = state === 'ready'
    ? accountStep === 'email' ? 'Start with an email code. This does not create a second Drapeon account.'
      : accountStep === 'code' ? `We sent a code to ${email}.`
        : accountStep === 'provider' ? 'Choose the provider account that should open this staff-built shop.'
          : 'The linked provider was re-checked against the same placeholder account.'
    : state === 'retryable' ? 'Your connection may have been interrupted. Try checking the same private link again.'
      : state === 'unavailable' ? 'Return to the private link Drapeon staff sent you and try again.' : 'This takes only a moment.'

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>YOUR DRAPEON SHOP</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {state === 'checking' ? <ActivityIndicator color={Colors.needleGreen} /> : null}
        {state === 'ready' && accountStep === 'email' ? (
          <>
            <TextInput accessibilityLabel="Claim email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={Colors.midGrey} style={styles.input} value={email} onChangeText={setEmail} />
            <Text style={styles.orText}>or use a provider</Text>
            <View style={styles.providerList}>
              <ProviderButton label="Continue with Google" disabled={busy} onPress={() => void connectProvider('google')} />
              {Platform.OS === 'ios' ? <ProviderButton label="Continue with Apple" disabled={busy} onPress={() => void connectProvider('apple')} /> : null}
            </View>
          </>
        ) : null}
        {state === 'ready' && accountStep === 'code' ? (
          <TextInput accessibilityLabel="Six-digit claim code" keyboardType="number-pad" maxLength={6} placeholder="000000" placeholderTextColor={Colors.midGrey} style={styles.input} value={code} onChangeText={(value) => setCode(value.replace(/\D/gu, ''))} />
        ) : null}
        {state === 'ready' && accountStep === 'provider' ? (
          <View style={styles.providerList}>
            <ProviderButton label="Continue with Google" disabled={busy} onPress={() => void connectProvider('google')} />
            {Platform.OS === 'ios' ? <ProviderButton label="Continue with Apple" disabled={busy} onPress={() => void connectProvider('apple')} /> : null}
          </View>
        ) : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {busy ? <ActivityIndicator color={Colors.needleGreen} /> : null}
        {state === 'ready' ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Private claim</Text>
            <Text style={styles.noticeText}>No account or shop is claimed until the final claim receipt is issued.</Text>
          </View>
        ) : null}
      </View>
      {state === 'retryable' ? (
        <DrapeFloatingActionDock compactOnScroll={false} testID="claim-retry-action-dock"><DrapeCapsuleButton label="Try again" icon="refresh-cw" onPress={() => void retryClaim()} /></DrapeFloatingActionDock>
      ) : state === 'ready' && accountStep === 'email' ? (
        <DrapeFloatingActionDock compactOnScroll={false} testID="claim-email-action-dock"><DrapeCapsuleButton label="Send email code" icon="mail" disabled={busy} onPress={() => void requestCode()} /></DrapeFloatingActionDock>
      ) : state === 'ready' && accountStep === 'code' ? (
        <DrapeFloatingActionDock compactOnScroll={false} testID="claim-code-action-dock"><DrapeCapsuleButton label="Verify and continue" icon="arrow-right" disabled={busy} onPress={() => void bootstrapEmailSession()} /></DrapeFloatingActionDock>
      ) : null}
    </SafeAreaView>
  )
}

function ProviderButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.providerButton, disabled && styles.disabled]}><Text style={styles.providerButtonText}>{label}</Text></TouchableOpacity>
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  card: { flex: 1, justifyContent: 'center', padding: Spacing.xl, paddingBottom: DRAPE_FLOATING_ACTION_DOCK_CLEARANCE, gap: Spacing.md },
  eyebrow: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1.6 },
  title: { color: Colors.ink, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  body: { color: Colors.inkLight, fontSize: FontSize.md, lineHeight: 24 },
  input: { minHeight: 52, borderWidth: 1, borderColor: Colors.lightGrey, borderRadius: Radius.md, backgroundColor: Colors.white, color: Colors.ink, fontSize: FontSize.md, paddingHorizontal: Spacing.md },
  providerList: { gap: Spacing.sm },
  orText: { color: Colors.midGrey, fontSize: FontSize.xs, textAlign: 'center' },
  providerButton: { minHeight: 50, borderRadius: Radius.full, backgroundColor: Colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  providerButtonText: { color: Colors.textInverse, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  disabled: { opacity: 0.55 },
  message: { color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
  notice: { marginTop: Spacing.md, backgroundColor: Colors.white, padding: Spacing.lg },
  noticeTitle: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  noticeText: { marginTop: Spacing.xs, color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
})
