import { useState } from 'react'
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
  const identities = refreshedIdentities ?? user?.identities ?? []

  async function loadIdentities() {
    const { data, error } = await supabase.auth.getUserIdentities()
    if (!error) setRefreshedIdentities(data.identities)
  }

  async function connect(provider: LinkedAuthProvider) {
    if (connecting) return
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
        'This sign-in method now opens your existing Drapeon account. Your profile, role, orders, and account email did not change.'
      )
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Connected sign-in methods</Text>
      <Text style={styles.sectionCopy}>
        Add a faster way to sign in. Connecting a provider does not create another profile or change
        your current email.
      </Text>
      <View style={styles.card}>
        {providerRows.map((row, index) => {
          const identity = identities.find((candidate) => candidate.provider === row.provider)
          const connected = Boolean(identity)
          const unavailable = row.provider === 'apple' && Platform.OS !== 'ios' && !connected
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
                    {connected ? (identityEmail(identity) ?? 'Connected') : row.description}
                  </Text>
                </View>
                {connected ? (
                  <View style={styles.connectedBadge}>
                    <Feather name="check" size={13} color={Colors.needleGreen} />
                    <Text style={styles.connectedText}>Connected</Text>
                  </View>
                ) : unavailable ? (
                  <Text style={styles.unavailableText}>iOS only</Text>
                ) : (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Connect ${row.label}`}
                    style={[styles.connectButton, connecting && styles.connectButtonDisabled]}
                    disabled={Boolean(connecting)}
                    onPress={() => void connect(row.provider)}
                  >
                    {busy ? (
                      <ActivityIndicator color={Colors.textInverse} size="small" />
                    ) : (
                      <Text style={styles.connectText}>Connect</Text>
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
