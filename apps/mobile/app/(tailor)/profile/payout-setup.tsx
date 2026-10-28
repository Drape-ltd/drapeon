import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import * as ExpoLinking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import {
  Button,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
  DRAPE_FLOATING_ACTION_DOCK_CLEARANCE,
} from '@/components/ui'
import {
  useDrapeCapsuleNavMotion,
  useDrapeCapsuleNavScroll,
} from '@/components/ui/DrapeCapsuleNav'
import { useAuth } from '@/lib/auth'
import { goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { PHONE_COUNTRIES, countryFlag } from '@drape/shared'
import {
  LEGACY_PAYOUT_SETUP_COMING_SOON_COPY,
  MANUAL_BANK_ENTRY_NOTE,
  isLegacyPayoutSetupUnavailable,
} from '@drape/shared/payout-setup'
import {
  cancelPendingPayoutChange,
  confirmPendingPayoutChange,
  loadPayoutAccountStatus,
  type PendingPayoutChange,
  refreshStripeConnectPayoutStatus,
  startStripeConnectOnboarding,
  type PayoutSetupCurrency,
  type PayoutSetupProvider,
  type TailorPayoutStatus,
} from '@/lib/payout-setup'
import type { PayoutSetupOption } from '@drape/shared/payout-setup'
import { Colors, Fonts, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme'
import { settlementScheduleDisclosure } from '@drape/shared'

type SetupStep = 'INTRO' | 'CURRENCY' | 'CONNECT' | 'SUCCESS'

type StripeRefreshAccount = {
  provider: 'STRIPE'
  stripeConnectAccountId: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  payoutAccountVerified: boolean
  payoutReverificationRequired: boolean
  payoutAccountVerifiedAt: string | null
  payoutCountryCode: string | null
}

type PayoutReviewSummary = {
  payoutCurrency: PayoutSetupCurrency
  payoutProvider: PayoutSetupProvider
  payoutAccountType: 'PAYSTACK' | 'STRIPE_CONNECT' | null
  payoutBankName: string | null
  payoutAccountMasked: string | null
}

function providerLabel(provider: PayoutSetupProvider | 'STRIPE_CONNECT' | null | undefined) {
  if (provider === 'PAYSTACK') return 'Paystack'
  return 'Stripe Connect'
}

function isUnavailableEnvironmentError(message: string) {
  const normalized = message.trim().toLowerCase()
  return normalized.includes('not available in this environment')
    || normalized.includes('deploy the latest payout function')
}

function formatMaskedAccount(value: string | null | undefined) {
  if (!value) return 'Saved on your profile'
  const rawLast4 = value.replace(/\D+/gu, '').slice(-4)
  if (!rawLast4) return value
  return `Ending in ${rawLast4}`
}

function isFutureTime(value: string | null | undefined) {
  if (!value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && time > Date.now()
}

function formatGuardDate(value: string | null | undefined) {
  if (!value) return ''
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(time))
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  )
}

function StepChip({ number, label, active, complete }: { number: number; label: string; active: boolean; complete: boolean }) {
  return (
    <View style={[styles.stepChip, active && styles.stepChipActive, complete && styles.stepChipComplete]}>
      <View style={[styles.stepNumber, (active || complete) && styles.stepNumberActive]}>
        <Text style={[styles.stepNumberText, (active || complete) && styles.stepNumberTextActive]}>{complete ? '✓' : number}</Text>
      </View>
      <Text style={[styles.stepChipText, active && styles.stepChipTextActive]}>{label}</Text>
    </View>
  )
}

function BenefitRow({ icon, title, body }: { icon: React.ComponentProps<typeof Feather>['name']; title: string; body: string }) {
  return (
    <View style={styles.benefitRow}>
      <View style={styles.benefitIcon}>
        <Feather name={icon} size={16} color={Colors.needleGreen} />
      </View>
      <View style={styles.benefitBody}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitText}>{body}</Text>
      </View>
    </View>
  )
}

