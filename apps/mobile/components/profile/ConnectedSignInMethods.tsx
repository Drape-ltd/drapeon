import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import type { UserIdentity } from '@supabase/supabase-js'
import { Feather } from '@expo/vector-icons'
import { useAuth, type LinkedAuthProvider } from '@/lib/auth'
import { unlinkIdentityWithReauthProof } from '@/lib/account-security-actions'
import {
  sendReauthEmailChallenge,
  verifyReauthEmailChallenge,
  type ReauthEmailChallenge,
} from '@/lib/reauth-proof'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui'
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'

const providerRows: Array<{
  provider: LinkedAuthProvider
  label: string
  description: string
}> = [
  {
    provider: 'google',
    label: 'Google',
    description: 'Use the selected Google account to open this same Drapeon account.',
  },
  {
    provider: 'apple',
    label: 'Apple',
    description: 'Use Sign in with Apple to open this same Drapeon account.',
  },
]

function identityEmail(identity: UserIdentity | undefined) {
  const email = identity?.identity_data?.email
  return typeof email === 'string' && email.trim() ? email.trim() : null
}

export function ConnectedSignInMethods() {
  const { user, linkIdentityWithProvider } = useAuth()
  const [refreshedIdentities, setRefreshedIdentities] = useState<UserIdentity[] | null>(null)
  const [connecting, setConnecting] = useState<LinkedAuthProvider | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<{
    identity: UserIdentity
    challenge: ReauthEmailChallenge
  } | null>(null)
  const [removalCode, setRemovalCode] = useState('')
  const [removalError, setRemovalError] = useState<string | null>(null)
  const identities = refreshedIdentities ?? user?.identities ?? []

  async function loadIdentities() {
    const { data, error } = await supabase.auth.getUserIdentities()
    if (!error) setRefreshedIdentities(data.identities)
  }

  useEffect(() => {
    let active = true
    void supabase.auth.getUserIdentities().then(({ data, error }) => {
      if (active && !error) setRefreshedIdentities(data.identities)
    })
    return () => { active = false }
  }, [])

  async function connect(provider: LinkedAuthProvider) {
    if (connecting || removingId) return
    setConnecting(provider)
    const result = await linkIdentityWithProvider(provider)
    if (result.linked) await loadIdentities()
    setConnecting(null)

    if (result.error) {
      Alert.alert(`Could not connect ${provider === 'apple' ? 'Apple' : 'Google'}`, result.error)
      return
    }
    if (result.linked) {
      Alert.alert(
        `${provider === 'apple' ? 'Apple' : 'Google'} connected`,
        'The new sign-in is connected to this Drapeon account. Confirm it works before removing an older sign-in. Your account email did not change.'
      )
    }
  }

  function removalBlockReason(identity: UserIdentity): string | null {
    const accountEmail = user?.email?.trim().toLowerCase()
    const remaining = identities.filter((candidate) => candidate.identity_id !== identity.identity_id)
    if (!remaining.length) return 'Connect another sign-in method before removing this one.'
    if (!accountEmail || !remaining.some((candidate) => identityEmail(candidate)?.toLowerCase() === accountEmail)) {
      return 'Removing this sign-in could change your Drapeon contact email. Change and confirm your account email first, then retry.'
    }
    return null
  }

  async function startRemoval(identity: UserIdentity) {
    if (connecting || removingId) return
    const blocked = removalBlockReason(identity)
    if (blocked) {
      Alert.alert('Keep this sign-in for now', blocked)
      return
    }
    setRemovingId(identity.identity_id)
    setRemovalError(null)
    const issued = await sendReauthEmailChallenge('IDENTITY_UNLINK')
    setRemovingId(null)
    if (issued.error || !issued.challenge) {
      Alert.alert('Could not send code', issued.error ?? 'Please try again.')
      return
    }
    setRemovalCode('')
    setPendingRemoval({ identity, challenge: issued.challenge })
  }

  function confirmRemove(identity: UserIdentity) {
    const label = identity.provider === 'apple' ? 'Apple' : 'Google'
    Alert.alert(
      `Remove ${label} sign-in?`,
      `${identityEmail(identity) ?? 'This account'} will no longer open this Drapeon account. We will email a code to your account email to confirm.`,
      [
        { text: 'Keep sign-in', style: 'cancel' },
        { text: 'Send code', style: 'destructive', onPress: () => void startRemoval(identity) },
      ]
    )
  }

  function cancelRemoval() {
    setPendingRemoval(null)
    setRemovalCode('')
    setRemovalError(null)
  }

  async function finishRemoval() {
    if (!pendingRemoval || removingId) return
    // Copy before awaiting: the pending state can be cleared while requests run.
    const { identity, challenge } = pendingRemoval
    const code = removalCode
    if (!/^\d{6}$/u.test(code)) {
      setRemovalError('Enter the six-digit code from your email.')
      return
    }
    setRemovingId(identity.identity_id)
    setRemovalError(null)
    const verified = await verifyReauthEmailChallenge({
      purpose: 'IDENTITY_UNLINK',
      challengeId: challenge.challengeId,
      code,
    })
    if (verified.error || !verified.proof) {
      setRemovingId(null)
      setRemovalError(verified.error ?? 'That code could not be confirmed.')
      return
    }
    const result = await unlinkIdentityWithReauthProof({
      reauthProof: verified.proof,
      identityId: identity.identity_id,
    })
    await loadIdentities()
    setRemovingId(null)
    if (result.error) {
      setRemovalError(result.error)
      return
    }
    cancelRemoval()
    Alert.alert(
      'Sign-in removed',
      'That Google or Apple account can no longer open your Drapeon account. We sent a security receipt to your account email.'
    )
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Connected sign-in methods</Text>
      <Text style={styles.sectionCopy}>
        Connect another Google or Apple account before removing an older one. Your Drapeon
        contact email changes separately.
      </Text>
      <View style={styles.card}>
        {providerRows.map((row, index) => {
          const connectedIdentities = identities.filter((candidate) => candidate.provider === row.provider)
          const unavailable = row.provider === 'apple' && Platform.OS !== 'ios'
          const busy = connecting === row.provider
          return (
            <View key={row.provider}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.row}>
                <View style={styles.icon}>
                  {row.provider === 'google' ? (
                    <Text style={styles.googleMark}>G</Text>
                  ) : (
                    <Feather name="smartphone" size={18} color={Colors.ink} />
                  )}
                </View>
                <View style={styles.copy}>
                  <Text style={styles.label}>{row.label}</Text>
                  <Text style={styles.description}>
                    {connectedIdentities.length ? `${connectedIdentities.length} connected` : row.description}
                  </Text>
                  {connectedIdentities.map((identity) => (
                    <View key={identity.identity_id} style={styles.identityRow}>
                      <Text style={styles.description} numberOfLines={1}>
                        {identityEmail(identity) ?? 'Connected account'}
                      </Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${row.label} sign-in ${identityEmail(identity) ?? ''}`}
                        disabled={Boolean(connecting || removingId || pendingRemoval) || identities.length < 2}
                        onPress={() => confirmRemove(identity)}
                      >
                        <Text style={styles.removeText}>{removingId === identity.identity_id ? 'Removing…' : 'Remove'}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
                {unavailable ? (
                  <Text style={styles.unavailableText}>iOS only</Text>
                ) : (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`${connectedIdentities.length ? 'Add another' : 'Connect'} ${row.label} sign-in`}
                    style={[styles.connectButton, connecting && styles.connectButtonDisabled]}
                    disabled={Boolean(connecting || removingId || pendingRemoval)}
                    onPress={() => void connect(row.provider)}
                  >
                    {busy ? (
                      <ActivityIndicator color={Colors.textInverse} size="small" />
                    ) : (
                      <Text style={styles.connectText}>{connectedIdentities.length ? 'Add another' : 'Connect'}</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )
        })}
      </View>
      {pendingRemoval ? (
        <View style={styles.removalPanel}>
          <Text style={styles.label}>
            Confirm removing {identityEmail(pendingRemoval.identity) ?? 'this sign-in'}
          </Text>
          <Text style={styles.description}>
            Enter the code sent to {pendingRemoval.challenge.maskedEmail}.
          </Text>
          <Input
            value={removalCode}
            onChangeText={(value) => setRemovalCode(value.replace(/\D/gu, '').slice(0, 6))}
            placeholder="000000"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            returnKeyType="done"
            accessibilityLabel="Six-digit confirmation code"
            onSubmitEditing={() => void finishRemoval()}
          />
          {removalError ? <Text style={styles.removalError}>{removalError}</Text> : null}
          <View style={styles.removalActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel removing sign-in"
              disabled={Boolean(removingId)}
              onPress={cancelRemoval}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Remove sign-in"
              style={[styles.connectButton, (removingId || removalCode.length !== 6) && styles.connectButtonDisabled]}
              disabled={Boolean(removingId) || removalCode.length !== 6}
              onPress={() => void finishRemoval()}
            >
              {removingId ? (
                <ActivityIndicator color={Colors.textInverse} size="small" />
              ) : (
                <Text style={styles.connectText}>Remove</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  sectionCopy: { fontSize: FontSize.xs, color: Colors.inkLight, lineHeight: 18 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  row: {
    minHeight: 82,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.lightGrey,
    marginHorizontal: Spacing.md,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen + '12',
  },
  googleMark: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.ink },
  copy: { flex: 1, gap: 3 },
  identityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  removeText: { fontSize: FontSize.xs, color: Colors.error, fontWeight: FontWeight.semibold },
  removalPanel: {
    gap: 8,
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.sm,
  },
  removalError: { fontSize: FontSize.xs, color: Colors.error, lineHeight: 17 },
  removalActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16 },
  cancelText: { fontSize: FontSize.sm, color: Colors.inkLight, fontWeight: FontWeight.semibold },
  label: { fontSize: FontSize.md, color: Colors.ink, fontWeight: FontWeight.semibold },
  description: { fontSize: FontSize.xs, color: Colors.midGrey, lineHeight: 17 },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen + '12',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  connectedText: {
    fontSize: FontSize.xs,
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  unavailableText: { fontSize: FontSize.xs, color: Colors.midGrey },
  connectButton: {
    minWidth: 76,
    minHeight: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  connectButtonDisabled: { opacity: 0.65 },
  connectText: {
    fontSize: FontSize.sm,
    color: Colors.textInverse,
    fontWeight: FontWeight.semibold,
  },
})
