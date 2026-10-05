import {
  DrapeActionBar,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
  DrapeInlineActionCard,
  DrapeMediaViewer,
  DrapeSheet,
  DrapeStatusChip,
  Input,
  MoneyInput,
  type MediaLightboxItem,
} from '@/components/ui'
import {
  CommercialBenefitsCard,
  type CommercialBenefitReservation,
} from '@/components/ui/CommercialBenefitsCard'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import { Colors } from '@/constants/theme'
import { baseAmount, fulfillmentFeeLabel } from '@/features/orders/customer/CustomerOrderAmounts'
import {
  quoteAmount,
  quoteDetailRow,
  quoteLabel,
  quoteValue,
  styles,
} from '@/features/orders/customer/CustomerOrderStyles'
import { SupportDisclosure } from '@/features/orders/customer/SupportDisclosure'
import { CustomerBriefDossierCard } from '@/features/orders/customer/CustomerBriefDossier'
import type { OpenQuoteRevision, OrderDetail } from '@/features/orders/customer/contracts'
import { STATIC_FALLBACK_RATES, formatAmount, useCurrency } from '@/lib/currency'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'
import { isLikelyConnectivityIssue, readFunctionErrorMessage } from '@/lib/function-errors'
import { minorUnitsFromInput, moneyInputFromMinorUnits } from '@/lib/money-input'
import { appendToHistory, goBackOrReturnTo } from '@/lib/navigation'
import { purgeTerminalOrderClientState } from '@/lib/order-client-state'
import { paymentRouteCopyForCurrency, useOrderPaymentFlow } from '@/lib/payments'
import { Sentry } from '@/lib/sentry'
import { invokeFunction, supabase } from '@/lib/supabase'
import {
  formatTaxRate,
  taxLinesForSnapshot,
  taxSnapshotNeedsRefresh,
  type AccountCurrencyCode,
} from '@drape/shared'
import { formatExplicitZonedDateTime } from '@drape/shared/date-time'
import type { BriefDossierSection } from '@drape/shared/order-brief-dossier'
import {
  QUOTE_REVISION_REASON_LABELS,
  deriveOrderConversationActions,
  type QuoteRevisionReason,
} from '@drape/shared/order-negotiation'
import { useFocusEffect, useNavigation, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  AppState,
  BackHandler,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const QUOTE_NEGOTIATION_UI_ENABLED = MOBILE_FEATURE_FLAGS.quoteNegotiationV1

export function QuoteReviewScreen({
  order,
  onAction,
  router,
  customerEmail,
  preferredTab,
  returnTarget,
  historyChain,
  initialAction,
  studioVersion,
  studioSection,
}: {
  order: OrderDetail
  onAction: () => Promise<void>
  router: ReturnType<typeof useRouter>
  customerEmail?: string
  preferredTab?: string
  returnTarget?: string
  historyChain?: string
  initialAction?: string
  studioVersion?: number | null
  studioSection?: BriefDossierSection
}) {
  const [studioMediaPreview, setStudioMediaPreview] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [revisionSheetVisible, setRevisionSheetVisible] = useState(false)
  const [revisionSaving, setRevisionSaving] = useState(false)
  const [revisionReasons, setRevisionReasons] = useState<QuoteRevisionReason[]>([])
  const [revisionNote, setRevisionNote] = useState('')
  const [revisionTargetAmount, setRevisionTargetAmount] = useState('')
  const [revisionError, setRevisionError] = useState('')
  const [openRevision, setOpenRevision] = useState<OpenQuoteRevision | null>(null)
  const [actionSheetVisible, setActionSheetVisible] = useState(false)
  const [benefitReservation, setBenefitReservation] = useState<CommercialBenefitReservation | null>(
    null
  )
  const initialActionHandledRef = useRef(false)
  const onActionRef = useRef(onAction)
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const { currency: accountCurrency } = useCurrency()
  const navigation = useNavigation()
  const { startOrderPayment } = useOrderPaymentFlow()
  const orderCurrency = order.quotedCurrency
  const orderReturnTab = preferredTab === 'completed' ? 'completed' : 'active'
  const currentOrderReturnTarget = `/(customer)/orders/${order.id}`
  const currentOrderHistoryChain = appendToHistory(historyChain, currentOrderReturnTarget)
  const negotiationAvailable =
    QUOTE_NEGOTIATION_UI_ENABLED && !!order.activeQuoteId && !!order.activeQuoteVersion

  const conversationActions = deriveOrderConversationActions({
    role: 'CUSTOMER',
    orderKind: order.orderKind,
    stage: order.stage,
    activeQuote:
      order.activeQuoteId && order.activeQuoteVersion
        ? { id: order.activeQuoteId, version: order.activeQuoteVersion, status: 'ACTIVE' }
        : null,
    openRevision: openRevision
      ? { id: openRevision.id, status: 'OPEN', roundNumber: openRevision.roundNumber }
      : null,
    negotiationRoundsUsed: order.negotiationRoundsUsed,
    negotiationRoundLimit: order.negotiationRoundLimit,
  })

  useEffect(() => {
    onActionRef.current = onAction
  }, [onAction])

  const goBack = useCallback(() => {
    goBackOrReturnTo(router, navigation, returnTarget, {
      pathname: '/(customer)/orders',
      params: { tab: preferredTab === 'completed' ? 'completed' : 'active' },
    })
  }, [navigation, preferredTab, returnTarget, router])

  const fetchOpenRevision = useCallback(async () => {
    if (!QUOTE_NEGOTIATION_UI_ENABLED || !order.activeQuoteId) {
      setOpenRevision(null)
      return
    }

    const { data, error } = await supabase
      .from('quote_revision_requests')
      .select('id, round_number, reason_codes, note, target_amount, currency')
      .eq('order_id', order.id)
      .eq('source_quote_id', order.activeQuoteId)
      .eq('status', 'OPEN')
      .maybeSingle()

    if (error || !data) {
      setOpenRevision(null)
      return
    }

    const next = {
      id: data.id as string,
      roundNumber: Number(data.round_number) || 1,
      reasonCodes: (Array.isArray(data.reason_codes)
        ? data.reason_codes
        : []) as QuoteRevisionReason[],
      note: typeof data.note === 'string' ? data.note : '',
      targetAmount: typeof data.target_amount === 'number' ? data.target_amount : null,
      currency: typeof data.currency === 'string' ? data.currency : order.quotedCurrency,
    }
    setOpenRevision(next)
  }, [order.activeQuoteId, order.id, order.quotedCurrency])

  useEffect(() => {
    void fetchOpenRevision()
  }, [fetchOpenRevision])

  useFocusEffect(
    useCallback(() => {
      const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goBack()
        return true
      })
      const refresh = () => {
        void Promise.all([onActionRef.current(), fetchOpenRevision()])
      }
      let poll: ReturnType<typeof setInterval> | null = null
      const startPolling = () => {
        if (poll || AppState.currentState !== 'active') return
        refresh()
        poll = setInterval(refresh, 60_000)
      }
      const stopPolling = () => {
        if (!poll) return
        clearInterval(poll)
        poll = null
      }
      const appStateSubscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') startPolling()
        else stopPolling()
      })
      startPolling()

      return () => {
        backSubscription.remove()
        stopPolling()
        appStateSubscription.remove()
      }
    }, [fetchOpenRevision, goBack])
  )

  useEffect(() => {
    if (initialActionHandledRef.current || !negotiationAvailable) return
    if (initialAction !== 'REQUEST_QUOTE_CHANGES' && initialAction !== 'EDIT_QUOTE_CHANGE_REQUEST')
      return
    if (initialAction === 'EDIT_QUOTE_CHANGE_REQUEST' && !openRevision) return
    initialActionHandledRef.current = true
    openRevisionEditor()
  }, [initialAction, openRevision])

  function openRevisionEditor() {
    setRevisionReasons(openRevision?.reasonCodes ?? [])
    setRevisionNote(openRevision?.note ?? '')
    setRevisionTargetAmount(moneyInputFromMinorUnits(openRevision?.targetAmount))
    setRevisionError('')
    setRevisionSheetVisible(true)
  }

  function toggleRevisionReason(reason: QuoteRevisionReason) {
    setRevisionReasons((current) =>
      current.includes(reason)
        ? current.filter((item) => item !== reason)
        : [...current, reason].slice(0, 4)
    )
  }

  async function saveRevisionRequest() {
    if (!order.activeQuoteId || !order.activeQuoteVersion) {
      setRevisionError('Refresh this order before requesting quote changes.')
      return
    }
    if (revisionReasons.length === 0) {
      setRevisionError('Choose at least one part of the quote that needs attention.')
      return
    }
    if (revisionNote.trim().length < 10) {
      setRevisionError('Explain the change you need in at least 10 characters.')
      return
    }

    const targetAmount = minorUnitsFromInput(revisionTargetAmount)
    if (targetAmount == null) {
      setRevisionError('Enter a valid target amount or leave it blank.')
      return
    }

    setRevisionSaving(true)
    setRevisionError('')
    const action = openRevision ? 'edit-quote-revision' : 'request-quote-revision'
    const { error } = await invokeFunction('customer-order-action', {
      body: {
        orderId: order.id,
        action,
        quoteId: order.activeQuoteId,
        expectedQuoteVersion: order.activeQuoteVersion,
        revisionRequestId: openRevision?.id,
        quoteRevisionReasons: revisionReasons,
        quoteRevisionNote: revisionNote.trim(),
        quoteTargetAmount: targetAmount > 0 ? targetAmount : undefined,
      },
    })
    setRevisionSaving(false)

    if (error) {
      setRevisionError(
        await readFunctionErrorMessage(error, 'Could not save this quote change request right now.')
      )
      return
    }

    setRevisionSheetVisible(false)
    await Promise.all([onAction(), fetchOpenRevision()])
  }

  function withdrawRevisionRequest() {
    if (!openRevision || !order.activeQuoteId || !order.activeQuoteVersion || revisionSaving) return
    Alert.alert(
      'Withdraw change request?',
      'The current quote will become actionable again. This round will not count because the tailor has not responded.',
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            setRevisionSaving(true)
            const { error } = await invokeFunction('customer-order-action', {
              body: {
                orderId: order.id,
                action: 'withdraw-quote-revision',
                quoteId: order.activeQuoteId,
                expectedQuoteVersion: order.activeQuoteVersion,
                revisionRequestId: openRevision.id,
              },
            })
            setRevisionSaving(false)
            if (error) {
              Alert.alert(
                'Could not withdraw request',
                await readFunctionErrorMessage(error, 'Please try again in a moment.')
              )
              return
            }
            setRevisionSheetVisible(false)
            await Promise.all([onAction(), fetchOpenRevision()])
          },
        },
      ]
    )
  }

  function replaceCurrentOrder() {
    router.replace({
      pathname: '/(customer)/orders/[id]',
      params: {
        id: order.id,
        tab: orderReturnTab,
        returnTo: returnTarget ?? currentOrderReturnTarget,
        historyChain: currentOrderHistoryChain,
      },
    })
  }
  const payableAmount = benefitReservation?.customer_due_amount ?? order.quotedAmount
  const totalLabel =
    payableAmount != null
      ? formatAmount(payableAmount, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)
      : 'Not available'
  const feeLabel =
    order.fulfillmentFee > 0
      ? formatAmount(order.fulfillmentFee, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)
      : null
  const accountCurrencyNote =
    accountCurrency === orderCurrency
      ? `This order is locked in ${orderCurrency}.`
      : `This order stays locked in ${orderCurrency}, even though your account default is now ${accountCurrency}.`
  const paymentRouteCopy = paymentRouteCopyForCurrency(orderCurrency)
  const consultationMeta = order.supportMeta.consultation ?? null
  const quoteBreakdown = order.supportMeta.quoteBreakdown ?? null
  const consultationCredit =
    typeof quoteBreakdown?.consultationCreditAmount === 'number'
      ? Math.max(quoteBreakdown.consultationCreditAmount, 0)
      : 0
  const quoteTaxNeedsRefresh = taxSnapshotNeedsRefresh(order)
  const quoteTaxLines = taxLinesForSnapshot({
    taxRegion: order.taxRegion,
    taxRateBps: order.taxRateBps,
    taxAmount: Math.max(order.taxAmount - order.importTaxAmount - order.dutyAmount, 0),
  })
  const hasFundedFabricAllocation =
    typeof quoteBreakdown?.tailoringAmount === 'number' &&
    typeof quoteBreakdown?.fabricAllowanceAmount === 'number'
  const hasDetailedQuoteBreakdown = Boolean(
    quoteBreakdown &&
    (hasFundedFabricAllocation ||
      typeof quoteBreakdown.laborAmount === 'number' ||
      typeof quoteBreakdown.sourcingAmount === 'number' ||
      typeof quoteBreakdown.rushAmount === 'number' ||
      quoteBreakdown.summary ||
      quoteBreakdown.included?.length ||
      quoteBreakdown.excluded?.length)
  )
  // Find the quote from stage updates or a separate quote field
  // The tailor's quote note is in the QUOTE_SENT stage update
  const quoteUpdate = order.stageUpdates.find((u) => u.stage === 'QUOTE_SENT')

  async function accept() {
    if (accepting || declining) return
    if (quoteTaxNeedsRefresh) {
      Alert.alert(
        'Updated tax needed',
        `${order.tailorName} needs to refresh this quote before you can pay. Your tailoring and fabric prices stay visible; only the outdated tax snapshot must be replaced.`
      )
      return
    }
    if (openRevision) {
      Alert.alert(
        'Quote changes still open',
        'Edit or withdraw your change request before accepting this quote.'
      )
      return
    }
    Alert.alert(
      'Accept and pay',
      feeLabel
        ? `Accept the quote from ${order.tailorName}? You will pay the full total of ${totalLabel} now, including the ${fulfillmentFeeLabel(order).toLowerCase()} of ${feeLabel}.\n\n${paymentRouteCopy ?? 'You’ll be taken to secure payment now.'}\n\nProduction starts after payment succeeds.`
        : `Pay ${totalLabel} for ${order.tailorName}’s quote?\n\n${paymentRouteCopy ?? 'You’ll be taken to secure payment now.'}\n\nStandard dispatch is already reflected here when it applies. Extra delivery or shipping payments should only appear later for rush or exception handling.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            if (accepting || declining) return
            setAccepting(true)
            try {
              const result = await startOrderPayment({
                orderId: order.id,
                customerEmail,
                quoteId: order.activeQuoteId,
                expectedQuoteVersion: order.activeQuoteVersion,
              })
              await onAction()

              if (!result.ok) {
                if (result.reason === 'cancelled') {
                  Alert.alert(
                    'Payment not finished',
                    'Your quote is still saved. Finish payment from the order screen any time.'
                  )
                  replaceCurrentOrder()
                  return
                }

                if (result.stage === 'PAYMENT_FAILED') {
                  Alert.alert(
                    'Payment failed',
                    `${result.message}\n\nRetry from the order screen within 2 hours to keep this quote alive.`
                  )
                  replaceCurrentOrder()
                  return
                }

                Sentry.captureException(new Error(result.message), {
                  extra: {
                    context: 'accept_quote_payment',
                    orderId: order.id,
                    reason: result.reason,
                  },
                })
                Alert.alert('Payment unavailable', result.message)
                return
              }

              replaceCurrentOrder()
            } catch (error) {
              Sentry.captureException(error, {
                extra: { context: 'accept_quote_payment_unhandled', orderId: order.id },
              })
              Alert.alert(
                'Payment unavailable',
                isLikelyConnectivityIssue(error)
                  ? 'Connection looks weak. Your card has not been charged. Retry payment from this order when the signal improves.'
                  : 'Something went wrong before payment could finish. Your card has not been charged. Please try again.'
              )
            } finally {
              setAccepting(false)
            }
          },
        },
      ]
    )
  }

  async function decline() {
    if (declining || accepting) return
    Alert.alert('Decline quote', 'Decline this quote? The order will be closed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          if (declining || accepting) return
          setDeclining(true)
          const { error } = await invokeFunction('customer-order-action', {
            body: {
              orderId: order.id,
              action: 'decline-quote',
              quoteId: order.activeQuoteId ?? undefined,
              expectedQuoteVersion: order.activeQuoteVersion ?? undefined,
            },
          })
          setDeclining(false)
          if (error) {
            const message = isLikelyConnectivityIssue(error)
              ? 'Connection looks weak. We could not decline this quote yet. Retry when the signal improves.'
              : await readFunctionErrorMessage(
                  error,
                  'Could not decline this quote right now. Please try again in a moment.'
                )
            Alert.alert('Could not decline quote', message)
            return
          }
          await purgeTerminalOrderClientState({
            orderId: order.id,
            sellerItemId: order.sellerItemId,
          })
          router.replace({
            pathname: '/(customer)/orders',
            params: { tab: preferredTab === 'completed' ? 'completed' : 'active' },
          })
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 280 }}
        {...capsuleNavScroll}
      >
        <View style={styles.content}>
          <View>
            <Text style={styles.heading}>{order.garmentType}</Text>
            <Text style={styles.subheading}>
              Quote from {order.tailorName} · #{order.reference}
            </Text>
          </View>

          {negotiationAvailable ? (
            <DrapeInlineActionCard
              eyebrow={
                conversationActions.revisionRoundsUsed === 0
                  ? 'Original quote'
                  : `Revision ${conversationActions.revisionRoundsUsed} of ${conversationActions.revisionRoundLimit}`
              }
              title={openRevision ? 'Changes requested' : 'Review this quote'}
              body={
                openRevision
                  ? `${order.tailorName.split(' ')[0]} is reviewing your requested changes.`
                  : conversationActions.revisionLimitReached
                    ? 'Continue in chat, or accept or decline this quote.'
                    : 'Ask questions in chat, or submit a formal change request.'
              }
              icon="file-text"
            >
              {openRevision ? (
                <DrapeStatusChip label="Awaiting tailor response" tone="warning" />
              ) : null}
            </DrapeInlineActionCard>
          ) : null}

          {/* Quote card */}
          <View
            style={[
              styles.statusCard,
              { borderWidth: 1.5, borderColor: Colors.needleGreen + '40' },
            ]}
            testID="quote-received-card"
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={styles.sectionTitle}>Quote received</Text>
              <Text style={styles.stateEyebrow}>{orderCurrency}</Text>
            </View>

            {hasFundedFabricAllocation ? (
              <>
                <View style={quoteDetailRow}>
                  <Text style={quoteLabel}>Tailoring and construction</Text>
                  <Text style={quoteAmount}>
                    {formatAmount(
                      quoteBreakdown!.tailoringAmount!,
                      orderCurrency,
                      orderCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  </Text>
                </View>
                <View style={quoteDetailRow}>
                  <Text style={quoteLabel}>Protected fabric allowance</Text>
                  <Text style={quoteAmount}>
                    {formatAmount(
                      quoteBreakdown!.fabricAllowanceAmount!,
                      orderCurrency,
                      orderCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  </Text>
                </View>
                <Text style={styles.quoteFootnote}>
                  The fabric allowance stays protected. Drapeon releases only approved, evidenced
                  fabric costs and returns any unused amount to you.
                </Text>
              </>
            ) : (
              baseAmount(order) != null && (
                <View style={quoteDetailRow}>
                  <Text style={quoteLabel}>
                    {order.orderKind === 'READY_MADE'
                      ? 'Item subtotal'
                      : 'Tailor work and included materials'}
                  </Text>
                  <Text style={quoteAmount}>
                    {formatAmount(
                      (baseAmount(order) ?? 0) + consultationCredit,
                      orderCurrency,
                      orderCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  </Text>
                </View>
              )
            )}

            {consultationCredit > 0 ? (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Consultation fee credit</Text>
                <Text style={quoteValue}>
                  −
                  {formatAmount(
                    consultationCredit,
                    orderCurrency,
                    orderCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              </View>
            ) : null}

            {order.platformFeeAmount > 0 ? (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Drapeon service fee</Text>
                <Text style={quoteValue}>
                  {formatAmount(
                    order.platformFeeAmount,
                    orderCurrency,
                    orderCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              </View>
            ) : null}

            <View style={quoteDetailRow}>
              <Text style={quoteLabel}>Subtotal before tax</Text>
              <Text style={quoteValue}>
                {formatAmount(
                  order.subtotalAmount + order.platformFeeAmount + order.shippingAmount,
                  orderCurrency,
                  orderCurrency,
                  STATIC_FALLBACK_RATES
                )}
              </Text>
            </View>

            <View style={quoteDetailRow}>
              <Text style={quoteLabel}>{fulfillmentFeeLabel(order)}</Text>
              <Text style={quoteValue}>
                {order.fulfillmentFee > 0
                  ? formatAmount(
                      order.fulfillmentFee,
                      orderCurrency,
                      orderCurrency,
                      STATIC_FALLBACK_RATES
                    )
                  : 'Free'}
              </Text>
            </View>

            {quoteTaxLines.map((line) => (
              <View style={quoteDetailRow} key={line.key}>
                <Text style={quoteLabel}>
                  {order.taxFallback ? `Estimated ${line.label}` : line.label} (
                  {formatTaxRate(line.rateBps)})
                </Text>
                <Text style={quoteValue}>
                  {formatAmount(line.amount, orderCurrency, orderCurrency, STATIC_FALLBACK_RATES)}
                </Text>
              </View>
            ))}
            {order.importTaxAmount > 0 ? (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Import tax</Text>
                <Text style={quoteValue}>
                  {formatAmount(
                    order.importTaxAmount,
                    orderCurrency,
                    orderCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              </View>
            ) : null}
            {order.dutyAmount > 0 ? (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Customs duty</Text>
                <Text style={quoteValue}>
                  {formatAmount(
                    order.dutyAmount,
                    orderCurrency,
                    orderCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              </View>
            ) : null}

            {order.quotedAmount != null && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Total due</Text>
                <Text style={quoteAmount}>
                  {formatAmount(
                    order.quotedAmount,
                    orderCurrency,
                    orderCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              </View>
            )}

            {order.taxFallback ? (
              <Text style={styles.quoteFootnote}>
                Tax was estimated because live tax lookup was unavailable for this delivery address.
              </Text>
            ) : null}

            {quoteTaxNeedsRefresh ? (
              <View style={styles.inlineWarningCard}>
                <Text style={styles.inlineWarningTitle}>Tax update required</Text>
                <Text style={styles.inlineWarningBody}>
                  This quote used an older Ghana tax snapshot. It cannot be paid until the tailor
                  refreshes it with the current VAT and statutory levies.
                </Text>
              </View>
            ) : null}

            {order.consultationFee != null && consultationCredit <= 0 && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Consultation fee</Text>
                <Text style={quoteValue}>
                  {formatAmount(
                    order.consultationFee,
                    orderCurrency,
                    orderCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              </View>
            )}

            {order.quotedCompletionDate && (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Est. completion</Text>
                <Text style={quoteValue}>
                  {new Date(order.quotedCompletionDate).toLocaleDateString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
              </View>
            )}

            {order.quoteExpiresAt ? (
              <View style={quoteDetailRow}>
                <Text style={quoteLabel}>Quote valid until</Text>
                <Text style={quoteValue}>{formatExplicitZonedDateTime(order.quoteExpiresAt)}</Text>
              </View>
            ) : null}
          </View>

          {hasDetailedQuoteBreakdown || quoteUpdate?.note ? (
            <SupportDisclosure
              title="Quote details"
              summary={
                hasDetailedQuoteBreakdown && quoteUpdate?.note
                  ? `Breakdown, inclusions, and note from ${order.tailorName.split(' ')[0]}`
                  : hasDetailedQuoteBreakdown
                    ? 'Breakdown and inclusions'
                    : `Note from ${order.tailorName.split(' ')[0]}`
              }
              defaultExpanded={false}
            >
              {hasDetailedQuoteBreakdown && quoteBreakdown ? (
                <View style={{ gap: 6 }}>
                  {typeof quoteBreakdown.laborAmount === 'number' ? (
                    <View style={quoteDetailRow}>
                      <Text style={quoteLabel}>Labour</Text>
                      <Text style={quoteValue}>
                        {formatAmount(
                          quoteBreakdown.laborAmount,
                          orderCurrency,
                          orderCurrency,
                          STATIC_FALLBACK_RATES
                        )}
                      </Text>
                    </View>
                  ) : null}
                  {typeof quoteBreakdown.sourcingAmount === 'number' ? (
                    <View style={quoteDetailRow}>
                      <Text style={quoteLabel}>Sourcing</Text>
                      <Text style={quoteValue}>
                        {formatAmount(
                          quoteBreakdown.sourcingAmount,
                          orderCurrency,
                          orderCurrency,
                          STATIC_FALLBACK_RATES
                        )}
                      </Text>
                    </View>
                  ) : null}
                  {typeof quoteBreakdown.rushAmount === 'number' ? (
                    <View style={quoteDetailRow}>
                      <Text style={quoteLabel}>Rush fee</Text>
                      <Text style={quoteValue}>
                        {formatAmount(
                          quoteBreakdown.rushAmount,
                          orderCurrency,
                          orderCurrency,
                          STATIC_FALLBACK_RATES
                        )}
                      </Text>
                    </View>
                  ) : null}
                  {quoteBreakdown.fabricAllowanceCoverage?.length ? (
                    <Text style={styles.escrowNoteText}>
                      Fabric allowance covers:{' '}
                      {quoteBreakdown.fabricAllowanceCoverage
                        .map((item) => item.toLowerCase().replaceAll('_', ' '))
                        .join(', ')}
                    </Text>
                  ) : null}
                  {quoteBreakdown.fabricSourcingAssumptions ? (
                    <View style={{ gap: 4 }}>
                      <Text style={quoteLabel}>Sourcing assumptions</Text>
                      <Text style={styles.statusNote}>
                        {quoteBreakdown.fabricSourcingAssumptions}
                      </Text>
                    </View>
                  ) : null}
                  {quoteBreakdown.summary ? (
                    <Text style={styles.statusNote}>{quoteBreakdown.summary}</Text>
                  ) : null}
                  {quoteBreakdown.included && quoteBreakdown.included.length > 0 ? (
                    <Text style={styles.escrowNoteText}>
                      Included: {quoteBreakdown.included.join(', ')}
                    </Text>
                  ) : null}
                  {quoteBreakdown.excluded && quoteBreakdown.excluded.length > 0 ? (
                    <Text style={styles.escrowNoteText}>
                      Not included: {quoteBreakdown.excluded.join(', ')}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {quoteUpdate?.note ? (
                <View style={{ gap: 4 }}>
                  <Text style={quoteLabel}>Note from {order.tailorName.split(' ')[0]}</Text>
                  <Text style={styles.statusNote}>"{quoteUpdate.note}"</Text>
                </View>
              ) : null}
            </SupportDisclosure>
          ) : null}

          {studioVersion && studioSection ? (
            <SupportDisclosure
              title={`Sketch Room look · version ${studioVersion}`}
              summary="Review the current sheet and design directions before accepting."
              defaultExpanded={false}
            >
              <CustomerBriefDossierCard
                section={studioSection}
                defaultExpanded
                onOpenLink={(href) => { void Linking.openURL(href) }}
                onOpenMedia={(items, index) => setStudioMediaPreview({ items, index })}
              />
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => router.push({
                  pathname: '/studio',
                  params: { returnTo: currentOrderReturnTarget, orderRevision: order.id },
                })}
              >
                <Text style={styles.supportBodyText}>Revise this Sketch Room design →</Text>
              </TouchableOpacity>
            </SupportDisclosure>
          ) : null}

          <CommercialBenefitsCard
            orderId={order.id}
            currency={orderCurrency}
            variant="checkout"
            onChanged={setBenefitReservation}
          />

          <SupportDisclosure
            title="Payment and currency"
            summary={`${orderCurrency} order · Checkout and payment protection`}
            defaultExpanded={false}
          >
            <Text style={styles.supportBodyText}>{accountCurrencyNote}</Text>
            {paymentRouteCopy ? (
              <Text style={styles.supportBodyText}>{paymentRouteCopy}</Text>
            ) : null}
            <Text style={styles.supportBodyText}>
              {consultationMeta?.feeCreditable && order.consultationFee
                ? 'Your consultation fee counts toward this order. Accepting locks the price and target date, and Drapeon holds payment until delivery is confirmed.'
                : 'Accepting locks the price and target date. Drapeon holds payment until delivery is confirmed; raise any problem inside the order.'}
            </Text>
          </SupportDisclosure>
        </View>
      </ScrollView>

      <DrapeMediaViewer
        items={studioMediaPreview?.items ?? []}
        activeIndex={studioMediaPreview?.index ?? null}
        onDismiss={() => setStudioMediaPreview(null)}
      />

      <DrapeFloatingActionDock compactWidth={76} testID="quote-action-dock">
        {(compact) =>
          compact ? (
            <DrapeIconButton
              icon={negotiationAvailable && openRevision ? 'edit-3' : 'lock'}
              accessibilityLabel={
                negotiationAvailable && openRevision ? 'Edit change request' : 'Accept and pay'
              }
              tone="primary"
              onPress={negotiationAvailable && openRevision ? openRevisionEditor : accept}
              disabled={
                negotiationAvailable && openRevision
                  ? revisionSaving
                  : accepting || declining || !!openRevision
              }
            />
          ) : (
            <DrapeActionBar style={styles.quoteActionBar}>
              {negotiationAvailable && openRevision ? (
                <DrapeCapsuleButton
                  label="Edit change request"
                  icon="edit-3"
                  onPress={openRevisionEditor}
                  disabled={revisionSaving}
                  style={styles.quotePrimaryAction}
                />
              ) : (
                <DrapeCapsuleButton
                  label="Accept and pay"
                  icon="lock"
                  onPress={accept}
                  loading={accepting}
                  disabled={accepting || declining || !!openRevision || quoteTaxNeedsRefresh}
                  style={styles.quotePrimaryAction}
                  testID="quote-accept-btn"
                />
              )}
              <DrapeIconButton
                icon="more-horizontal"
                accessibilityLabel="More quote actions"
                onPress={() => setActionSheetVisible(true)}
                disabled={accepting || declining}
              />
            </DrapeActionBar>
          )
        }
      </DrapeFloatingActionDock>

      <DrapeSheet
        visible={actionSheetVisible}
        title="Quote actions"
        subtitle="Ask a question, request a formal revision, or close this quote."
        onDismiss={() => setActionSheetVisible(false)}
        primaryAction={
          negotiationAvailable && !openRevision && !conversationActions.revisionLimitReached
            ? {
                label: 'Request changes',
                tone: 'secondary',
                testID: 'quote-request-changes-btn',
                onPress: () => {
                  setActionSheetVisible(false)
                  openRevisionEditor()
                },
                disabled: accepting || declining,
              }
            : undefined
        }
        secondaryAction={{
          label: `Message ${order.tailorName.split(' ')[0]}`,
          tone: 'secondary',
          onPress: () => {
            setActionSheetVisible(false)
            router.navigate({
              pathname: '/(customer)/messages/[orderId]',
              params: {
                orderId: order.id,
                returnTo: `/(customer)/orders/${order.id}`,
                historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
              },
            })
          },
          disabled: accepting || declining,
        }}
        destructiveAction={{
          label: 'Decline quote',
          tone: 'destructive',
          onPress: () => {
            setActionSheetVisible(false)
            void decline()
          },
          loading: declining,
          disabled: accepting || declining,
        }}
      >
        {null}
      </DrapeSheet>

      <DrapeSheet
        visible={revisionSheetVisible}
        testID="quote-revision-sheet"
        title={openRevision ? 'Edit quote changes' : 'Request quote changes'}
        subtitle={`Revision ${openRevision?.roundNumber ?? Math.min(order.negotiationRoundsUsed + 1, order.negotiationRoundLimit)} of ${order.negotiationRoundLimit}. Ordinary chat questions do not use a revision.`}
        onDismiss={() => setRevisionSheetVisible(false)}
        scrollable
        snapPoints={['88%']}
        enableDynamicSizing={false}
        primaryAction={{
          label: openRevision ? 'Save request' : 'Send change request',
          testID: 'quote-revision-submit-btn',
          onPress: () => {
            void saveRevisionRequest()
          },
          loading: revisionSaving,
          disabled: revisionSaving,
          tone: 'primary',
        }}
        destructiveAction={
          openRevision
            ? {
                label: 'Withdraw request',
                onPress: withdrawRevisionRequest,
                disabled: revisionSaving,
                tone: 'destructive',
              }
            : undefined
        }
      >
        <View style={styles.revisionReasonList}>
          <Text style={styles.revisionFieldLabel}>What should change?</Text>
          <View style={styles.revisionReasonGrid}>
            {(Object.keys(QUOTE_REVISION_REASON_LABELS) as QuoteRevisionReason[]).map((reason) => {
              const selected = revisionReasons.includes(reason)
              return (
                <DrapeCapsuleButton
                  key={reason}
                  label={QUOTE_REVISION_REASON_LABELS[reason]}
                  tone={selected ? 'primary' : 'secondary'}
                  compact
                  onPress={() => toggleRevisionReason(reason)}
                  style={styles.revisionReasonButton}
                  accessibilityState={{ selected }}
                  testID={`quote-revision-reason-${reason.toLowerCase()}`}
                />
              )
            })}
          </View>
        </View>
        <Input
          label="Change details"
          value={revisionNote}
          onChangeText={setRevisionNote}
          placeholder="Explain what should change and what outcome would work for you."
          multiline
          maxLength={1200}
          showCharacterCount
          required
          filterContact
          testID="quote-revision-note-input"
        />
        <MoneyInput
          label="Target total"
          value={revisionTargetAmount}
          onChangeText={setRevisionTargetAmount}
          currency={orderCurrency as AccountCurrencyCode}
          hint="This is a request, not a binding price. The tailor must issue a revised quote."
          testID="quote-revision-target-input"
        />
        {revisionError ? (
          <Text style={styles.revisionError} accessibilityRole="alert">
            {revisionError}
          </Text>
        ) : null}
      </DrapeSheet>
    </SafeAreaView>
  )
}