export default function TailorPayoutSetupScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const { compact: actionDockCompact } = useDrapeCapsuleNavMotion()
  const actionDockScroll = useDrapeCapsuleNavScroll()
  const { returnTo, historyChain } = useLocalSearchParams<{ returnTo?: string; historyChain?: string }>()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [successScale] = useState(() => new Animated.Value(0.72))

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [status, setStatus] = useState<TailorPayoutStatus | null>(null)
  const [payoutSetupOptions, setPayoutSetupOptions] = useState<PayoutSetupOption[]>([])
  const [payoutSetupOptionsStatus, setPayoutSetupOptionsStatus] = useState<'AVAILABLE' | 'NONE' | 'UNAVAILABLE'>('UNAVAILABLE')
  const [pendingPayoutChange, setPendingPayoutChange] = useState<PendingPayoutChange | null>(null)
  const [payoutReviewPending, setPayoutReviewPending] = useState(false)
  const [payoutReviewSummary, setPayoutReviewSummary] = useState<PayoutReviewSummary | null>(null)
  const [activeStep, setActiveStep] = useState<SetupStep>('INTRO')
  const [editingVerifiedAccount, setEditingVerifiedAccount] = useState(false)
  const [selectedCurrency, setSelectedCurrency] = useState<PayoutSetupCurrency>('USD')
  const [countryCode, setCountryCode] = useState('US')
  const [submitting, setSubmitting] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const [stripeStatus, setStripeStatus] = useState<StripeRefreshAccount | null>(null)

  const selectedOption = payoutSetupOptions.find((option) =>
    option.payoutCurrency === selectedCurrency && option.tailorCountryCode === countryCode
  ) ?? null
  // Only a currently configured setup route may select a provider. Historical
  // profile provider fields remain available for status/history, but must never
  // reopen a retired recipient-creation flow.
  const provider = selectedOption?.provider ?? null
  const legacyPayoutSetupUnavailable = isLegacyPayoutSetupUnavailable({ currency: selectedCurrency, countryCode })
  const setupRouteUnavailable = !selectedOption
  const connectStepLabel = 'Stripe'

  const showVerifiedSummary =
    status?.payoutAccountVerified === true
    && status.payoutReverificationRequired !== true
    && !editingVerifiedAccount
    && activeStep !== 'SUCCESS'
  const showManualPendingSummary =
    status?.manualBankEntry === true
    && status.payoutAccountVerified !== true
    && !editingVerifiedAccount
    && activeStep !== 'SUCCESS'
  const payoutChangeLocked = isFutureTime(status?.payoutAccountChangeLockedUntil)
  const environmentUnavailable = isUnavailableEnvironmentError(loadError)
  const successIsManualPending =
    status?.manualBankEntry === true
    && status.payoutAccountVerified !== true
  const successIsReviewPending = payoutReviewPending

  const load = useCallback(async () => {
    if (!userId) {
      setLoadError('Please sign in again before opening payout setup.')
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError('')
    const result = await loadPayoutAccountStatus()
    if (result.error || !result.profile) {
      setLoadError(result.error ?? 'We could not load your payout setup right now.')
      setLoading(false)
      return
    }

    const nextStatus = result.profile
    const nextOptions = result.payoutSetupOptions
    const matchingOption = nextOptions.find((option) =>
      option.payoutCurrency === nextStatus.payoutCurrency &&
      option.tailorCountryCode === (nextStatus.payoutCountryCode ?? '').toUpperCase()
    )
    const nextOption = matchingOption ?? nextOptions[0]
    setPayoutSetupOptions(nextOptions)
    setPayoutSetupOptionsStatus(result.payoutSetupOptionsStatus)
    setStatus(nextStatus)
    setPendingPayoutChange(result.pendingPayoutChange)
    setSelectedCurrency((nextOption?.payoutCurrency ?? nextStatus.payoutCurrency) as PayoutSetupCurrency)
    setCountryCode(nextOption?.tailorCountryCode ?? nextStatus.payoutCountryCode ?? '')
    setLoading(false)
  }, [userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (activeStep !== 'SUCCESS') return
    successScale.setValue(0.72)
    Animated.spring(successScale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 70,
      friction: 8,
    }).start()
  }, [activeStep, successScale])

  useEffect(() => {
    const timer = setTimeout(() => {
      const option = payoutSetupOptions.find((candidate) =>
        candidate.payoutCurrency === selectedCurrency && candidate.tailorCountryCode === countryCode
      )
      if (option) setCountryCode(option.tailorCountryCode)
      setFieldError('')
      setStripeStatus(null)
    }, 0)
    return () => clearTimeout(timer)
  }, [countryCode, payoutSetupOptions, selectedCurrency])

  function goBack() {
    goBackOrReturnTo(router, navigation, pickSafeReturnTo(historyChain, returnTo), '/(tailor)/profile' as never)
  }

  useContextualBackHandler(goBack)

  function startSetupFlow() {
    if (payoutChangeLocked) {
      Alert.alert(
        'Payout change cooling down',
        `For account safety, payout destination changes are limited for a short period. You can change this again after ${formatGuardDate(status?.payoutAccountChangeLockedUntil)}.`,
      )
      return
    }
    setEditingVerifiedAccount(true)
    setPayoutReviewPending(false)
    setPayoutReviewSummary(null)
    setActiveStep('CURRENCY')
    setFieldError('')
  }

  async function handleStartStripe() {
    if (!selectedOption) {
      setFieldError('Payout setup is not available for this country and currency yet.')
      return
    }
    setSubmitting(true)
    setFieldError('')
    const returnUrl = ExpoLinking.createURL('')
    const result = await startStripeConnectOnboarding({
      payoutCurrency: selectedCurrency as 'USD' | 'GBP' | 'EUR' | 'CAD',
      countryCode,
      returnUrl,
      refreshUrl: returnUrl,
    })

    if (result.error || !result.onboarding) {
      setSubmitting(false)
      setFieldError(result.error ?? 'We could not start Stripe onboarding right now.')
      return
    }

    const browserResult = await WebBrowser.openAuthSessionAsync(result.onboarding.url, returnUrl)
    if (browserResult.type !== 'success') {
      setSubmitting(false)
      Alert.alert('Stripe setup paused', 'You can come back and finish Stripe onboarding whenever you are ready.')
      return
    }

    const refresh = await refreshStripeConnectPayoutStatus()
    setSubmitting(false)
    if (refresh.error || (!refresh.account && !refresh.pendingReview && !refresh.confirmationRequired)) {
      setFieldError(refresh.error ?? 'We could not refresh the Stripe payout status yet.')
      return
    }

    if (refresh.confirmationRequired) {
      await load()
      Alert.alert('Confirm your payout change', 'Review and confirm the replacement within 48 hours. Your current payout account remains active.')
      return
    }

    if (refresh.pendingReview) {
      setPayoutReviewPending(true)
      setPayoutReviewSummary({
        payoutCurrency: selectedCurrency,
        payoutProvider: 'STRIPE',
        payoutAccountType: 'STRIPE_CONNECT',
        payoutBankName: null,
        payoutAccountMasked: null,
      })
      setEditingVerifiedAccount(false)
      setActiveStep('SUCCESS')
      return
    }

    const refreshedAccount = refresh.account
    if (!refreshedAccount) {
      setFieldError('We could not refresh the Stripe payout status yet.')
      return
    }

    setPayoutReviewPending(false)
    setPayoutReviewSummary(null)
    setStripeStatus(refreshedAccount as StripeRefreshAccount)
    await load()
    if (refreshedAccount.payoutAccountVerified) {
      setEditingVerifiedAccount(false)
      setActiveStep('SUCCESS')
      return
    }

    Alert.alert(
      'More Stripe details still needed',
      'Stripe still needs more information before payouts can be enabled. You can reopen Stripe to finish the remaining steps.',
    )
  }

  async function handleConfirmPendingChange() {
    if (!pendingPayoutChange) return
    setSubmitting(true)
    setFieldError('')
    const result = await confirmPendingPayoutChange(pendingPayoutChange.id)
    setSubmitting(false)
    if (result.error) {
      setFieldError(result.error)
      return
    }
    await load()
    Alert.alert(
      result.data?.lifecycleState === 'ACTIVATED' ? 'New payout account active' : 'Review started',
      result.data?.lifecycleState === 'ACTIVATED'
        ? 'The verified replacement is active now. Eligible earnings can release to it without an extra payout-account hold.'
        : 'Drapeon is reviewing the changed account details. Your current payout account stays active.',
    )
  }

  function handleCancelPendingChange() {
    if (!pendingPayoutChange) return
    Alert.alert('Cancel payout change?', 'Your current payout account will stay active.', [
      { text: 'Keep request', style: 'cancel' },
      {
        text: 'Cancel change',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSubmitting(true)
            const result = await cancelPendingPayoutChange(pendingPayoutChange.id)
            setSubmitting(false)
            if (result.error) {
              setFieldError(result.error)
              return
            }
            await load()
            Alert.alert('Payout change cancelled', 'Your current payout account was not changed.')
          })()
        },
      },
    ])
  }

  function handleFlowBack() {
    if (activeStep === 'CONNECT') {
      setActiveStep('CURRENCY')
      return
    }
    if (activeStep === 'CURRENCY') {
      if (editingVerifiedAccount) {
        setEditingVerifiedAccount(false)
        setActiveStep('INTRO')
        setFieldError('')
        return
      }
      setActiveStep('INTRO')
      return
    }
    goBack()
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payout setup</Text>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Payments & payouts</Text>
            <ActivityIndicator color={Colors.needleGreen} />
            <Text style={styles.stateTitle}>Loading your payout setup…</Text>
            <Text style={styles.stateHint}>We’re checking your current payout path and verification status first.</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payout setup</Text>
        </View>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>
              {environmentUnavailable ? 'Payout setup unavailable' : 'Payments & payouts'}
            </Text>
            <Text style={styles.stateTitle}>
              {environmentUnavailable ? 'We could not open payout setup right now.' : 'Couldn’t load this yet.'}
            </Text>
            <Text style={styles.stateHint}>
              {environmentUnavailable
                ? 'Your account is fine. Try again in a moment, or contact support if this keeps happening.'
                : loadError}
            </Text>
            {environmentUnavailable ? (
              <View style={styles.inlineInfoCard}>
                <Feather name="tool" size={16} color={Colors.needleGreen} />
                <Text style={styles.inlineInfoText}>
                  Payout setup is protected so incomplete or unavailable bank checks do not save partial account details.
                </Text>
              </View>
            ) : null}
            <Button label={environmentUnavailable ? 'Go back' : 'Try again'} onPress={environmentUnavailable ? goBack : () => { void load() }} />
            {environmentUnavailable ? (
              <Button label="Try again" variant="secondary" onPress={() => { void load() }} />
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (activeStep === 'SUCCESS' && status) {
    const successSummary = payoutReviewSummary ?? {
      payoutCurrency: status.payoutCurrency,
      payoutProvider: status.payoutProvider,
      payoutAccountType: status.payoutAccountType,
      payoutBankName: status.payoutBankName,
      payoutAccountMasked: status.payoutAccountMasked,
    }
    const summaryCurrency = successSummary.payoutCurrency
    const summaryProvider = successSummary.payoutProvider
    const summaryAccountType = successSummary.payoutAccountType
    const summaryBankName = successSummary.payoutBankName
    const summaryAccountMasked = successSummary.payoutAccountMasked
    const summaryMethod = summaryBankName
      ? `${summaryBankName} · ${formatMaskedAccount(summaryAccountMasked)}`
      : providerLabel(summaryAccountType ?? summaryProvider)

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Feather name="arrow-left" size={20} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payout setup</Text>
        </View>
        <View style={styles.stepRow}>
          <StepChip number={1} label="Intro" active={false} complete />
          <StepChip number={2} label="Currency" active={false} complete />
          <StepChip number={3} label={connectStepLabel} active={false} complete />
          <StepChip number={4} label="Done" active complete={false} />
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScroll={actionDockScroll.onScroll}
          scrollEventThrottle={actionDockScroll.scrollEventThrottle}
          contentContainerStyle={[
            styles.successWrap,
            { paddingBottom: DRAPE_FLOATING_ACTION_DOCK_CLEARANCE + Spacing.xl },
          ]}
        >
          <Animated.View style={[
            styles.successOrb,
            (successIsManualPending || successIsReviewPending) && styles.successOrbPending,
            { transform: [{ scale: successScale }] },
          ]}>
            <Feather name={(successIsManualPending || successIsReviewPending) ? 'clock' : 'check'} size={38} color={Colors.textInverse} />
          </Animated.View>
          <Text style={styles.successTitle}>
            {successIsReviewPending
              ? 'Payout change submitted for review'
              : successIsManualPending
                ? 'Manual bank details submitted'
                : "You're all set to get paid"}
          </Text>
          <Text style={styles.successBody}>
            {successIsReviewPending
              ? 'Your verified payout destination stays active while Drapeon reviews this replacement for account safety.'
              : successIsManualPending
                ? MANUAL_BANK_ENTRY_NOTE
                : `Your payout account is verified. ${settlementScheduleDisclosure()}`}
          </Text>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {successIsReviewPending
                ? 'Submitted replacement'
                : successIsManualPending
                  ? 'Pending verification summary'
                  : 'Verified account summary'}
            </Text>
            <SummaryRow label="Payout method" value={summaryMethod} />
            <SummaryRow label="Payout currency" value={summaryCurrency} />
            <SummaryRow label="Provider" value={successIsManualPending ? 'Ops verification' : providerLabel(summaryProvider)} />
            {successIsReviewPending ? <SummaryRow label="Status" value="Pending ops review" /> : null}
            {successIsManualPending ? <SummaryRow label="Status" value="Pending review" /> : null}
          </View>

          {!successIsManualPending ? (
            <View style={styles.successChecklist}>
              <View style={styles.successCheckRow}>
                <Feather name="check-circle" size={17} color={Colors.needleGreen} />
                <Text style={styles.successCheckText}>
                  {successIsReviewPending
                    ? 'Your current verified payout account remains active during review.'
                    : 'Paid orders can release to this account after delivery.'}
                </Text>
              </View>
              <View style={styles.successCheckRow}>
                <Feather name="check-circle" size={17} color={Colors.needleGreen} />
                <Text style={styles.successCheckText}>
                  {successIsReviewPending
                    ? 'If approved, this replacement activates immediately and can receive eligible earnings.'
                    : 'Your dashboard will show this payout path at a glance.'}
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>
        <DrapeFloatingActionDock compactWidth={76} testID="payout-success-action-dock">
          {actionDockCompact ? (
            <DrapeIconButton
              icon="arrow-left"
              accessibilityLabel="Go back"
              tone="primary"
              onPress={goBack}
            />
          ) : (
            <DrapeCapsuleButton
              label="Done"
              icon="check"
              onPress={goBack}
              style={styles.actionDockPrimary}
            />
          )}
        </DrapeFloatingActionDock>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleFlowBack}>
          <Feather name="arrow-left" size={20} color={Colors.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payout setup</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {(showVerifiedSummary || showManualPendingSummary) && status ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.body}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>
                {showManualPendingSummary
                  ? 'Manual bank review'
                  : pendingPayoutChange
                    ? pendingPayoutChange.lifecycleState === 'AWAITING_CONFIRMATION' ? 'Confirmation required' : pendingPayoutChange.lifecycleState === 'SECURITY_HOLD' ? 'Activating now' : 'Drapeon review'
                    : 'Verified payout account'}
              </Text>
            </View>
            <Text style={styles.heroTitle}>
              {showManualPendingSummary
                ? 'Your manual bank details are with ops.'
                : pendingPayoutChange
                  ? pendingPayoutChange.lifecycleState === 'AWAITING_CONFIRMATION' ? 'Confirm your payout change.' : 'Your current payout account stays active.'
                  : 'Your payout path is ready.'}
            </Text>
            <Text style={styles.heroCopy}>
              {showManualPendingSummary
                ? MANUAL_BANK_ENTRY_NOTE
                : pendingPayoutChange
                  ? pendingPayoutChange.lifecycleState === 'AWAITING_CONFIRMATION'
                    ? 'Check the replacement below and confirm it within 48 hours. Nothing changes until you confirm.'
                    : pendingPayoutChange.lifecycleState === 'SECURITY_HOLD'
                      ? 'This legacy verified replacement is being activated now without an additional payout-account hold.'
                      : 'Drapeon is reviewing a security difference. We will notify you when it is resolved.'
                  : 'Drapeon will only release earnings to a verified payout account. You can change this later, but changing payout currency or provider will require verification again.'}
            </Text>
          </View>

          {pendingPayoutChange?.requestedDestination ? (
            <View style={styles.pendingReviewCard}>
              <View style={styles.pendingReviewHeading}>
                <View style={styles.pendingReviewIcon}>
                  <Feather name="clock" size={18} color={Colors.kanteRust} />
                </View>
                <View style={styles.pendingReviewCopy}>
                  <Text style={styles.sectionTitle}>Requested replacement</Text>
                  <Text style={styles.pendingReviewStatus}>
                    {pendingPayoutChange.lifecycleState === 'AWAITING_CONFIRMATION'
                      ? 'Waiting for your confirmation'
                      : pendingPayoutChange.lifecycleState === 'SECURITY_HOLD'
                        ? 'Activating now'
                        : 'Drapeon review in progress'}
                  </Text>
                </View>
              </View>
              <SummaryRow
                label="Payout method"
                value={pendingPayoutChange.requestedDestination.payoutBankName
                  ? `${pendingPayoutChange.requestedDestination.payoutBankName} · ${formatMaskedAccount(pendingPayoutChange.requestedDestination.payoutAccountMasked)}`
                  : providerLabel(pendingPayoutChange.requestedDestination.payoutAccountType ?? pendingPayoutChange.requestedDestination.payoutProvider)}
              />
              {pendingPayoutChange.requestedDestination.payoutAccountName ? (
                <SummaryRow label="Account name" value={pendingPayoutChange.requestedDestination.payoutAccountName} />
              ) : null}
              <SummaryRow label="Currency" value={pendingPayoutChange.requestedDestination.payoutCurrency ?? status.payoutCurrency} />
              {pendingPayoutChange.submittedAt ? (
                <SummaryRow label="Submitted" value={formatGuardDate(pendingPayoutChange.submittedAt)} />
              ) : null}
              {pendingPayoutChange.lifecycleState === 'AWAITING_CONFIRMATION' ? (
                <>
                  <Button label={submitting ? 'Confirming…' : 'Confirm this change'} disabled={submitting} onPress={() => { void handleConfirmPendingChange() }} />
                  <Button label="Cancel request" variant="secondary" disabled={submitting} onPress={handleCancelPendingChange} />
                </>
              ) : null}
            </View>
          ) : null}
          {fieldError ? <Text style={styles.errorText}>{fieldError}</Text> : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {showManualPendingSummary
                ? 'Pending payout details'
                : pendingPayoutChange
                  ? 'Current active payout account'
                  : 'Saved payout details'}
            </Text>
            <SummaryRow label="Provider" value={showManualPendingSummary ? 'Manual ops verification' : providerLabel(status.payoutAccountType)} />
            <SummaryRow label="Payout currency" value={status.payoutCurrency} />
            {status.payoutBankName ? <SummaryRow label="Bank" value={status.payoutBankName} /> : null}
            {status.payoutAccountName ? <SummaryRow label="Account name" value={status.payoutAccountName} /> : null}
            <SummaryRow label="Account" value={formatMaskedAccount(status.payoutAccountMasked)} />
            {showManualPendingSummary ? <SummaryRow label="Status" value="Pending review" /> : null}
            {payoutChangeLocked ? (
              <SummaryRow label="Next change" value={formatGuardDate(status.payoutAccountChangeLockedUntil)} />
            ) : null}
          </View>

          <Button
            label={pendingPayoutChange
              ? 'Replacement under review'
              : payoutChangeLocked
                ? 'Payout change cooling down'
                : 'Change payout setup'}
            variant="secondary"
            disabled={payoutChangeLocked || !!pendingPayoutChange}
            onPress={startSetupFlow}
          />
          {payoutChangeLocked ? (
            <Text style={styles.guardHint}>
              You can update this destination again after {formatGuardDate(status.payoutAccountChangeLockedUntil)}. Contact support if your bank account is closed or compromised before then.
            </Text>
          ) : null}
          <Button label="Go back" onPress={goBack} />
        </ScrollView>
      ) : (
        <>
          <View style={styles.stepRow}>
            <StepChip number={1} label="Intro" active={activeStep === 'INTRO'} complete={activeStep !== 'INTRO'} />
            <StepChip number={2} label="Currency" active={activeStep === 'CURRENCY'} complete={activeStep === 'CONNECT' || activeStep === 'SUCCESS'} />
            <StepChip number={3} label={connectStepLabel} active={activeStep === 'CONNECT'} complete={activeStep === 'SUCCESS'} />
            <StepChip number={4} label="Done" active={activeStep === 'SUCCESS'} complete={false} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            onScroll={actionDockScroll.onScroll}
            scrollEventThrottle={actionDockScroll.scrollEventThrottle}
            contentContainerStyle={[
              styles.body,
              { paddingBottom: DRAPE_FLOATING_ACTION_DOCK_CLEARANCE + Spacing.xl },
            ]}
          >
            {activeStep === 'INTRO' ? (
              <>
                <View style={styles.heroCard}>
                  <View style={styles.heroBadge}>
                    <Text style={styles.heroBadgeText}>Payments & payouts</Text>
                  </View>
                  <Text style={styles.heroTitle}>Get paid for your work</Text>
                  <Text style={styles.heroCopy}>
                    Set up your payout account to receive earnings when orders are completed.
                  </Text>
                </View>

                <View style={styles.card}>
                  <BenefitRow
                    icon="clock"
                    title="Earnings release in stages"
                    body={settlementScheduleDisclosure()}
                  />
                  <BenefitRow
                    icon="credit-card"
                    title="Earnings reach your provider balance"
                    body="Choose a currency only when you have an eligible payout account and can complete that provider’s verification. Bank withdrawals happen separately through your provider."
                  />
                  <BenefitRow
                    icon="shield"
                    title="Secure and verified"
                    body="Your payout details are verified before Drapeon unlocks paid work or future releases."
                  />
                </View>
              </>
            ) : null}

            {activeStep === 'CURRENCY' ? (
              <>
                <View style={styles.heroCard}>
                  <View style={styles.heroBadge}>
                    <Text style={styles.heroBadgeText}>Step 2</Text>
                  </View>
                  <Text style={styles.heroTitle}>How would you like to be paid?</Text>
                  <Text style={styles.heroCopy}>
                    Payout options are loaded from Drapeon’s currently configured routes. Existing orders and earnings are not affected by setup availability.
                  </Text>
                </View>

                <View style={styles.currencyList}>
                  {payoutSetupOptions.map((option) => {
                    const active = selectedCurrency === option.payoutCurrency && countryCode === option.tailorCountryCode
                    const country = PHONE_COUNTRIES.find((item) => item.code === option.tailorCountryCode)
                    return (
                      <TouchableOpacity
                        key={`${option.tailorCountryCode}:${option.payoutCurrency}`}
                        style={[styles.currencyCard, active && styles.currencyCardActive]}
                        onPress={() => {
                          setSelectedCurrency(option.payoutCurrency as PayoutSetupCurrency)
                          setCountryCode(option.tailorCountryCode)
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={styles.currencyCardTop}>
                          <Text style={styles.currencyFlag}>{countryFlag(option.tailorCountryCode)}</Text>
                          <View style={styles.providerBadge}>
                            <Text style={styles.providerBadgeText}>Stripe</Text>
                          </View>
                        </View>
                        <Text style={styles.currencyCode}>{option.payoutCurrency}</Text>
                        <Text style={styles.currencyName}>Provider payout currency</Text>
                        <Text style={styles.currencyMeta}>{country?.name ?? option.tailorCountryCode}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
                {payoutSetupOptionsStatus === 'UNAVAILABLE' || payoutSetupOptionsStatus === 'NONE' ? (
                  <View style={styles.inlineInfoCard} accessibilityRole="alert">
                    <Feather name={payoutSetupOptionsStatus === 'NONE' ? 'clock' : 'alert-circle'} size={16} color={Colors.needleGreen} />
                    <Text style={styles.inlineInfoText}>
                      {payoutSetupOptionsStatus === 'NONE'
                        ? (legacyPayoutSetupUnavailable
                          ? LEGACY_PAYOUT_SETUP_COMING_SOON_COPY
                          : 'No payout route is currently available for setup. Existing orders and earnings are not affected.')
                        : 'Payout options could not be loaded right now. Try again later; no payout details were changed.'}
                    </Text>
                  </View>
                ) : null}
                {selectedOption ? (
                  <View style={styles.inlineInfoCard}>
                    <Feather name="info" size={16} color={Colors.needleGreen} />
                    <Text style={styles.inlineInfoText}>
                      This route uses {selectedOption.payoutCurrency} payouts for a tailor in {PHONE_COUNTRIES.find((item) => item.code === selectedOption.tailorCountryCode)?.name ?? selectedOption.tailorCountryCode}. Stripe will require identity and eligible bank verification. Existing orders keep their original currency.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}

            {activeStep === 'CONNECT' ? (
              <>
                <View style={styles.heroCard}>
                  <View style={styles.heroBadge}>
                    <Text style={styles.heroBadgeText}>Step 3</Text>
                  </View>
                  <Text style={styles.heroTitle}>Connect your bank account</Text>
                  <Text style={styles.heroCopy}>
                    Stripe receives your released earnings in your connected balance. You’ll be taken to Stripe’s secure setup to add a bank account for withdrawals, then returned here.
                  </Text>
                </View>

                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Payout summary</Text>
                  <SummaryRow label="Payout currency" value={selectedCurrency} />
                  <SummaryRow label="Provider" value={provider ? providerLabel(provider) : 'Unavailable'} />
                  <SummaryRow label="Country" value={PHONE_COUNTRIES.find((item) => item.code === countryCode)?.name ?? (countryCode || 'Not selected')} />
                </View>

                {provider === 'STRIPE' ? (
                  <>
                    <View style={styles.card}>
                      <Text style={styles.sectionTitle}>What you’ll need</Text>
                      <Text style={styles.sectionCopy}>Stripe handles the compliance checks for you. Most tailors finish this in about 2 minutes.</Text>
                      <BenefitRow icon="credit-card" title="Your bank account details" body="Stripe will ask where payouts should land." />
                      <BenefitRow
                        icon="file-text"
                        title="Identity check with Stripe"
                        body="Stripe may request government ID directly. Drapeon does not receive or store that document."
                      />
                      <BenefitRow icon="calendar" title="Your date of birth" body="Stripe may ask for this to complete onboarding." />
                    </View>

                    {stripeStatus && !stripeStatus.payoutAccountVerified ? (
                      <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Still needed from Stripe</Text>
                        <View style={styles.checkRow}>
                          <Feather name={stripeStatus.detailsSubmitted ? 'check-circle' : 'circle'} size={16} color={stripeStatus.detailsSubmitted ? Colors.needleGreen : Colors.midGrey} />
                          <Text style={styles.checkText}>Profile details submitted</Text>
                        </View>
                        <View style={styles.checkRow}>
                          <Feather name={stripeStatus.chargesEnabled ? 'check-circle' : 'circle'} size={16} color={stripeStatus.chargesEnabled ? Colors.needleGreen : Colors.midGrey} />
                          <Text style={styles.checkText}>Charges enabled</Text>
                        </View>
                        <View style={styles.checkRow}>
                          <Feather name={stripeStatus.payoutsEnabled ? 'check-circle' : 'circle'} size={16} color={stripeStatus.payoutsEnabled ? Colors.needleGreen : Colors.midGrey} />
                          <Text style={styles.checkText}>Payouts enabled</Text>
                        </View>
                      </View>
                    ) : null}

                    {fieldError ? <Text style={styles.errorText}>{fieldError}</Text> : null}

                    <Button
                      label={submitting ? 'Opening Stripe…' : 'Continue to Stripe'}
                      loading={submitting}
                      onPress={() => { void handleStartStripe() }}
                    />
                  </>
                ) : (
                  <View style={styles.inlineInfoCard}>
                    <Feather name="clock" size={16} color={Colors.needleGreen} />
                    <Text style={styles.inlineInfoText}>
                      {legacyPayoutSetupUnavailable
                        ? LEGACY_PAYOUT_SETUP_COMING_SOON_COPY
                        : 'Payout setup is not currently available for this country and currency. Existing orders and earnings are not affected.'}
                    </Text>
                  </View>
                )}
              </>
            ) : null}
          </ScrollView>

          {activeStep === 'INTRO' || activeStep === 'CURRENCY' ? (
            <DrapeFloatingActionDock compactWidth={76} testID="payout-setup-action-dock">
              {actionDockCompact ? (
                <DrapeIconButton
                  icon="arrow-right"
                  accessibilityLabel={activeStep === 'INTRO' ? 'Set up payout account' : setupRouteUnavailable ? 'Payout setup is unavailable' : 'Continue'}
                  tone="primary"
                  onPress={() => setActiveStep(activeStep === 'INTRO' ? 'CURRENCY' : 'CONNECT')}
                  disabled={activeStep === 'CURRENCY' && setupRouteUnavailable}
                />
              ) : (
                <DrapeCapsuleButton
                  label={activeStep === 'INTRO' ? 'Set up payout account' : setupRouteUnavailable ? 'Payout setup is unavailable' : 'Continue'}
                  icon="arrow-right"
                  onPress={() => setActiveStep(activeStep === 'INTRO' ? 'CURRENCY' : 'CONNECT')}
                  disabled={activeStep === 'CURRENCY' && setupRouteUnavailable}
                />
              )}
            </DrapeFloatingActionDock>
          ) : null}
        </>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bone },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    ...Shadow.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  stateWrap: { flex: 1, justifyContent: 'center', padding: Spacing.xl },
  stateCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'center',
    ...Shadow.md,
  },
  stateEyebrow: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  stateTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: Fonts.display,
  },
  stateHint: { fontSize: FontSize.xs, color: Colors.inkLight, textAlign: 'center', lineHeight: 18 },
  stepRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  stepChipActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  stepChipComplete: {
    borderColor: Colors.needleGreen + '50',
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
  },
  stepNumberActive: {
    backgroundColor: Colors.needleGreen,
  },
  stepNumberText: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
  },
  stepNumberTextActive: {
    color: Colors.textInverse,
  },
  stepChipText: {
    fontSize: 11,
    color: Colors.midGrey,
    fontWeight: FontWeight.medium,
  },
  stepChipTextActive: {
    color: Colors.needleGreen,
  },
  body: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  heroCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    backgroundColor: Colors.needleGreenLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    lineHeight: 28,
    fontFamily: Fonts.display,
  },
  heroCopy: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 19,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  sectionCopy: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: 2,
  },
  benefitIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
    flexShrink: 0,
  },
  benefitBody: {
    flex: 1,
    gap: 2,
  },
  benefitTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.ink,
  },
  benefitText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 17,
  },
  currencyList: {
    gap: Spacing.sm,
  },
  currencyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    ...Shadow.sm,
  },
  currencyCardUnavailable: {
    opacity: 0.58,
  },
  currencyCardActive: {
    borderColor: Colors.needleGreen,
    backgroundColor: Colors.needleGreenLight,
  },
  currencyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  currencyFlag: {
    fontSize: 22,
  },
  providerBadge: {
    borderRadius: Radius.full,
    backgroundColor: Colors.boneDeep,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  providerBadgeText: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    color: Colors.midGrey,
  },
  currencyCode: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    fontFamily: Fonts.display,
  },
  currencyName: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
  },
  currencyMeta: {
    fontSize: 11,
    color: Colors.midGrey,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  summaryLabel: {
    fontSize: 11,
    color: Colors.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.ink,
    fontWeight: FontWeight.medium,
    textAlign: 'right',
  },
  inlineInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.boneDeep,
    padding: Spacing.md,
  },
  inlineInfoText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.inkLight,
  },
  guardHint: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
    lineHeight: 18,
    textAlign: 'center',
  },
  selectedBankCard: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    gap: 3,
  },
  selectedBankLabel: {
    fontSize: 11,
    color: Colors.needleGreen,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: FontWeight.semibold,
  },
  selectedBankName: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  bankList: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    overflow: 'hidden',
  },
  bankListScroll: {
    maxHeight: 240,
  },
  bankRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
    backgroundColor: Colors.white,
  },
  bankRowActive: {
    backgroundColor: Colors.needleGreenLight,
  },
  manualBankRow: {
    backgroundColor: Colors.boneDeep,
  },
  manualBankRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bankRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bankLogoImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  bankLogoFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.boneDeep,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
  },
  bankLogoFallbackText: {
    fontSize: 11,
    color: Colors.needleGreen,
    fontWeight: FontWeight.bold,
  },
  manualBankIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreenLight,
  },
  bankRowText: {
    fontSize: FontSize.xs,
    color: Colors.ink,
  },
  bankRowMeta: {
    marginTop: 2,
    fontSize: 11,
    color: Colors.midGrey,
    lineHeight: 15,
  },
  bankRowTextActive: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  emptyBankText: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: FontSize.xs,
    color: Colors.midGrey,
  },
  manualForm: {
    gap: Spacing.sm,
  },
  countryField: {
    gap: 6,
  },
  countryLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.midGrey,
  },
  requiredMark: {
    color: Colors.kanteRust,
  },
  countrySelector: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  countrySelectorError: {
    borderColor: Colors.error,
  },
  countrySelectorText: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.ink,
  },
  countryList: {
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    overflow: 'hidden',
  },
  countryListScroll: {
    maxHeight: 220,
  },
  countryRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.lightGrey,
  },
  countryRowActive: {
    backgroundColor: Colors.needleGreenLight,
  },
  countryRowText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.ink,
  },
  countryRowTextActive: {
    color: Colors.needleGreen,
    fontWeight: FontWeight.semibold,
  },
  countryCodeText: {
    fontSize: 11,
    color: Colors.midGrey,
    fontWeight: FontWeight.semibold,
  },
  verifiedCard: {
    borderRadius: Radius.md,
    backgroundColor: Colors.needleGreenLight,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '30',
  },
  verifiedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  verifiedIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
  },
  verifiedTitle: {
    fontSize: FontSize.sm,
    color: Colors.ink,
    fontWeight: FontWeight.semibold,
  },
  verifiedMeta: {
    fontSize: 11,
    color: Colors.needleGreenDark,
  },
  verifiedName: {
    fontSize: FontSize.lg,
    color: Colors.ink,
    fontWeight: FontWeight.bold,
    fontFamily: Fonts.display,
  },
  verifiedAccountText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
  },
  compactActionMenuButton: {
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.lightGrey,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  compactActionMenuText: {
    color: Colors.needleGreen,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  checkText: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
  },
  errorText: {
    fontSize: FontSize.xs,
    color: Colors.error,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    backgroundColor: Colors.bone,
  },
  successWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  successOrb: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.needleGreen,
    ...Shadow.lg,
  },
  successOrbPending: {
    backgroundColor: Colors.warning,
  },
  successTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.ink,
    textAlign: 'center',
    fontFamily: Fonts.display,
  },
  successBody: {
    fontSize: FontSize.sm,
    color: Colors.inkLight,
    lineHeight: 21,
    textAlign: 'center',
  },
  successChecklist: {
    backgroundColor: Colors.needleGreenLight,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.needleGreen + '30',
  },
  pendingReviewCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.warning + '45',
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  pendingReviewHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  pendingReviewIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentLight,
  },
  pendingReviewCopy: {
    flex: 1,
    gap: 2,
  },
  pendingReviewStatus: {
    fontSize: FontSize.xs,
    color: Colors.inkLight,
  },
  actionDockPrimary: {
    flex: 1,
  },
  successCheckRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  successCheckText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.needleGreenDark,
    lineHeight: 18,
    fontWeight: FontWeight.medium,
  },
})
