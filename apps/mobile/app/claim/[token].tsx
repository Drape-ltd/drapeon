import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { savePendingTailorClaim } from '@/lib/pending-tailor-claim'
import { supabase } from '@/lib/supabase'
import {
  DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
} from '@/components/ui/DrapePrimitives'
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme'

const CLAIM_TOKEN = /^[A-Za-z0-9_-]{40,60}$/u
type ClaimState = 'checking' | 'ready' | 'unavailable' | 'retryable'

async function checkClaim(token: string): Promise<ClaimState> {
  try {
    const { data, error } = await supabase.functions.invoke('tailor-claim-action', {
      body: { action: 'RESOLVE', token },
    })
    if (error) return 'retryable'
    if (data?.actionable !== true) return 'unavailable'
    return await savePendingTailorClaim(token) ? 'ready' : 'retryable'
  } catch {
    return 'retryable'
  }
}

export default function TailorClaimEntryScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>()
  const validToken = typeof token === 'string' && CLAIM_TOKEN.test(token)
  const [state, setState] = useState<ClaimState>(
    validToken ? 'checking' : 'unavailable'
  )

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

  const title = state === 'ready'
    ? 'Your private claim link is verified.'
    : state === 'checking'
      ? 'Checking your private claim…'
      : state === 'retryable'
        ? 'We could not check your link.'
        : 'This claim link is not available.'
  const body = state === 'ready'
    ? 'Drapeon saved this verified link securely on this device. Claim sign-in will continue here once it is available.'
    : state === 'retryable'
      ? 'Your connection may have been interrupted. Try checking the same private link again.'
      : state === 'unavailable'
        ? 'Return to the private link Drapeon staff sent you and try again.'
        : 'This takes only a moment.'

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>YOUR DRAPEON SHOP</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {state === 'checking' ? <ActivityIndicator color={Colors.needleGreen} /> : null}
        {state === 'ready' ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Link verified</Text>
            <Text style={styles.noticeText}>No account or shop has been claimed yet.</Text>
          </View>
        ) : null}
      </View>
      {state === 'retryable' ? (
        <DrapeFloatingActionDock compactOnScroll={false} testID="claim-retry-action-dock">
          <DrapeCapsuleButton
            label="Try again"
            icon="refresh-cw"
            onPress={() => void retryClaim()}
          />
        </DrapeFloatingActionDock>
      ) : state === 'ready' ? (
        <DrapeFloatingActionDock compactOnScroll={false} testID="claim-continue-action-dock">
          <DrapeCapsuleButton label="Continue securely" icon="arrow-right" disabled />
        </DrapeFloatingActionDock>
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  card: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
    paddingBottom: DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
    gap: Spacing.md,
  },
  eyebrow: { color: Colors.needleGreen, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1.6 },
  title: { color: Colors.ink, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  body: { color: Colors.inkLight, fontSize: FontSize.md, lineHeight: 24 },
  notice: { marginTop: Spacing.md, backgroundColor: Colors.white, padding: Spacing.lg },
  noticeTitle: { color: Colors.ink, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  noticeText: { marginTop: Spacing.xs, color: Colors.inkLight, fontSize: FontSize.sm, lineHeight: 20 },
})
