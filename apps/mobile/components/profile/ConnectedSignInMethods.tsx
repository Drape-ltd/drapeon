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
import { supabase } from '@/lib/supabase'
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

  async function remove(identity: UserIdentity) {
    if (connecting || removingId || !user) return
    setRemovingId(identity.id)
    const [{ data: currentUser, error: userError }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getUserIdentities(),
    ])
    const current = data?.identities.find((candidate) => candidate.id === identity.id)
    if (userError || currentUser.user?.id !== user.id || error || !current) {
      setRemovingId(null)
      Alert.alert('Could not remove sign-in', 'Your account changed. Sign in again and retry.')
      return
    }
    if (data.identities.length < 2) {
      setRemovingId(null)
      Alert.alert('Keep a sign-in method', 'Connect another sign-in method before removing this one.')
      return
    }
    const accountEmail = currentUser.user.email?.trim().toLowerCase()
    const remaining = data.identities.filter((candidate) => candidate.id !== current.id)
    if (!accountEmail || !remaining.some((candidate) => identityEmail(candidate)?.toLowerCase() === accountEmail)) {
      setRemovingId(null)
      Alert.alert('Change account email first', 'Removing this sign-in could change your Drapeon contact email. Change and confirm your account email first, then retry.')
      return
    }
    const { error: unlinkError } = await supabase.auth.unlinkIdentity(current)
    await loadIdentities()
    setRemovingId(null)
    Alert.alert(
      unlinkError ? 'Could not remove sign-in' : 'Sign-in removed',
      unlinkError?.message ?? 'This Google or Apple account can no longer sign in to your Drapeon account.'
    )
  }

  function confirmRemove(identity: UserIdentity) {
    const label = identity.provider === 'apple' ? 'Apple' : 'Google'
    Alert.alert(
      `Remove ${label} sign-in?`,
      `${identityEmail(identity) ?? 'This account'} will no longer open this Drapeon account. Check your other sign-in method first.`,
      [
        { text: 'Keep sign-in', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void remove(identity) },
      ]
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
                    <View key={identity.id} style={styles.identityRow}>
                      <Text style={styles.description} numberOfLines={1}>
                        {identityEmail(identity) ?? 'Connected account'}
                      </Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${row.label} sign-in ${identityEmail(identity) ?? ''}`}
                        disabled={Boolean(connecting || removingId) || identities.length < 2}
                        onPress={() => confirmRemove(identity)}
                      >
                        <Text style={styles.removeText}>{removingId === identity.id ? 'Removing…' : 'Remove'}</Text>
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
                    disabled={Boolean(connecting || removingId)}
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
