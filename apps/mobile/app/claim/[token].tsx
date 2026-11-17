import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import { savePendingTailorClaim } from '@/lib/pending-tailor-claim'
import { supabase } from '@/lib/supabase'
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme'

const CLAIM_TOKEN = /^[A-Za-z0-9_-]{40,60}$/u

export default function TailorClaimEntryScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>()
  const router = useRouter()
  const { session } = useAuth()
  const [saved, setSaved] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const validToken = typeof token === 'string' && CLAIM_TOKEN.test(token)

  useEffect(() => {
    let active = true
    if (!validToken) return
    void supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'RESOLVE', token },
    }).then(async ({ data, error }) => {
      if (!active) return
      if (error || data?.actionable !== true) {
        setUnavailable(true)
        return
      }
      setSaved(await savePendingTailorClaim(token))
    }).catch(() => {
      if (active) setUnavailable(true)
    })
    return () => {
      active = false
    }
  }, [token, validToken])

  async function continueToAccount() {
    if (!validToken || !saved) {
      Alert.alert('Keep your claim link', 'We could not save it securely. Open the original link again to continue.')
      return
    }
    router.push('/(auth)/welcome')
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>YOUR DRAPEON SHOP</Text>
        <Text style={styles.title}>
          {validToken && !unavailable
            ? saved ? 'Your private claim is ready.' : 'Checking your private claim…'
            : 'This claim link is not available.'}
        </Text>
        <Text style={styles.body}>
          {validToken && !unavailable
            ? 'Drapeon keeps this claim on this device while you sign in or create your tailor account.'
            : 'Return to the private link Drapeon staff sent you and try again.'}
        </Text>
        {validToken && !unavailable && !saved ? <ActivityIndicator color={Colors.needleGreen} /> : null}
        {validToken && !unavailable && !session ? (
          <TouchableOpacity style={styles.primary} onPress={() => void continueToAccount()} disabled={!saved}>
            <Text style={styles.primaryText}>Continue to account</Text>
          </TouchableOpacity>
        ) : null}
        {validToken && !unavailable && saved && session ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Claim saved</Text>
            <Text style={styles.noticeText}>Account verification and shop review continue from this claim.</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  card: { flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  eyebrow: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1.6 },
  title: { color: Colors.ink, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  body: { color: Colors.inkLight, fontSize: FontSize.md, lineHeight: 24 },
  primary: { marginTop: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.needleGreen, padding: Spacing.md, alignItems: 'center' },
  primaryText: { color: Colors.white, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  notice: { marginTop: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.white, padding: Spacing.lg },
  noticeTitle: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  noticeText: { marginTop: Spacing.xs, color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
})
