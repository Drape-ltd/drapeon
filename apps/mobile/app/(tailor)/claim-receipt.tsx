import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Appearance,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Colors, Fonts, getDrapeColors, Radius, Shadow, Spacing } from '@/constants/theme'
import { invokeFunction } from '@/lib/supabase'
import { appendToHistory } from '@/lib/navigation'

type LiveReceipt = {
  available?: boolean
  finalized?: boolean
  receiptId?: string
  profileId?: string
  state?: string
  completedAt?: string
  error?: string
}

export default function TailorClaimReceiptScreen() {
  const router = useRouter()
  useEffect(() => {
    Appearance.setColorScheme(null)
    return () => Appearance.setColorScheme('light')
  }, [])
  const { receiptId } = useLocalSearchParams<{ receiptId?: string }>()
  const [receipt, setReceipt] = useState<LiveReceipt | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  const palette = getDrapeColors(scheme)
  const { width } = useWindowDimensions()

  const loadReceipt = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await invokeFunction<LiveReceipt>('tailor-claim-action', {
      body: { action: 'GET_FINALIZE_RECEIPT', receiptId },
    })
    setLoading(false)
    if (result.error || result.data?.available !== true || result.data.state !== 'LIVE') {
      setError(
        'Your shop is live, but the completion receipt could not be loaded. Retry here or open your dashboard.'
      )
      return
    }
    setReceipt(result.data)
  }, [receiptId])

  useEffect(() => {
    void loadReceipt()
  }, [loadReceipt])

  async function shareShop() {
    if (!receipt?.profileId) return
    await Share.share({
      title: 'My Drapeon shop',
      message: `My Drapeon shop is live. View it here:\n\nhttps://drapeon.co/tailors/${receipt.profileId}`,
    })
  }

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: palette.bone }]}
      edges={['top', 'bottom']}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.mark}>
          <Feather name="check" size={34} color={Colors.white} />
        </View>
        <Text style={[styles.stepText, { color: palette.needleGreenDark }]}>
          Step 5 of 5 · Go live
        </Text>
        <Text style={[styles.eyebrow, { color: palette.needleGreen }]}>SHOP PUBLISHED</Text>
        <Text
          style={[
            styles.title,
            {
              color: palette.ink,
              fontSize: width < 390 ? 36 : 42,
              lineHeight: width < 390 ? 41 : 48,
            },
          ]}
        >
          Your shop is live.
        </Text>
        <Text style={[styles.body, { color: palette.midGrey }]}>
          Your shop is visible and enquiries are open. Set up payouts before you can take paid
          orders.
        </Text>

        {loading ? <ActivityIndicator color={Colors.needleGreen} style={styles.loader} /> : null}
        {error ? (
          <View style={[styles.errorCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.errorText, { color: palette.ink }]}>{error}</Text>
            <TouchableOpacity onPress={() => void loadReceipt()}>
              <Text style={[styles.retry, { color: palette.needleGreen }]}>Retry receipt</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {receipt ? (
          <View style={[styles.receiptCard, { backgroundColor: palette.surface }]}>
            <Text style={[styles.receiptLabel, { color: palette.needleGreen }]}>
              PUBLISHING RECORD
            </Text>
            <Text style={[styles.receiptValue, { color: palette.ink }]}>
              {receipt.receiptId?.slice(0, 8).toUpperCase()}
            </Text>
            <Text style={[styles.receiptMeta, { color: palette.midGrey }]}>
              {receipt.completedAt
                ? new Date(receipt.completedAt).toLocaleString()
                : 'Published just now'}
            </Text>
          </View>
        ) : null}
        <View style={[styles.payout, { backgroundColor: palette.needleGreenLight }]}>
          <View style={styles.payoutCopy}>
            <Text style={[styles.payoutTitle, { color: palette.ink }]}>Set up payouts</Text>
            <Text style={[styles.payoutBody, { color: palette.midGrey }]}>
              Paid orders start once payouts are set up.
            </Text>
          </View>
          <Feather name="arrow-up-right" size={20} color={palette.needleGreen} />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primary, { backgroundColor: palette.needleGreen }]}
            onPress={() => router.replace('/(tailor)/profile/payout-setup')}
          >
            <Feather name="credit-card" size={18} color={palette.textInverse} />
            <Text style={[styles.primaryText, { color: palette.textInverse }]}>Set up payouts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={!receipt?.profileId}
            style={[
              styles.secondary,
              { borderColor: palette.needleGreen },
              !receipt?.profileId && styles.disabled,
            ]}
            onPress={() =>
              router.navigate({
                pathname: '/(public)/explore/tailor/[id]',
                params: {
                  id: receipt?.profileId ?? '',
                  historyChain: appendToHistory(undefined, '/(tailor)/claim-receipt'),
                },
              })
            }
          >
            <Feather name="eye" size={18} color={palette.needleGreen} />
            <Text style={[styles.secondaryText, { color: palette.needleGreen }]}>View my shop</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={!receipt?.profileId}
            style={[styles.secondary, { borderColor: palette.needleGreen }]}
            onPress={() => void shareShop()}
          >
            <Feather name="share-2" size={18} color={palette.needleGreen} />
            <Text style={[styles.secondaryText, { color: palette.needleGreen }]}>Share shop</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => router.replace('/(tailor)')}>
          <Text style={[styles.dashboard, { color: palette.needleGreen }]}>Go to dashboard</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: 54,
    paddingBottom: 32,
    alignItems: 'center',
  },
  mark: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: Colors.needleGreen,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    ...Shadow.md,
  },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 2.1, color: Colors.needleGreen },
  stepText: { marginBottom: 8, fontSize: 12, fontWeight: '800', color: Colors.needleGreenDark },
  title: {
    marginTop: 10,
    fontFamily: Fonts.displayBold,
    fontSize: 42,
    lineHeight: 48,
    color: Colors.ink,
    textAlign: 'center',
  },
  body: {
    marginTop: 14,
    maxWidth: 420,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.midGrey,
    textAlign: 'center',
  },
  loader: { marginTop: 28 },
  receiptCard: {
    width: '100%',
    marginTop: 28,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    padding: 18,
    alignItems: 'center',
    ...Shadow.md,
  },
  receiptLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: Colors.needleGreen },
  receiptValue: { marginTop: 5, fontSize: 20, fontWeight: '800', color: Colors.ink },
  receiptMeta: { marginTop: 3, fontSize: 12, color: Colors.midGrey },
  errorCard: {
    width: '100%',
    marginTop: 24,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    padding: 16,
  },
  errorText: { fontSize: 14, lineHeight: 21, color: Colors.ink },
  retry: { marginTop: 8, fontWeight: '800', color: Colors.needleGreen },
  actions: { width: '100%', marginTop: 20, gap: 10 },
  primary: {
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: Colors.needleGreen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
  secondary: {
    minHeight: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: Colors.needleGreen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  secondaryText: { color: Colors.needleGreen, fontSize: 15, fontWeight: '800' },
  payout: {
    minHeight: 86,
    borderRadius: Radius.lg,
    backgroundColor: Colors.needleGreenLight,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  payoutCopy: { flex: 1 },
  payoutTitle: { fontFamily: Fonts.displayBold, fontSize: 22, color: Colors.ink },
  payoutBody: { marginTop: 3, fontSize: 13, lineHeight: 19, color: Colors.midGrey },
  dashboard: { marginTop: 20, fontSize: 14, fontWeight: '700', color: Colors.needleGreen },
  disabled: { opacity: 0.5 },
})
