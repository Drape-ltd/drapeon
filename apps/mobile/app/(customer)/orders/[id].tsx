import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  RefreshControl,
  BackHandler,
  AppState,
} from 'react-native'
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  useNavigation,
} from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { DrapeDateTimePicker as DateTimePicker } from '@/components/ui/DrapeDateTimePicker'
import { ConsultationAttendancePanel } from '@/components/ui/ConsultationAttendancePanel'
import { CommercialReceiptCard } from '@/components/ui/CommercialReceiptCard'
import { FabricWorkflowCard } from '@/components/ui/FabricWorkflowCard'
import { TaxDecisionSummaryCard } from '@/components/ui/TaxDecisionSummaryCard'
import { ConsultationReschedulePanel } from '@/components/ui/ConsultationReschedulePanel'
import { ConsultationLifecyclePanel } from '@/components/ui/ConsultationLifecyclePanel'
import { CommercialAdjustmentCard } from '@/components/ui/CommercialAdjustmentCard'
import { SettlementProgressCard } from '@/components/ui/SettlementProgressCard'
import { DrapeonDispatchCard } from '@/components/ui/DrapeonDispatchCard'
import { ReturnResolutionCard } from '@/components/ui/ReturnResolutionCard'
import { OpsRefundStatusCard } from '@/components/ui/OpsRefundStatusCard'
import {
  CommercialBenefitsCard,
  type CommercialBenefitReservation,
} from '@/components/ui/CommercialBenefitsCard'
import { OrderTipCard } from '@/components/ui/OrderTipCard'
import * as ImagePicker from 'expo-image-picker'
import { Feather } from '@expo/vector-icons'
import { formatExplicitZonedDateTime } from '@drape/shared/date-time'
import {
  formatCallCountdown,
  getCallLifecycleState,
  deriveFulfillmentAwareHistoryLabel,
  materialReconciliationCopy,
  recommendedSchedulingStartDate,
} from '@drape/shared'
import { supabase, invokeFunction } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { Sentry } from '@/lib/sentry'
import { uploadPublicStorageImage } from '@/lib/storage-upload'
import { launchImagePickerSafely, preferCompatibleVideoRepresentation } from '@/lib/image-picker-safe'
import { openTrackingPage } from '@/lib/shipping'
import { shareGroupOrderInvite } from '@/lib/invite'
import {
  isLikelyConnectivityIssue,
  isMachineErrorCodeMessage,
  readFunctionErrorMessage,
  readFunctionErrorPayload,
} from '@/lib/function-errors'
import {
  CANCELLATION_REVIEW_REASON_LABELS,
  CONSULTATION_EXPIRY_POLICY_LABELS,
  CONSULTATION_NO_SHOW_POLICY_LABELS,
  CONSULTATION_PAYMENT_TIMING_LABELS,
  CONSULTATION_RESCHEDULE_POLICY_LABELS,
  COVERAGE_PREFERENCE_LABELS,
  DELIVERY_REVIEW_REASON_LABELS,
  enrichMeasurementSnapshot,
  DISPATCH_SERVICE_LEVEL_LABELS,
  FABRIC_HANDOFF_LABELS,
  FABRIC_STRETCH_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_INTENT_LABELS,
  getMeasurementConfirmationFields,
  labelMeasurementField,
  measurementGuideForField,
  MATERIAL_ISSUE_REASON_LABELS,
  MATERIAL_ISSUE_RESPONSE_LABELS,
  measurementAgeLabel,
  MEASUREMENT_SOURCE_LABELS,
  resolveMeasurementAgeMeta,
  STALE_MEASUREMENT_MONTHS,
  WEAR_DAY_SUPPORT_LABELS,
  hasOpenCancellationReview,
  hasOpenDeliveryReview,
  hasOpenMaterialIssue,
  hasOpenScopeChange,
  isShippingFabricHandoff,
  parseOrderSupportMeta,
  withConsultationBookingFallback,
  SCOPE_CHANGE_IMPACT_LABELS,
  SCOPE_CHANGE_TYPE_LABELS,
  type CancellationReviewReason,
  type DeliveryReviewReason,
  type MaterialIssueResponse,
  type OrderSupportMeta,
  type ScopeChangeImpact,
  type ScopeChangeType,
} from '@/lib/order-support'
import {
  CUSTOMER_COMPLETED_ORDER_STAGES,
  customerOrderStageLabel,
  isReadyMadePreparationStage,
} from '@/lib/order-flow'
import {
  fetchOpenHandoffIssue,
  handoffHelpCardBody,
  handoffHelpCardTitle,
  handoffIssueLabel,
  handoffIssueStatusLabel,
  resolveHandoffIssue,
  type HandoffIssue,
} from '@/lib/handoff-support'
import {
  Button,
  DrapeActionBar,
  DrapeCapsuleButton,
  DrapeFloatingActionDock,
  DrapeIconButton,
  DrapeInlineActionCard,
  DrapeMediaMosaic,
  DrapeMediaViewer,
  DrapeSheet,
  DrapeStatusChip,
  HandoffSupportModal,
  Input,
  MoneyInput,
  type DrapeMediaMosaicItem,
  type MediaLightboxItem,
} from '@/components/ui'
import {
  isVideoUri,
  ORDER_EVIDENCE_VIDEO_MAX_BYTES,
  ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
  orderEvidenceContentType,
  orderEvidenceExtension,
  StageMediaPreview,
  validateOrderEvidenceAsset,
} from '@/features/orders/customer/OrderEvidenceMedia'
import type {
  GroupMember,
  GroupMemberListResponse,
  MaterialAdvance,
  MaterialAdvanceStatus,
  MeasurementSnapshot,
  OpenQuoteRevision,
  OrderDetail,
  StageUpdate,
} from '@/features/orders/customer/contracts'
import {
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  ALLOWED_VIDEO_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
} from '@drape/shared/media-policy'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import {
  buildBriefDossier,
  formatConsultationStatusLabel,
  formatMaterialAdvanceStatusLabel,
  formatMeasurementStatusLabel,
  formatScopeChangeStatusLabel,
  isFabricApprovalEvidence,
  latestFabricApprovalEvidence,
  orderHistorySummary,
  sourcedFabricDecisionFromNote,
  MATERIAL_ADVANCE_DECLINE_REASONS,
  MATERIAL_ADVANCE_DECLINE_REASON_LABELS,
  materialAdvanceDeclineReasonLabel,
  formatTaxRate,
  taxLinesForSnapshot,
  taxSnapshotNeedsRefresh,
  type AccountCurrencyCode,
  type DispatchFulfillmentPresentation,
  type MaterialAdvanceDeclineReason,
  styleAlignmentChangeFeedbackFromUpdates,
  styleAlignmentDecisionFromNote,
  styleAlignmentEventFromNote,
} from '@drape/shared'
import { type OrderStage } from '@drape/shared/order-machine'
import {
  QUOTE_REVISION_REASON_LABELS,
  deriveOrderConversationActions,
  type QuoteRevisionReason,
} from '@drape/shared/order-negotiation'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { decodeDisplayText } from '@drape/shared/display-text'
import {
  CUSTOMER_CONCERN_REASONS,
  CUSTOMER_CONCERN_REASON_LABELS,
  FINANCIAL_CASE_REQUESTED_OUTCOMES,
  FINANCIAL_CASE_REQUESTED_OUTCOME_LABELS,
  evidencePromptsForConcern,
  type CustomerConcernReason,
  type FinancialCaseRequestedOutcome,
} from '@drape/shared/financial-cases'
import {
  CANCELLATION_REFUND_COMPONENT_LABELS,
  deriveCancellationPolicy,
} from '@drape/shared/cancellation-policy'
import { useCurrency, formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { paymentRouteCopyForCurrency, useOrderPaymentFlow } from '@/lib/payments'
import { minorUnitsFromInput, moneyInputFromMinorUnits } from '@/lib/money-input'
import { isTerminalOrderStage, purgeTerminalOrderClientState } from '@/lib/order-client-state'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'
import { CustomerBriefDossierCard } from '@/features/orders/customer/CustomerBriefDossier'
import { ConsultationRescheduleModal } from '@/features/orders/customer/ConsultationRescheduleModal'
import { CustomerConsultationRequestModal } from '@/features/orders/customer/CustomerConsultationRequestModal'
import { baseAmount, fulfillmentFeeLabel } from '@/features/orders/customer/CustomerOrderAmounts'
import { SupportDisclosure } from '@/features/orders/customer/SupportDisclosure'
import { QuoteReviewScreen } from '@/features/orders/customer/QuoteReviewScreen'
import { SUPPORT_EMAIL, AFTERCARE_WINDOW_DAYS, AFTERCARE_WINDOW_MS, ORDER_DETAIL_POLL_INTERVAL_MS, asStringList, formatReadableDate, formatTimelineTimestamp, formatOrderUpdateNote, timelineStageLabel, timelineDotColor, getAftercareStatus, CUSTOM_PROGRESS_STAGES, READY_MADE_PROGRESS_STAGES, PRE_PRODUCTION_STAGES, PRE_CUTTING_STAGES, SCOPE_CHANGE_STAGES, CUSTOM_PROGRESS_LABELS, progressStagesForOrder, progressLabel, isHandoffCompleteStage, stageIndex, handoffOpsButtonLabel, stageGuidance, refundCoverageLabel, preProductionLabel, taxLabelForOrder, fulfillmentOptionLabel, pendingFulfillmentPaymentLabel, hasPendingFulfillmentPayment, safeOperationalText, displayText, displayNullableText } from '@/features/orders/customer/CustomerOrderPresentation'
import { AftercareSupportModal, CancellationReviewModal, DeliveryReviewModal, DisputeModal, EmergencySupportModal, MaterialIssueResponseModal, ScopeChangeModal } from '@/features/orders/customer/CustomerOrderDialogs'
import { disputeStyles } from '@/features/orders/customer/CustomerDisputeStyles'
import { defaultConsultationStart, formatConsultationStart } from '@/features/orders/customer/CustomerOrderFormatting'
import { quoteAmount, quoteDetailRow, quoteLabel, quoteValue, styles } from '@/features/orders/customer/CustomerOrderStyles'

type OrderStageUpdateRow = {
  id: string
  stage: string
  note: string | null
  photo_url: string | null
  evidence_media: unknown
  created_at: string
}

async function resolvedStageUpdateMedia(row: Pick<OrderStageUpdateRow, 'photo_url' | 'evidence_media'>) {
  if (row.photo_url) return row.photo_url
  if (!Array.isArray(row.evidence_media)) return null
  const asset = row.evidence_media.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined
  const path = typeof asset?.displayPath === 'string' ? asset.displayPath : typeof asset?.originalPath === 'string' ? asset.originalPath : null
  if (!path) return null
  const { data, error } = await supabase.storage.from('commercial-evidence').createSignedUrl(path, 10 * 60)
  return error ? null : data?.signedUrl ?? null
}

async function resolveProductionEvidenceUrls(values: string[]) {
  return (await Promise.all(values.map(async (value) => {
    if (/^https?:\/\//iu.test(value)) return value
    if (!value.includes('/production/')) return null
    const { data, error } = await supabase.storage.from('commercial-evidence').createSignedUrl(value, 10 * 60)
    return error ? null : data?.signedUrl ?? null
  }))).filter((value): value is string => !!value)
}

type CustomOrderDetailRow = {
  garment_type_other: string | null
  gender_presentation: string | null
  social_reference_links: unknown
  style_notes: string | null
  body_note: string | null
  fabric_approval_required: boolean | null
  fabric_approval_status: string | null
  fabric_description: string | null
  fabric_budget_amount: number | null
  fabric_budget_currency: string | null
  fabric_sourcing_deadline_days: number | null
  fabric_sourcing_deadline_at: string | null
  shipping_preference: string | null
  delivery_instructions: string | null
  target_delivery_date: string | null
}

type TailorProfileJoinRow = {
  display_name: string | null
  location: string | null
}

type OrderQueryRow = {
  id: string
  reference: string | null
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  seller_item_id: string | null
  fulfillment_option: string | null
  garment_type: string | null
  garment_description: string | null
  occasion: string | null
  deadline: string | null
  item_title: string | null
  item_size: string | null
  item_quantity: number | null
  item_subtotal: number | null
  stage: OrderStage
  tailor_id: string
  quoted_amount: number | null
  currency: string | null
  quoted_currency: string | null
  consultation_fee: number | null
  fulfillment_fee: number | null
  quoted_completion_date: string | null
  quote_expires_at: string | null
  source_currency: string | null
  source_amount: number | null
  subtotal_amount: number | null
  platform_fee_amount: number | null
  tax_amount: number | null
  import_tax_amount: number | null
  duty_amount: number | null
  tax_rate_bps: number | null
  tax_region: string | null
  tax_fallback: boolean | null
  tax_fallback_reason: string | null
  shipping_amount: number | null
  total_amount: number | null
  fulfillment_payment_requested_at: string | null
  fulfillment_payment_paid_at: string | null
  fulfillment_payment_provider: string | null
  fulfillment_payment_intent_id: string | null
  fulfillment_payment_checkout_url: string | null
  fabric_source: string | null
  fabric_funding_policy_version: string | null
  delivery_method: string | null
  delivery_address: string | null
  recipient_name: string | null
  recipient_phone: string | null
  fabric_tracking: string | null
  tracking_number: string | null
  carrier: string | null
  fulfillment_provider: string | null
  fulfillment_reference: string | null
  fulfillment_contact_name: string | null
  fulfillment_contact_phone: string | null
  reference_photos: unknown
  collection_code: string | null
  collection_code_expiry: string | null
  video_call_url: string | null
  handoff_completed_at: string | null
  customer_handoff_confirmed_at: string | null
  special_note: string | null
  customer_measurements_snapshot: Record<string, unknown> | null
  created_at: string
  tailor_profiles: TailorProfileJoinRow | TailorProfileJoinRow[] | null
  custom_order_details: CustomOrderDetailRow | CustomOrderDetailRow[] | null
  order_stage_updates: OrderStageUpdateRow[] | null
  active_quote_id: string | null
  active_quote_version: number | null
  negotiation_round_limit: number | null
  negotiation_rounds_used: number | null
}

function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function wearerLabelFromOrder(
  meta: OrderSupportMeta | null | undefined,
  snapshot: Record<string, unknown> | null | undefined
) {
  const fromMeta = meta?.wearerContext?.label?.trim()
  if (fromMeta) return fromMeta
  const snapshotContext =
    snapshot?.wearerContext && typeof snapshot.wearerContext === 'object' && !Array.isArray(snapshot.wearerContext)
      ? (snapshot.wearerContext as { label?: unknown })
      : null
  if (typeof snapshotContext?.label === 'string' && snapshotContext.label.trim()) {
    return snapshotContext.label.trim()
  }
  return typeof snapshot?.measurementProfileLabel === 'string' && snapshot.measurementProfileLabel.trim()
    ? snapshot.measurementProfileLabel.trim()
    : null
}

function normalizeExternalHref(value: string) {
  return /^https?:\/\//iu.test(value) ? value : `https://${value}`
}

function dossierMediaItems(label: string, mediaUrls: string[]): MediaLightboxItem[] {
  return mediaUrls.slice(0, 6).map((uri, index) => ({
    uri,
    label: `${label} ${index + 1}`,
    kind: isVideoUri(uri) ? 'video' : 'photo',
    bucket: isVideoUri(uri) ? undefined : 'order-photos',
  }))
}



export default function OrderTrackingScreen() {
  const { id, sent, placed, tab, returnTo, historyChain, action, advanceId } = useLocalSearchParams<{
    id: string
    sent?: string
    placed?: string
    tab?: string
    returnTo?: string
    historyChain?: string
    action?: string
    advanceId?: string
  }>()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const capsuleNavScroll = useDrapeCapsuleNavScroll()
  const { user } = useAuth()
  const userId = user?.id

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [consultationClockMs, setConsultationClockMs] = useState(() => Date.now())
  const loadedOrderIdRef = useRef<string | null>(null)

  function fallbackTab(stage?: OrderStage | null): 'active' | 'completed' {
    if (tab === 'active' || tab === 'completed') return tab
    if (stage && CUSTOMER_COMPLETED_ORDER_STAGES.includes(stage)) {
      return 'completed'
    }
    return 'active'
  }
  const explicitReturnPath = pickSafeReturnTo(historyChain, returnTo)

  function goBack() {
    if (sent === '1') {
      router.replace({ pathname: '/(customer)/orders', params: { tab: 'active' } })
      return
    }
    if (placed === '1') {
      router.replace({ pathname: '/(customer)/orders', params: { tab: 'active' } })
      return
    }
    goBackOrReturnTo(
      router,
      navigation,
      explicitReturnPath,
      { pathname: '/(customer)/orders', params: { tab: fallbackTab(order?.stage) } },
    )
  }

  useContextualBackHandler(goBack)

  useEffect(() => {
    const timer = setInterval(() => setConsultationClockMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchErrorMessage, setFetchErrorMessage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [paying, setPaying] = useState(false)
  const [showDispute, setShowDispute] = useState(false)
  const [showCancellationReview, setShowCancellationReview] = useState(false)
  const [showDeliveryReview, setShowDeliveryReview] = useState(false)
  const [showMaterialIssueResponse, setShowMaterialIssueResponse] = useState(false)
  const [showScopeChange, setShowScopeChange] = useState(false)
  const [showHandoffSupport, setShowHandoffSupport] = useState(false)
  const [showAftercareSupport, setShowAftercareSupport] = useState(false)
  const [showCustomerConsultation, setShowCustomerConsultation] = useState(false)
  const [showConsultationReschedule, setShowConsultationReschedule] = useState(false)
  const [consultationReschedulePending, setConsultationReschedulePending] = useState(false)
  const [consultationRescheduleRequired, setConsultationRescheduleRequired] = useState(false)
  const [fabricTracking, setFabricTracking] = useState('')
  const [approvingFabric, setApprovingFabric] = useState(false)
  const [fabricChangeNote, setFabricChangeNote] = useState('')
  const [approvingStyle, setApprovingStyle] = useState(false)
  const [styleChangeNote, setStyleChangeNote] = useState('')
  const [showStyleCorrection, setShowStyleCorrection] = useState(false)
  const [showStyleChangeFeedback, setShowStyleChangeFeedback] = useState(false)
  const [showEmergencySupport, setShowEmergencySupport] = useState(false)
  const [savingFabric, setSavingFabric] = useState(false)
  const [confirmingMeasurements, setConfirmingMeasurements] = useState(false)
  const [hasReview, setHasReview] = useState(false)
  const [reviewCheckComplete, setReviewCheckComplete] = useState(false)
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false)
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false)
  const [dispatchHandoffComplete, setDispatchHandoffComplete] = useState(false)
  const [dispatchFulfillmentState, setDispatchFulfillmentState] = useState<DispatchFulfillmentPresentation | null>(null)
  const completionPromptShownRef = useRef(false)
  const [handoffIssue, setHandoffIssue] = useState<HandoffIssue | null>(null)
  const [materialAdvances, setMaterialAdvances] = useState<MaterialAdvance[]>([])
  const [respondingAdvanceId, setRespondingAdvanceId] = useState<string | null>(null)
  const [decliningAdvance, setDecliningAdvance] = useState<MaterialAdvance | null>(null)
  const [materialAdvanceDeclineReason, setMaterialAdvanceDeclineReason] = useState<MaterialAdvanceDeclineReason>('FIND_CHEAPER_OPTION')
  const [materialAdvanceDeclineNote, setMaterialAdvanceDeclineNote] = useState('')
  const [materialAdvanceConfirmation, setMaterialAdvanceConfirmation] = useState<{
    decision: 'APPROVE' | 'DECLINE'
    title: string
    detail: string
  } | null>(null)
  const [payingAdvanceId, setPayingAdvanceId] = useState<string | null>(null)
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [productionEvidenceMedia, setProductionEvidenceMedia] = useState<string[]>([])
  const [fabricEvidenceMedia, setFabricEvidenceMedia] = useState<string[]>([])
  const [fabricApprovalHistoryMedia, setFabricApprovalHistoryMedia] = useState<string[]>([])
  const [mediaPreview, setMediaPreview] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null)
  const [startingConsultationCall, setStartingConsultationCall] = useState<
    'audio' | 'video' | null
  >(null)
  const [resolvingHandoffIssue, setResolvingHandoffIssue] = useState(false)
  const { startOrderPayment, startMaterialAdvancePayment } = useOrderPaymentFlow()

  const openDossierLink = useCallback(async (href: string) => {
    try {
      await Linking.openURL(normalizeExternalHref(href))
    } catch {
      Alert.alert('Could not open link', 'Please try again in a moment.')
    }
  }, [])

  const openMediaPreview = useCallback((items: MediaLightboxItem[], index: number) => {
    setMediaPreview({ items, index })
  }, [])
  const purgedTerminalOrderRef = useRef<string | null>(null)

  function openOrderMessages() {
    if (!order) return
    router.navigate({
      pathname: '/(customer)/messages/[orderId]',
      params: {
        orderId: order.id,
        returnTo: `/(customer)/orders/${order.id}`,
        historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
      },
    })
  }

  function askToRescheduleConsultation() {
    if (!order) return
    setShowConsultationReschedule(true)
  }

  async function startConsultationCall(callType: 'audio' | 'video') {
    if (!order || startingConsultationCall) return
    setStartingConsultationCall(callType)
    try {
      router.push({
        pathname: '/call-join',
        params: {
          orderId: order.id,
          callKind: 'consultation',
          callType,
          historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
        },
      })
    } finally {
      setStartingConsultationCall(null)
    }
  }

  async function contactSupport(kind: 'general' | 'aftercare' = 'general') {
    const fallbackSubject = `${kind === 'aftercare' ? 'Aftercare help' : 'Order help'}: #${order?.reference ?? id}`
    const subject = encodeURIComponent(fallbackSubject)
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${subject}`
    const supported = await Linking.canOpenURL(mailto)
    if (!supported) {
      Alert.alert(
        'Unable to open email',
        `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}", and keep the live order updated here so support can follow the full timeline.`
      )
      return
    }

    try {
      await Linking.openURL(mailto)
    } catch {
      Alert.alert(
        'Unable to open email',
        `Please email ${SUPPORT_EMAIL} directly with the subject "${fallbackSubject}", and keep the live order updated here so support can follow the full timeline.`
      )
    }
  }

  const fetchOrder = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true
      // Route focus can beat auth hydration on cold/deep-link entry. Do not send
      // an undefined customer id to PostgREST; the callback reruns when auth is ready.
      if (!id || !userId) return
      const shouldReplaceSurface = !silent && loadedOrderIdRef.current !== id
      if (shouldReplaceSurface) {
        setLoading(true)
        setOrder(null)
        setMaterialAdvances([])
        setProductionEvidenceMedia([])
        setFabricEvidenceMedia([])
        setFabricApprovalHistoryMedia([])
      }
      setFetchErrorMessage('')
      try {
        const [orderRes, reviewRes] = await Promise.allSettled([
          supabase
            .from('orders')
            .select(
              `
            id, reference, order_kind, seller_item_id, fulfillment_option, garment_type, garment_description, occasion, deadline, item_title, item_size, item_quantity, item_subtotal, stage,
            tailor_id, tailor_profile_id, quoted_amount, currency, quoted_currency, consultation_fee, fulfillment_fee, quoted_completion_date,
            active_quote_id, active_quote_version, negotiation_round_limit, negotiation_rounds_used, quote_expires_at,
            source_currency, source_amount, subtotal_amount, platform_fee_amount, tax_amount, import_tax_amount, duty_amount, tax_rate_bps, tax_region, tax_fallback, tax_fallback_reason, shipping_amount, total_amount,
            fulfillment_payment_requested_at, fulfillment_payment_paid_at, fulfillment_payment_provider, fulfillment_payment_intent_id, fulfillment_payment_checkout_url,
            fabric_source, fabric_funding_policy_version, delivery_method, delivery_address, recipient_name, recipient_phone, fabric_tracking, tracking_number, carrier,
            fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, reference_photos,
            collection_code, collection_code_expiry, video_call_url, handoff_completed_at, customer_handoff_confirmed_at, special_note, customer_measurements_snapshot, created_at,
            tailor_profiles!tailor_profile_id(display_name, location),
            custom_order_details(garment_type_other, gender_presentation, social_reference_links, style_notes, body_note, fabric_approval_required, fabric_approval_status, fabric_description, fabric_budget_amount, fabric_budget_currency, fabric_sourcing_deadline_days, fabric_sourcing_deadline_at, shipping_preference, delivery_instructions, target_delivery_date),
            order_stage_updates(id, stage, note, photo_url, evidence_media, created_at)
          `
            )
            .eq('id', id)
            .eq('customer_id', userId)
            .order('created_at', { ascending: true, referencedTable: 'order_stage_updates' })
            .maybeSingle(),
          supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('order_id', id),
        ])

        const orderError = orderRes.status === 'fulfilled' ? orderRes.value.error : orderRes.reason

        if (orderError) {
          const databaseError = orderError as {
            code?: string
            details?: string
            hint?: string
            message?: string
          }
          const normalizedError = new Error(
            databaseError.message || 'The order query failed.',
          )
          Object.assign(normalizedError, {
            name: 'OrderFetchError',
            cause: databaseError,
          })
          Sentry.captureException(normalizedError, {
            tags: { operation: 'fetchOrder', databaseCode: databaseError.code ?? 'unknown' },
            extra: {
              orderId: id,
              details: databaseError.details,
              hint: databaseError.hint,
            },
          })
          throw normalizedError
        }

        const data = orderRes.status === 'fulfilled' ? orderRes.value.data : null
        if (reviewRes.status === 'fulfilled' && !reviewRes.value.error) {
          setHasReview((reviewRes.value.count ?? 0) > 0)
          setReviewCheckComplete(true)
        } else {
          // Do not present a duplicate review prompt when review state is unknown.
          setReviewCheckComplete(false)
        }

        if (data) {
          const d = data as OrderQueryRow
          const openHandoffIssue = await fetchOpenHandoffIssue(d.id)
          let pickupAddress: string | null = null
          let pickupInstructions: string | null = null

          if (d.delivery_method === 'LOCAL_COLLECTION' && d.tailor_id) {
            const { data: pickupData } = await supabase
              .from('tailor_pickup_details')
              .select('pickup_address, pickup_instructions')
              .eq('user_id', d.tailor_id)
              .maybeSingle()

            pickupAddress =
              typeof pickupData?.pickup_address === 'string' ? pickupData.pickup_address : null
            pickupInstructions =
              typeof pickupData?.pickup_instructions === 'string'
                ? pickupData.pickup_instructions
                : null
          }

          setFabricTracking(d.fabric_tracking ?? '')
          setHandoffIssue(openHandoffIssue)
          let supportMeta = parseOrderSupportMeta(displayText(d.special_note))
          if (!supportMeta.consultation && d.stage === 'CONSULTATION') {
            const { data: consultationBooking } = await supabase
              .from('consultation_bookings')
              .select('status, scheduled_start_at, scheduled_end_at, fee_mode, fee_amount, fee_currency, fee_creditable, payment_status, paid_at, call_type, policy_version')
              .eq('order_id', d.id)
              .eq('status', 'CONFIRMED')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            supportMeta = withConsultationBookingFallback(supportMeta, consultationBooking)
          }
          const shouldLoadGroupMembers = supportMeta.bulkOrder?.enabled === true
          const groupMemberRows = shouldLoadGroupMembers
            ? (await invokeFunction<GroupMemberListResponse>('group-member-action', {
                body: { action: 'list', orderId: d.id },
                timeoutMs: 10_000,
              })).data?.members ?? []
            : []
          const { data: materialAdvanceRows } = await supabase
            .from('order_material_advances')
            .select('id, title, description, amount, currency, status, release_status, estimate_storage_bucket, estimate_storage_path, receipt_url, receipt_storage_bucket, receipt_storage_path, acquired_storage_bucket, acquired_storage_path, reconciliation_status, reconciliation_outcome, reconciliation_resolution, customer_refund_amount, unapproved_overage_amount, receipt_note, customer_response_note, customer_response_reason, created_at, funding_source, provider_release_status')
            .eq('order_id', d.id)
            .order('created_at', { ascending: false })
          const { data: productionEvidenceRows, error: productionEvidenceError } = await supabase
            .from('order_production_evidence')
            .select('stage_key, photo_urls, metadata, created_at')
            .eq('order_id', d.id)
            .order('created_at', { ascending: true })
          if (productionEvidenceError) {
            Sentry.captureException(productionEvidenceError, { extra: { context: 'customer_order_production_evidence', orderId: d.id } })
          }
          setProductionEvidenceMedia(await resolveProductionEvidenceUrls(Array.from(new Set(
            (productionEvidenceRows ?? []).flatMap((row) => asStringList(row.photo_urls)),
          ))))
          const latestFabricEvidence = latestFabricApprovalEvidence(productionEvidenceRows ?? [])
          setFabricApprovalHistoryMedia(Array.from(new Set(
            (productionEvidenceRows ?? [])
              .filter((row) => isFabricApprovalEvidence({ stageKey: row.stage_key, metadata: row.metadata }))
              .flatMap((row) => asStringList(row.photo_urls)),
          )))
          setFabricEvidenceMedia(Array.from(new Set(
            asStringList(latestFabricEvidence?.photo_urls),
          )))
          setGroupMembers(groupMemberRows)
          setMaterialAdvances(
            ((materialAdvanceRows ?? []) as Array<{
              id: string
              title: string | null
              description: string | null
              amount: number | null
              currency: string | null
              status: string | null
              release_status: string | null
              estimate_storage_bucket: string | null
              estimate_storage_path: string | null
              receipt_url: string | null
              receipt_storage_bucket: string | null
              receipt_storage_path: string | null
              acquired_storage_bucket: string | null
              acquired_storage_path: string | null
              reconciliation_status: string | null
              reconciliation_outcome: string | null
              reconciliation_resolution: string | null
              customer_refund_amount: number | null
              unapproved_overage_amount: number | null
              receipt_note: string | null
              customer_response_note: string | null
              customer_response_reason: string | null
              created_at: string | null
              funding_source: string | null
              provider_release_status: string | null
            }>).map((advance) => ({
              id: advance.id,
              title: displayText(advance.title, 'Material advance'),
              description: displayText(advance.description),
              amount: advance.amount ?? 0,
              currency: (advance.currency ?? d.currency ?? d.quoted_currency ?? 'USD') as CurrencyCode,
              status: (advance.status ?? 'REQUESTED') as MaterialAdvanceStatus,
              releaseStatus: advance.release_status ?? null,
              estimateStorageBucket: advance.estimate_storage_bucket ?? null,
              estimateStoragePath: advance.estimate_storage_path ?? null,
              receiptUrl: advance.receipt_url ?? null,
              receiptStorageBucket: advance.receipt_storage_bucket ?? null,
              receiptStoragePath: advance.receipt_storage_path ?? null,
              acquiredStorageBucket: advance.acquired_storage_bucket ?? null,
              acquiredStoragePath: advance.acquired_storage_path ?? null,
              reconciliationStatus: advance.reconciliation_status ?? null,
              reconciliationOutcome: advance.reconciliation_outcome ?? null,
              reconciliationResolution: advance.reconciliation_resolution ?? null,
              customerRefundAmount: advance.customer_refund_amount ?? 0,
              unapprovedOverageAmount: advance.unapproved_overage_amount ?? 0,
              receiptNote: displayNullableText(advance.receipt_note),
              customerResponseNote: displayNullableText(advance.customer_response_note),
              customerResponseReason: advance.customer_response_reason ?? null,
              createdAt: advance.created_at ?? new Date().toISOString(),
              fundingSource: advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE' ? 'FUNDED_FABRIC_ALLOWANCE' : 'LEGACY_SEPARATE_PAYMENT',
              providerReleaseStatus: advance.provider_release_status ?? null,
            }))
          )
          const tailorProfile = firstJoinedRow(d.tailor_profiles)
          const customDetail = firstJoinedRow(d.custom_order_details)
          const resolvedStageUpdates = await Promise.all((d.order_stage_updates ?? []).map(async (u) => ({
            id: u.id,
            stage: u.stage,
            note: displayNullableText(u.note),
            photoUrl: await resolvedStageUpdateMedia(u),
            createdAt: u.created_at,
          })))
          setOrder({
            id: d.id,
            reference: d.reference ?? d.id,
            orderKind: d.order_kind ?? 'CUSTOM',
            sellerItemId: d.seller_item_id ?? null,
            fulfillmentOption: d.fulfillment_option ?? null,
            garmentType: displayText(d.garment_type, 'Order'),
            garmentDescription: displayNullableText(d.garment_description),
            occasion: displayNullableText(d.occasion),
            deadline: d.deadline ?? null,
            itemTitle: displayNullableText(d.item_title),
            itemSize: d.item_size ?? null,
            itemQuantity: d.item_quantity ?? 1,
            itemSubtotal: d.item_subtotal ?? null,
            fulfillmentFee: d.fulfillment_fee ?? 0,
            subtotalAmount: d.subtotal_amount ?? d.item_subtotal ?? 0,
            platformFeeAmount: d.platform_fee_amount ?? 0,
            taxAmount: d.tax_amount ?? 0,
            importTaxAmount: d.import_tax_amount ?? 0,
            dutyAmount: d.duty_amount ?? 0,
            taxRateBps: d.tax_rate_bps ?? 0,
            taxRegion: d.tax_region ?? null,
            taxFallback: d.tax_fallback ?? false,
            taxFallbackReason: d.tax_fallback_reason ?? null,
            shippingAmount: d.shipping_amount ?? d.fulfillment_fee ?? 0,
            totalAmount: d.total_amount ?? d.quoted_amount ?? 0,
            sourceCurrency: (d.source_currency ?? null) as CurrencyCode | null,
            sourceAmount: d.source_amount ?? null,
            stage: d.stage,
            tailorId: d.tailor_id,
            tailorName: displayText(tailorProfile?.display_name, ''),
            tailorLocation: displayNullableText(tailorProfile?.location),
            pickupAddress: displayNullableText(pickupAddress),
            pickupInstructions: displayNullableText(pickupInstructions),
            quotedAmount: d.quoted_amount,
            quotedCurrency: (d.currency ?? d.quoted_currency ?? 'USD') as CurrencyCode,
            consultationFee: d.consultation_fee ?? null,
            quotedCompletionDate: d.quoted_completion_date,
            quoteExpiresAt: d.quote_expires_at ?? null,
            activeQuoteId: d.active_quote_id ?? null,
            activeQuoteVersion: d.active_quote_version ?? null,
            negotiationRoundLimit: d.negotiation_round_limit ?? 3,
            negotiationRoundsUsed: d.negotiation_rounds_used ?? 0,
            fulfillmentPaymentRequestedAt: d.fulfillment_payment_requested_at ?? null,
            fulfillmentPaymentPaidAt: d.fulfillment_payment_paid_at ?? null,
            fulfillmentPaymentProvider: d.fulfillment_payment_provider ?? null,
            fulfillmentPaymentIntentId: d.fulfillment_payment_intent_id ?? null,
            fulfillmentPaymentCheckoutUrl: d.fulfillment_payment_checkout_url ?? null,
            fabricSource: d.fabric_source ?? '',
            fabricFundingPolicyVersion: d.fabric_funding_policy_version ?? null,
            deliveryMethod: d.delivery_method ?? '',
            deliveryAddress: displayNullableText(d.delivery_address),
            recipientName: displayNullableText(d.recipient_name),
            recipientPhone: d.recipient_phone ?? null,
            fabricTracking: d.fabric_tracking,
            trackingNumber: d.tracking_number ?? null,
            carrier: d.carrier ?? null,
            fulfillmentProvider: displayNullableText(d.fulfillment_provider),
            fulfillmentReference: displayNullableText(d.fulfillment_reference),
            fulfillmentContactName: displayNullableText(d.fulfillment_contact_name),
            fulfillmentContactPhone: d.fulfillment_contact_phone ?? null,
            referencePhotos: asStringList(d.reference_photos),
            collectionCode: d.collection_code,
            collectionCodeExpiry: d.collection_code_expiry ?? null,
            videoCallUrl: d.video_call_url ?? null,
            handoffCompletedAt: d.handoff_completed_at ?? null,
            customerHandoffConfirmedAt: d.customer_handoff_confirmed_at ?? null,
            measurementSnapshot: enrichMeasurementSnapshot(
              d.customer_measurements_snapshot ?? null
            ) as MeasurementSnapshot | null,
            supportMeta,
            customDetail: customDetail
              ? {
                  garmentTypeOther: displayNullableText(customDetail.garment_type_other),
                  genderPresentation: displayNullableText(customDetail.gender_presentation),
                  socialReferenceLinks: asStringList(customDetail.social_reference_links),
                  styleNotes: displayNullableText(customDetail.style_notes),
                  bodyNote: displayNullableText(customDetail.body_note),
                  fabricApprovalRequired: customDetail.fabric_approval_required === true,
                  fabricApprovalStatus: customDetail.fabric_approval_status ?? null,
                  fabricDescription: displayNullableText(customDetail.fabric_description),
                  fabricBudgetAmount: customDetail.fabric_budget_amount ?? null,
                  fabricBudgetCurrency: customDetail.fabric_budget_currency ?? null,
                  fabricSourcingDeadlineDays: customDetail.fabric_sourcing_deadline_days ?? null,
                  fabricSourcingDeadlineAt: customDetail.fabric_sourcing_deadline_at ?? null,
                  shippingPreference: displayNullableText(customDetail.shipping_preference),
                  deliveryInstructions: displayNullableText(customDetail.delivery_instructions),
                  targetDeliveryDate: customDetail.target_delivery_date ?? null,
                }
              : null,
            stageUpdates: resolvedStageUpdates,
            createdAt: d.created_at,
          })
          loadedOrderIdRef.current = d.id
        } else {
          if (shouldReplaceSurface) {
            setHandoffIssue(null)
            setGroupMembers([])
            setOrder(null)
          }
        }
        if (shouldReplaceSurface) setLoading(false)
      } catch (error) {
        if (silent) {
          if (!(error instanceof Error && error.name === 'OrderFetchError')) {
            Sentry.captureException(error, {
              extra: { context: 'customer_order_realtime_refresh', orderId: id },
            })
          }
          return
        }
        if (!shouldReplaceSurface && loadedOrderIdRef.current === id) {
          if (!(error instanceof Error && error.name === 'OrderFetchError')) {
            Sentry.captureException(error, {
              extra: { context: 'customer_order_background_refresh', orderId: id },
            })
          }
          return
        }
        setFetchErrorMessage(
          isLikelyConnectivityIssue(error)
            ? 'Connection is weak. We could not load this order yet. Retry when the signal improves, or reopen it from Orders later.'
            : 'We could not load this order right now. Retry, or reopen it from your Orders list.'
        )
        setHandoffIssue(null)
        setGroupMembers([])
        setMaterialAdvances([])
        setOrder(null)
        setLoading(false)
      }
    },
    [id, setFabricTracking, setOrder, userId]
  )
  const fetchOrderRef = useRef(fetchOrder)
  const ensuredCollectionCredentialRef = useRef<string | null>(null)

  useEffect(() => {
    fetchOrderRef.current = fetchOrder
  }, [fetchOrder])

  useEffect(() => {
    if (
      !order
      || order.stage !== 'READY_FOR_COLLECTION'
      || order.deliveryMethod !== 'LOCAL_COLLECTION'
      || ensuredCollectionCredentialRef.current === order.id
    ) return
    const expiry = order.collectionCodeExpiry ? Date.parse(order.collectionCodeExpiry) : Number.NaN
    if (Number.isFinite(expiry) && expiry > Date.now()) return

    ensuredCollectionCredentialRef.current = order.id
    void invokeFunction('customer-order-action', {
      body: {
        action: 'refresh-collection-code',
        orderId: order.id,
        force: false,
      },
    }).then(({ error }) => {
      if (error) throw error
      return fetchOrderRef.current({ silent: true })
    }).catch(() => {
      ensuredCollectionCredentialRef.current = null
    })
  }, [order])

  useEffect(() => {
    completionPromptShownRef.current = false
    setReviewCheckComplete(false)
    setShowCompletionPrompt(false)
    setDispatchModalOpen(false)
    setDispatchHandoffComplete(false)
  }, [id])

  useEffect(() => {
    if (
      !order ||
      !reviewCheckComplete ||
      hasReview ||
      (!isHandoffCompleteStage(order.stage) && !dispatchHandoffComplete) ||
      dispatchModalOpen ||
      completionPromptShownRef.current
    ) return

    const timer = setTimeout(() => {
      completionPromptShownRef.current = true
      setShowCompletionPrompt(true)
    }, 450)
    return () => clearTimeout(timer)
  }, [dispatchHandoffComplete, dispatchModalOpen, hasReview, order, reviewCheckComplete])

  async function shareGroupInvite(member: GroupMember) {
    const { error } = await invokeFunction('group-member-action', {
      body: { action: 'mark-invited', memberId: member.id },
    })
    if (error) {
      Alert.alert(
        'Invite not ready',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not prepare this invite yet.'
          : await readFunctionErrorMessage(error, 'We could not prepare this invite right now.'),
      )
      return
    }
    setGroupMembers((prev) =>
      prev.map((item) => (item.id === member.id && item.status !== 'ACCEPTED' ? { ...item, status: 'INVITED' } : item))
    )
    await shareGroupOrderInvite(member.inviteCode, member.displayName, order?.reference ?? '')
  }

  async function handleRefresh() {
    setRefreshing(true)
    await fetchOrder()
    setRefreshing(false)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchOrder()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchOrder])

  useEffect(() => {
    if (!order || !isTerminalOrderStage(order.stage)) return
    const purgeKey = `${order.id}:${order.stage}`
    if (purgedTerminalOrderRef.current === purgeKey) return
    purgedTerminalOrderRef.current = purgeKey
    void purgeTerminalOrderClientState({
      orderId: order.id,
      customerId: userId ?? null,
      sellerItemId: order.sellerItemId,
    })
  }, [order, userId])

  useFocusEffect(
    useCallback(() => {
      void fetchOrderRef.current()
    }, [])
  )

  useFocusEffect(useCallback(() => {
    if (!id || !user?.id) return
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const scheduleSilentRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void fetchOrder({ silent: true })
      }, 250)
    }

    const startPolling = () => {
      if (pollTimer || AppState.currentState !== 'active') return
      pollTimer = setInterval(scheduleSilentRefresh, ORDER_DETAIL_POLL_INTERVAL_MS)
    }
    const stopPolling = () => {
      if (!pollTimer) return
      clearInterval(pollTimer)
      pollTimer = null
    }
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        scheduleSilentRefresh()
        startPolling()
      } else {
        stopPolling()
      }
    })
    startPolling()

    const channel = supabase
      .channel(`customer-order-detail:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'custom_order_details', filter: `order_id=eq.${id}` },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_stage_updates',
          filter: `order_id=eq.${id}`,
        },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'order_stage_updates',
          filter: `order_id=eq.${id}`,
        },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_quotes', filter: `order_id=eq.${id}` },
        scheduleSilentRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quote_revision_requests', filter: `order_id=eq.${id}` },
        scheduleSilentRefresh
      )
      .subscribe()

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      stopPolling()
      appStateSubscription.remove()
      void supabase.removeChannel(channel)
    }
  }, [fetchOrder, id, user?.id]))

  async function markHandoffIssueResolved() {
    if (!handoffIssue || resolvingHandoffIssue) return
    setResolvingHandoffIssue(true)
    const result = await resolveHandoffIssue(
      handoffIssue.id,
      'Resolved from customer order screen.'
    )
    setResolvingHandoffIssue(false)
    if (result.error) {
      Alert.alert('Could not close help thread', result.error)
      return
    }
    await fetchOrder()
  }

  async function uploadReceiptProof(source: 'camera' | 'library') {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Take quick delivery proof before confirming receipt.')
        return null
      }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('Media access needed', 'Choose delivery proof before confirming receipt.')
        return null
      }
    }

    const result = await launchImagePickerSafely(
      () =>
        source === 'camera'
          ? ImagePicker.launchCameraAsync({
              mediaTypes: ['images', 'videos'],
              quality: 0.85,
              videoMaxDuration: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
            })
          : ImagePicker.launchImageLibraryAsync(
              preferCompatibleVideoRepresentation({
                mediaTypes: ['images', 'videos'],
                quality: 0.85,
                videoMaxDuration: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
              })
            ),
      {
        context: 'customer_order_receipt_proof_picker',
        mediaLabel: 'delivery proof media file',
        extra: { source, orderId: order?.id, userId: user?.id },
      }
    )
    if (!result) return null

    if (result.canceled || !result.assets?.[0]) return null
    const asset = result.assets[0]
    const validationError = validateOrderEvidenceAsset(asset)
    if (validationError) {
      Alert.alert('Video not added', validationError)
      return null
    }
    const contentType = orderEvidenceContentType(asset)
    const extension = orderEvidenceExtension(contentType)
    return uploadPublicStorageImage({
      bucket: 'order-photos',
      path: `receipts/${id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${extension}`,
      uri: asset.uri,
      contentType,
      maxBytes: (ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)
        ? ORDER_EVIDENCE_VIDEO_MAX_BYTES
        : MEDIA_LIMITS_BYTES.image,
      allowedContentTypes: ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
      purpose: 'ORDER_REFERENCE',
    })
  }

  async function confirmReceiptWithProof(source: 'camera' | 'library') {
    if (confirming) return
    setConfirming(true)
    try {
      const receiptPhotoUrl = await uploadReceiptProof(source)
      if (!receiptPhotoUrl) {
        setConfirming(false)
        return
      }
      const { error } = await invokeFunction('customer-order-action', {
        body: { orderId: id, action: 'confirm-receipt', receiptPhotoUrl },
      })
      setConfirming(false)
      if (error) {
        Sentry.captureException(error, { extra: { context: 'confirm_receipt', orderId: id } })
        const message = isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not confirm receipt yet. Retry when the signal improves.'
          : await readFunctionErrorMessage(
              error,
              'Could not confirm receipt. Please try again.'
            )
        Alert.alert('Could not confirm receipt', message)
      } else {
        const reviewReturnTarget = `/(customer)/orders/${id}`
        router.replace({
          pathname: '/(customer)/review/[orderId]',
          params: {
            orderId: id,
            returnTo: reviewReturnTarget,
            historyChain: appendToHistory(historyChain, reviewReturnTarget),
          },
        })
      }
    } catch (error) {
      setConfirming(false)
      Sentry.captureException(error, { extra: { context: 'confirm_receipt_upload', orderId: id } })
      Alert.alert(
        'Proof media not saved',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your receipt was not confirmed yet.'
          : 'We could not upload the delivery proof. Please try again.',
      )
    }
  }

  async function confirmReceipt() {
    if (confirming) return
    Alert.alert(
      'Confirm with proof',
      'Add a quick photo of the item in hand before closing delivery. If a neighbour, receptionist, or courier says it was delivered but you have not seen it, raise a concern first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose photo',
          style: 'default',
          onPress: () => void confirmReceiptWithProof('library'),
        },
        {
          text: 'Take photo',
          style: 'default',
          onPress: () => void confirmReceiptWithProof('camera'),
        },
      ]
    )
  }

  async function saveFabricTracking() {
    if (savingFabric) return
    if (!fabricTracking.trim()) return
    if (filterContactInfo(fabricTracking).blocked) {
      Alert.alert(
        'Tracking number blocked',
        "Use the carrier tracking number only. Contact details can't be included here."
      )
      return
    }
    setSavingFabric(true)
    const { error, data } = await invokeFunction<{ ok: boolean; fabricTracking?: string }>(
      'customer-order-action',
      {
        body: {
          orderId: id,
          action: 'save-fabric-tracking',
          fabricTracking: fabricTracking.trim(),
        },
      }
    )
    setSavingFabric(false)
    if (error) {
      Sentry.captureException(error, { extra: { context: 'save_fabric_tracking', orderId: id } })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save this tracking detail yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not save tracking number. Please try again.')
      Alert.alert('Could not save tracking number', message)
    } else {
      const nextValue = data?.fabricTracking ?? fabricTracking.trim()
      setFabricTracking(nextValue)
      setOrder((prev) => (prev ? { ...prev, fabricTracking: nextValue } : prev))
    }
  }

  async function decideSourcedFabric(
    action: 'approve-sourced-fabric' | 'request-sourced-fabric-change'
  ) {
    if (approvingFabric) return
    if (action === 'request-sourced-fabric-change' && fabricChangeNote.trim().length < 5) {
      Alert.alert(
        'Add a note',
        'Tell the tailor what should change before requesting another fabric option.'
      )
      return
    }

    setApprovingFabric(true)
    const { error, data } = await invokeFunction<{ ok: boolean; fabricApprovalStatus?: string }>(
      'customer-order-action',
      {
        body: {
          orderId: id,
          action,
          note: action === 'request-sourced-fabric-change' ? fabricChangeNote.trim() : undefined,
        },
      }
    )
    setApprovingFabric(false)

    if (error) {
      Sentry.captureException(error, { extra: { context: action, orderId: id } })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save your fabric decision yet.'
        : await readFunctionErrorMessage(
            error,
            'Could not save your fabric decision. Please try again.'
          )
      Alert.alert('Fabric decision not saved', message)
      return
    }

    const nextStatus =
      data?.fabricApprovalStatus ??
      (action === 'approve-sourced-fabric' ? 'APPROVED' : 'CHANGES_REQUESTED')
    setFabricChangeNote('')
    setOrder((prev) =>
      prev
        ? {
            ...prev,
            customDetail: prev.customDetail
              ? { ...prev.customDetail, fabricApprovalStatus: nextStatus }
              : prev.customDetail,
          }
        : prev
    )
    Alert.alert(
      action === 'approve-sourced-fabric' ? 'Fabric approved' : 'Change request sent',
      action === 'approve-sourced-fabric'
        ? 'Your tailor can continue once the pre-cutting checks are ready.'
        : 'Your tailor will upload another fabric option for approval.'
    )
  }

  async function decideStyleAlignment(
    action: 'approve-style-alignment' | 'request-style-alignment-change'
  ) {
    if (approvingStyle) return
    if (action === 'request-style-alignment-change' && styleChangeNote.trim().length < 5) {
      Alert.alert('Add a note', 'Tell the tailor what should change before cutting.')
      return
    }

    setApprovingStyle(true)
    const { error, data } = await invokeFunction<{ ok: boolean; styleAlignmentStatus?: string }>(
      'customer-order-action',
      {
        body: {
          orderId: id,
          action,
          note: action === 'request-style-alignment-change' ? styleChangeNote.trim() : undefined,
        },
      }
    )
    setApprovingStyle(false)

    if (error) {
      Sentry.captureException(error, { extra: { context: action, orderId: id } })
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not save your style decision yet.'
        : await readFunctionErrorMessage(error, 'Could not save your style decision. Please try again.')
      Alert.alert('Style decision not saved', message)
      return
    }

    const nextStatus =
      data?.styleAlignmentStatus ??
      (action === 'approve-style-alignment' ? 'APPROVED' : 'CHANGES_REQUESTED')
    setStyleChangeNote('')
    setShowStyleCorrection(false)
    setOrder((prev) =>
      prev
        ? {
            ...prev,
            supportMeta: {
              ...prev.supportMeta,
              styleAlignment: {
                ...(prev.supportMeta.styleAlignment ?? {}),
                status: nextStatus as NonNullable<OrderSupportMeta['styleAlignment']>['status'],
              },
            },
          }
        : prev
    )
    Alert.alert(
      action === 'approve-style-alignment' ? 'Style approved' : 'Clarification sent',
      action === 'approve-style-alignment'
        ? 'Your tailor can keep moving once the rest of the pre-cutting checks are ready.'
        : 'Your tailor will clarify the style interpretation before cutting.'
    )
  }

  async function continuePayment() {
    if (!order || paying) return
    const payingFulfillmentNow = hasPendingFulfillmentPayment(order)
    const payingConsultationNow = consultationPaymentRequired

    setPaying(true)
    try {
      const result = await startOrderPayment({
        orderId: order.id,
        customerEmail: user?.email,
        quoteId: order.activeQuoteId,
        expectedQuoteVersion: order.activeQuoteVersion,
      })

      await fetchOrder()

      if (result.ok) {
        Alert.alert(
          payingConsultationNow
            ? 'Consultation fee confirmed'
            : payingFulfillmentNow
              ? 'Extra dispatch payment confirmed'
              : order.orderKind === 'READY_MADE'
                ? 'Order placed'
                : 'Payment confirmed',
          payingConsultationNow
            ? 'Your consultation fee is confirmed. Your tailor can now start the consultation when ready.'
            : payingFulfillmentNow
              ? order.deliveryMethod === 'LOCAL_DELIVERY'
                ? 'The extra delivery payment is confirmed. Drapeon can now finish arranging this handoff.'
                : 'The extra shipping payment is confirmed. Drapeon can now finish arranging this shipment.'
              : order.orderKind === 'READY_MADE'
                ? 'Payment is confirmed and your seller can now prepare this order.'
                : 'Payment is confirmed and your order is now ready for production.'
        )
        return
      }

      if (!result.ok) {
        if (result.reason === 'cancelled') {
          Alert.alert(
            'Payment not finished',
            payingConsultationNow
              ? 'Your consultation fee is still open. You can finish it from this order any time.'
              : payingFulfillmentNow
                ? `Your extra ${order.deliveryMethod === 'LOCAL_DELIVERY' ? 'delivery' : 'shipping'} payment is still open. You can finish it from this order any time.`
                : order.orderKind === 'READY_MADE'
                  ? 'Your checkout is saved. Finish payment within 2 hours to keep this item and any applied discount.'
                  : 'Your quote is saved. Finish payment within 2 hours to keep its current pricing.'
          )
          return
        }

        if (result.stage === 'PAYMENT_FAILED') {
          Alert.alert(
            order.orderKind === 'READY_MADE' ? 'Checkout failed' : 'Payment failed',
            `${result.message}\n\nRetry within 2 hours or this order will cancel automatically.`
          )
          return
        }

        Alert.alert('Payment unavailable', result.message)
      }
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'continue_order_payment', orderId: order.id },
      })
      Alert.alert(
        'Payment unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your card has not been charged. Retry payment when the signal improves.'
          : 'Something went wrong before payment could finish. Your card has not been charged. Please try again.'
      )
    } finally {
      setPaying(false)
    }
  }

  async function respondToMaterialAdvance(
    advance: MaterialAdvance,
    decision: 'APPROVE' | 'DECLINE',
    declineReason?: MaterialAdvanceDeclineReason,
    note?: string,
  ) {
    if (respondingAdvanceId) return
    setRespondingAdvanceId(advance.id)
    try {
      const { error, data } = await invokeFunction<{
        ok: boolean
        notificationJobs?: { pushQueued?: boolean; emailQueued?: boolean }
      }>('material-advance-action', {
        body: {
          action: 'respond-advance',
          advanceId: advance.id,
          decision,
          declineReason: decision === 'DECLINE' ? declineReason : undefined,
          note: note?.trim() || undefined,
        },
      })

      if (error) {
        Alert.alert(
          'Could not update request',
          isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. Try again when the signal improves.'
            : await readFunctionErrorMessage(error, 'Could not update this material advance right now.'),
        )
        return
      }

      await fetchOrder()
      if (decision === 'DECLINE') {
        setDecliningAdvance(null)
        setMaterialAdvanceDeclineReason('FIND_CHEAPER_OPTION')
        setMaterialAdvanceDeclineNote('')
      }
      const reasonLabel = decision === 'DECLINE'
        ? materialAdvanceDeclineReasonLabel(declineReason)
        : null
      const counterpartQueued = data?.notificationJobs?.pushQueued === true || data?.notificationJobs?.emailQueued === true
      setMaterialAdvanceConfirmation({
        decision,
        title: decision === 'APPROVE'
          ? advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE' ? 'Fabric release approved' : 'Material request approved'
          : 'Material request declined',
        detail: decision === 'APPROVE'
          ? advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE'
            ? `${advance.title} is approved against the fabric allowance you already funded. You were not charged again; Drapeon Money Desk must review the exact release next.`
            : `${advance.title} is approved. Payment remains separate from the main order funds and still requires Drapeon release review.`
          : `${advance.title} stays unpaid${reasonLabel ? ` · ${reasonLabel}` : ''}. ${counterpartQueued ? 'The tailor notification is queued.' : 'The decision is saved in the order record.'}`,
      })
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'respond_material_advance', advanceId: advance.id, decision },
      })
      Alert.alert(
        'Could not update request',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. We could not confirm whether your decision saved, so check this order before trying again.'
          : await readFunctionErrorMessage(
              error,
              'We could not confirm whether your decision saved. Refresh this order before trying again.',
            ),
      )
    } finally {
      setRespondingAdvanceId(null)
    }
  }

  async function openMaterialAdvanceEvidence(advance: MaterialAdvance, kind: 'estimate' | 'receipt' | 'acquired') {
    const bucket = kind === 'estimate' ? advance.estimateStorageBucket : kind === 'receipt' ? advance.receiptStorageBucket : advance.acquiredStorageBucket
    const path = kind === 'estimate' ? advance.estimateStoragePath : kind === 'receipt' ? advance.receiptStoragePath : advance.acquiredStoragePath
    if (!bucket || !path) {
      Alert.alert('Proof unavailable', 'This protected proof is not available yet.')
      return
    }
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 10 * 60)
    if (error || !data?.signedUrl) {
      Alert.alert('Proof unavailable', 'Drapeon could not open this protected proof. Try again.')
      return
    }
    setMediaPreview({
      items: [{
        uri: data.signedUrl,
        label: kind === 'estimate' ? 'Supplier proof' : kind === 'receipt' ? 'Final receipt' : 'Acquired fabric',
        kind: isVideoUri(path) ? 'video' : 'photo',
      }],
      index: 0,
    })
  }

  function openMaterialAdvanceDecline(advance: MaterialAdvance) {
    setDecliningAdvance(advance)
    setMaterialAdvanceDeclineReason('FIND_CHEAPER_OPTION')
    setMaterialAdvanceDeclineNote('')
  }

  function submitMaterialAdvanceDecline() {
    if (!decliningAdvance) return
    if (materialAdvanceDeclineReason === 'OTHER' && materialAdvanceDeclineNote.trim().length < 5) {
      Alert.alert('Add a short explanation', 'Tell the tailor why you are declining this material request.')
      return
    }
    void respondToMaterialAdvance(
      decliningAdvance,
      'DECLINE',
      materialAdvanceDeclineReason,
      materialAdvanceDeclineNote,
    )
  }

  async function payMaterialAdvance(advance: MaterialAdvance) {
    if (!order || payingAdvanceId) return
    setPayingAdvanceId(advance.id)
    try {
      const result = await startMaterialAdvancePayment({
        orderId: order.id,
        advanceId: advance.id,
        customerEmail: user?.email,
      })
      await fetchOrder()

      if (result.ok) {
        Alert.alert(
          'Material advance paid',
          'Drapeon will review and release only this approved material amount. The main order escrow stays protected until delivery.'
        )
        return
      }

      Alert.alert(
        result.reason === 'cancelled' ? 'Payment not finished' : 'Payment unavailable',
        result.reason === 'cancelled'
          ? 'This material advance is still saved. You can finish payment from this order.'
          : result.message
      )
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'pay_material_advance', advanceId: advance.id, orderId: order.id },
      })
      Alert.alert(
        'Payment unavailable',
        isLikelyConnectivityIssue(error)
          ? 'Connection looks weak. Your payment has not been completed. Retry when the signal improves.'
          : 'Something went wrong before payment could finish. Please try again.'
      )
    } finally {
      setPayingAdvanceId(null)
    }
  }

  async function confirmMeasurements() {
    if (!order || confirmingMeasurements) return

    Alert.alert(
      'Confirm measurements',
      'Only confirm if these measurements are still correct. Cutting will stay paused until you do.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            if (confirmingMeasurements) return
            setConfirmingMeasurements(true)
            const { error } = await invokeFunction('customer-order-action', {
              body: { orderId: order.id, action: 'confirm-measurements' },
            })
            setConfirmingMeasurements(false)
            if (error) {
              Sentry.captureException(error, {
                extra: { context: 'confirm_measurements', orderId: order.id },
              })
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not confirm your measurements yet. Retry when the signal improves.'
                : await readFunctionErrorMessage(
                    error,
                    'Could not confirm your measurements right now. Please try again.'
                  )
              Alert.alert('Update unavailable', message)
              return
            }
            await fetchOrder()
          },
        },
      ]
    )
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <ActivityIndicator color={Colors.needleGreenDark} size="large" />
            <Text style={styles.stateTitle}>Loading your order...</Text>
            <Text style={styles.stateHint}>Pulling the latest order updates.</Text>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (fetchErrorMessage) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <Text style={styles.stateTitle}>Couldn't load this order.</Text>
            <Text style={styles.stateHint}>{fetchErrorMessage}</Text>
            <TouchableOpacity
              onPress={() => {
                void fetchOrder()
              }}
              style={styles.retryBtn}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.replace({ pathname: '/(customer)/orders', params: { tab } })}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(customer)/messages')}>
              <Text style={styles.backLink}>Open messages</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(customer)')}>
              <Text style={styles.backLink}>Explore tailors</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.backLink}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <Text style={styles.stateTitle}>Order not found.</Text>
            <Text style={styles.stateHint}>Open your orders list and try again.</Text>
            <TouchableOpacity
              onPress={() => router.replace({ pathname: '/(customer)/orders', params: { tab } })}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.backLink}>Go back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const progressStage =
    order.stage === 'IN_DISPUTE'
      ? (([...order.stageUpdates].reverse().find((u) => u.stage !== 'IN_DISPUTE')?.stage as
          | OrderStage
          | undefined) ?? 'CONFIRMED')
      : order.stage
  const progressStages = progressStagesForOrder(order.orderKind)
  const currentStageIdx = stageIndex(progressStage, order.orderKind)
  const fabricApprovalHistoryMediaSet = new Set(fabricApprovalHistoryMedia)
  const fabricApprovalUpdateIds = new Set(
    order.stageUpdates
      .filter((update) => !!update.photoUrl && fabricApprovalHistoryMediaSet.has(update.photoUrl))
      .map((update) => update.id),
  )
  const fabricDecisionUpdateIds = new Set(
    order.stageUpdates
      .filter((update) => sourcedFabricDecisionFromNote(update.note) !== null)
      .map((update) => update.id),
  )
  const styleAlignmentWorkflowUpdateIds = new Set(
    order.stageUpdates
      .filter((update) => styleAlignmentEventFromNote(update.note) !== null)
      .map((update) => update.id),
  )
  const latestUpdate = [...order.stageUpdates]
    .reverse()
    .find((update) =>
      !fabricApprovalUpdateIds.has(update.id) &&
      !fabricDecisionUpdateIds.has(update.id) &&
      !styleAlignmentWorkflowUpdateIds.has(update.id),
    )
  const latestHistoryUpdate = [...order.stageUpdates].reverse()[0]
  const historyUpdateLabelRaw = (update: StageUpdate) => fabricApprovalUpdateIds.has(update.id)
    ? 'Fabric submitted for approval'
    : sourcedFabricDecisionFromNote(update.note) === 'APPROVED'
      ? 'Fabric approved'
      : sourcedFabricDecisionFromNote(update.note) === 'CHANGES_REQUESTED'
        ? 'Fabric changes requested'
        : styleAlignmentEventFromNote(update.note) === 'REQUESTED'
      ? 'Style plan sent for approval'
      : styleAlignmentDecisionFromNote(update.note) === 'APPROVED'
      ? 'Style plan approved'
      : styleAlignmentDecisionFromNote(update.note) === 'CHANGES_REQUESTED'
        ? 'Style clarification requested'
        : timelineStageLabel(update, order.orderKind)
  const historyUpdateLabel = (update: StageUpdate, isLatest = false) =>
    deriveFulfillmentAwareHistoryLabel({
      eventStage: update.stage,
      effectiveMethod: dispatchFulfillmentState?.effectiveMethod ?? order.deliveryMethod,
      defaultLabel: historyUpdateLabelRaw(update),
      isLatest,
    })
  const timelineMediaUrls = Array.from(new Set([
    ...productionEvidenceMedia,
    ...order.stageUpdates.map((update) => update.photoUrl).filter((url): url is string => !!url),
  ]))
  const timelineMediaItems = timelineMediaUrls.map((uri, index) => ({
    uri,
    label: `Order evidence ${index + 1}`,
    kind: isVideoUri(uri) ? ('video' as const) : ('photo' as const),
    bucket: isVideoUri(uri) ? undefined : ('order-photos' as const),
  }))
  const timelineMosaicItems: DrapeMediaMosaicItem[] = timelineMediaItems.map((item, index) => ({
    id: `${index}:${item.uri}`,
    uri: item.uri,
    kind: item.kind,
    label: item.label,
    bucket: item.bucket,
  }))
  const justPlacedReadyMade = placed === '1' && order.orderKind === 'READY_MADE'
  const effectiveDeliveryMethod =
    dispatchFulfillmentState?.effectiveMethod ?? order.deliveryMethod
  const isCollection = effectiveDeliveryMethod === 'LOCAL_COLLECTION'
  const progressIsTerminalComplete = isHandoffCompleteStage(order.stage) || dispatchHandoffComplete
  const conversationCtaLabel = isTerminalOrderStage(order.stage)
    ? 'Open order conversation'
    : `Open order chat · ${order.tailorName.split(' ')[0]}`
  const pickupDetailsUnlocked =
    isCollection &&
    ['READY_FOR_COLLECTION', 'COLLECTED', 'COMPLETE', 'IN_DISPUTE'].includes(order.stage)
  const stageHelp =
    order.stage === 'READY_FOR_COLLECTION' && !isCollection
      ? dispatchFulfillmentState?.replacementPending
        ? 'Pickup has been replaced. Drapeon is confirming the delivery or shipping cost before the provider is booked.'
        : 'Pickup has been replaced. Follow the Drapeon Dispatch status for the active handoff.'
      : stageGuidance(order.stage, effectiveDeliveryMethod, order.orderKind)
  const stageStatusLabel =
    order.stage === 'READY_FOR_COLLECTION' && !isCollection
      ? dispatchFulfillmentState?.replacementPending
        ? 'Delivery requested'
        : 'Drapeon Dispatch'
      : customerOrderStageLabel(order.stage, order.orderKind)
  const measurementSource = order.measurementSnapshot?.measurementSource
  const fitConfidence = order.measurementSnapshot?.fitConfidence
  const measurementConfirmationNeeded = order.measurementSnapshot?.needsConfirmation === true
  const wearerLabel = wearerLabelFromOrder(order.supportMeta, order.measurementSnapshot)
  const measurementAge = resolveMeasurementAgeMeta(order.supportMeta, order.measurementSnapshot)
  const measurementAgeText = measurementAgeLabel(measurementAge)
  const measurementConfirmationFields = getMeasurementConfirmationFields(order.measurementSnapshot)
  const styleAlignment = order.supportMeta.styleAlignment
  const styleChangeFeedback = styleAlignmentChangeFeedbackFromUpdates(order.stageUpdates)
  const fitProfile = order.supportMeta.fitProfile ?? null
  const consultationMeta = order.supportMeta.consultation ?? null
  const consultationCallLifecycle = getCallLifecycleState(
    consultationMeta?.scheduledStartAt,
    consultationClockMs,
  )
  const consultationCallAvailable =
    consultationMeta?.status === 'SCHEDULED' && consultationCallLifecycle.status === 'active'
  const consultationCallExpired =
    consultationMeta?.status === 'EXPIRED' || consultationCallLifecycle.status === 'expired'
  const consultationQuotePreparationReady =
    order.stage === 'CONSULTATION' && consultationCallExpired
  const quoteBreakdown = order.supportMeta.quoteBreakdown ?? null
  const fabricPolicy = order.supportMeta.fabricPolicy ?? null
  const bulkOrder = order.supportMeta.bulkOrder ?? null
  const dispatchRecord = order.supportMeta.dispatchRecord ?? null
  const fabricHandoffMode = order.supportMeta.fabricHandoffMode ?? null
  const fabricHandoffLabel =
    order.supportMeta.fabricHandoffLabel ??
    (fabricHandoffMode ? FABRIC_HANDOFF_LABELS[fabricHandoffMode] : null)
  const briefDossier = buildBriefDossier(
    {
      orderKind: order.orderKind,
      garmentType: order.garmentType,
      garmentDescription: order.garmentDescription,
      itemTitle: order.itemTitle,
      itemSize: order.itemSize,
      itemQuantity: order.itemQuantity,
      occasion: order.occasion,
      stage: order.stage,
      quotedAmount: baseAmount(order),
      quotedCurrency: order.quotedCurrency,
      quotedCompletionDate: order.quotedCompletionDate,
      deadline: order.deadline,
      fabricSource: order.fabricSource,
      deliveryMethod: order.deliveryMethod,
      deliveryAddress: order.deliveryAddress,
      recipientName: order.recipientName,
      recipientPhone: order.recipientPhone,
      fabricTracking: order.fabricTracking,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      fulfillmentProvider: order.fulfillmentProvider,
      fulfillmentReference: order.fulfillmentReference,
      fulfillmentContactName: order.fulfillmentContactName,
      fulfillmentContactPhone: order.fulfillmentContactPhone,
      collectionCode: order.collectionCode,
      referencePhotos: order.referencePhotos,
      proofMediaUrls: order.stageUpdates.map((update) => update.photoUrl).filter((url): url is string => !!url),
      supportMeta: order.supportMeta as unknown as Record<string, unknown>,
      customDetail: order.customDetail,
      measurementSnapshot: order.measurementSnapshot as Record<string, unknown> | null,
      measurementSourceLabel: measurementSource ? MEASUREMENT_SOURCE_LABELS[measurementSource] ?? String(measurementSource) : null,
      fitConfidenceLabel: fitConfidence ? FIT_CONFIDENCE_LABELS[fitConfidence] ?? String(fitConfidence) : null,
      measurementAgeLabel: measurementAgeText,
      wearerLabel,
      bulkMemberCount: groupMembers.length,
    },
    {
      money: (amount, currency) => amount == null ? 'Quote pending' : formatAmount(amount, (currency ?? order.quotedCurrency) as CurrencyCode, (currency ?? order.quotedCurrency) as CurrencyCode, STATIC_FALLBACK_RATES),
    },
  )
  const showFabricTrackingSection =
    order.fabricFundingPolicyVersion !== 'fabric-funding-2026-08-21-v2' &&
    order.fabricSource === 'CUSTOMER_SUPPLIES' &&
    (fabricHandoffMode == null || isShippingFabricHandoff(fabricHandoffMode))
  const materialIssue = order.supportMeta.materialIssue ?? null
  const materialIssueOpen = hasOpenMaterialIssue(order.supportMeta)
  const sourcedFabricUrls = Array.from(new Set([
    ...fabricEvidenceMedia,
  ]))
  const sourcedFabricItems: MediaLightboxItem[] = sourcedFabricUrls.map((uri, index) => ({
    uri,
    label: `Sourced fabric proof ${index + 1}`,
    kind: isVideoUri(uri) ? 'video' : 'photo',
    bucket: isVideoUri(uri) ? undefined : 'order-photos',
  }))
  const sourcedFabricPending =
    order.fabricFundingPolicyVersion !== 'fabric-funding-2026-08-21-v2' &&
    order.fabricSource === 'TAILOR_SOURCES' &&
    order.customDetail?.fabricApprovalStatus === 'PENDING_CUSTOMER_APPROVAL'
  const materialIssueNeedsResponse = materialIssue?.status === 'OPEN'
  const materialIssueCancellationRequested = materialIssue?.status === 'CUSTOMER_REQUESTED_CANCEL'
  const materialIssueReasonLabel =
    materialIssue?.reasonLabel ??
    (materialIssue?.reason ? MATERIAL_ISSUE_REASON_LABELS[materialIssue.reason] : null)
  const materialIssueResponseLabel =
    materialIssue?.responseLabel ??
    (materialIssue?.response ? MATERIAL_ISSUE_RESPONSE_LABELS[materialIssue.response] : null)
  const cancellationReview = order.supportMeta.cancellationReview ?? null
  const cancellationReviewOpen = hasOpenCancellationReview(order.supportMeta)
  const cancellationReasonLabel =
    cancellationReview?.reasonLabel ??
    (cancellationReview?.reason
      ? CANCELLATION_REVIEW_REASON_LABELS[cancellationReview.reason]
      : null)
  const cancellationPolicy = deriveCancellationPolicy({
    orderKind: order.orderKind,
    stage: order.stage,
    deliveryMethod: order.deliveryMethod,
    consultationFee: order.consultationFee,
    consultationPaidAt: consultationMeta?.paidAt ?? null,
    consultationFeeCreditable: consultationMeta?.feeCreditable ?? null,
    fulfillmentFee: order.fulfillmentFee,
    fulfillmentPaymentRequestedAt: order.fulfillmentPaymentRequestedAt,
    fulfillmentPaymentPaidAt: order.fulfillmentPaymentPaidAt,
    dispatchBookedAt: dispatchRecord?.bookedAt ?? null,
    premiumDispatch: dispatchRecord?.premiumException ?? null,
  })
  const canRequestCancellationReview =
    !cancellationReviewOpen && cancellationPolicy.customerCanRequestReview
  const canSelfCancelOrder = cancellationPolicy.customerCanSelfCancel
  const showCancellationPolicyCard =
    cancellationReviewOpen ||
    (order.orderKind === 'CUSTOM'
      ? [
          'PENDING_QUOTE',
          'CONSULTATION',
          'PAYMENT_PENDING',
          'PAYMENT_FAILED',
          'CONFIRMED',
          'DESIGNING',
          'SOURCING',
          'CUTTING',
          'SEWING',
          'FINISHING',
        ].includes(order.stage)
      : [
          'PAYMENT_PENDING',
          'PAYMENT_FAILED',
          'CONFIRMED',
          'FINISHING',
          'READY_FOR_DRAPE_DISPATCH',
        ].includes(order.stage))
  const cancellationCardTitle = canSelfCancelOrder
    ? 'Cancellation options'
    : 'Cancellation and refund review'
  const deliveryReview = order.supportMeta.deliveryReview ?? null
  const deliveryReviewOpen = hasOpenDeliveryReview(order.supportMeta)
  const scopeChange = order.supportMeta.scopeChange ?? null
  const scopeChangeOpen = hasOpenScopeChange(order.supportMeta)
  const canRequestScopeChange =
    order.orderKind === 'CUSTOM' &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen &&
    SCOPE_CHANGE_STAGES.includes(order.stage)
  const canRespondScopeChange = scopeChangeOpen && scopeChange?.requestedBy === 'TAILOR'
  const canCancelScopeChange = scopeChangeOpen && scopeChange?.requestedBy === 'CUSTOMER'
  const scopeChangeTypeLabel =
    scopeChange?.typeLabel ??
    (scopeChange?.type ? SCOPE_CHANGE_TYPE_LABELS[scopeChange.type] : null)
  const scopeChangeStatusLabel =
    scopeChange?.status ? formatScopeChangeStatusLabel(scopeChange.status) : null
  const handoffStageActive =
    [
      'READY_FOR_COLLECTION',
      'READY_FOR_DRAPE_DISPATCH',
      'OUT_FOR_DELIVERY',
      'SHIPPED',
      'DELIVERED',
      'COLLECTED',
      'COMPLETE',
    ].includes(order.stage) ||
    !!order.handoffCompletedAt ||
    !!order.customerHandoffConfirmedAt
  const hasShipmentDetails = !!(
    dispatchRecord?.serviceLevel ||
    order.fulfillmentProvider ||
    order.trackingNumber ||
    order.fulfillmentReference ||
    order.fulfillmentContactName ||
    order.fulfillmentContactPhone ||
    order.carrier
  )
  const handoffContextAvailable =
    !cancellationReviewOpen &&
    !materialIssueOpen &&
    (handoffStageActive || deliveryReviewOpen || !!handoffIssue)
  const handoffHelpAvailable = handoffContextAvailable
  const showNonCollectionHandoffPanels =
    order.deliveryMethod !== 'LOCAL_COLLECTION' && handoffContextAvailable
  const showShipmentDetails = showNonCollectionHandoffPanels && hasShipmentDetails
  const compressReadyMadeSupport =
    order.orderKind === 'READY_MADE' &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen &&
    !['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COLLECTED', 'COMPLETE', 'IN_DISPUTE'].includes(
      order.stage
    )
  const deliveryReasonLabel =
    deliveryReview?.reasonLabel ??
    (deliveryReview?.reason ? DELIVERY_REVIEW_REASON_LABELS[deliveryReview.reason] : null)
  const aftercareStatus = getAftercareStatus(order)
  const initialPaymentLikelyPaid = ![
    'PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'DECLINED', 'EXPIRED',
  ].includes(order.stage)
  const canRequestDeliveryReview =
    initialPaymentLikelyPaid &&
    !deliveryReviewOpen &&
    order.stage !== 'IN_DISPUTE' &&
    order.stage !== 'COMPLETE'
  const consultationPaymentRequired =
    order.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    consultationMeta.status !== 'REQUESTED' &&
    consultationMeta.status !== 'DECLINED' &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS' &&
    !consultationMeta.paidAt
  const consultationPaymentPaid =
    order.stage === 'CONSULTATION' && !!consultationMeta?.feeAmount && !!consultationMeta.paidAt
  const consultationApproved =
    order.stage === 'CONSULTATION' &&
    consultationMeta?.status !== 'REQUESTED' &&
    consultationMeta?.status !== 'DECLINED'
  const readyMadePurchaseSummary =
    order.orderKind === 'READY_MADE'
      ? `${order.itemQuantity} ${order.itemQuantity === 1 ? 'item' : 'items'} · ${fulfillmentOptionLabel(
          order.fulfillmentOption,
          order.deliveryMethod
        )}`
      : null
  const activeMaterialAdvanceStatuses: MaterialAdvanceStatus[] = [
    'REQUESTED',
    'PAYMENT_PENDING',
    'PAYMENT_FAILED',
    'PAID',
    'OPS_REVIEW',
    'BLOCKED',
  ]
  const activeMaterialAdvances = materialAdvances.filter((advance) =>
    activeMaterialAdvanceStatuses.includes(advance.status) || advance.reconciliationStatus === 'OPS_REVIEW'
  )
  const closedMaterialAdvances = materialAdvances.filter(
    (advance) => !activeMaterialAdvanceStatuses.includes(advance.status) && advance.reconciliationStatus !== 'OPS_REVIEW'
  )
  const focusedMaterialAdvance = advanceId
    ? materialAdvances.find((advance) => advance.id === advanceId) ?? null
    : null
  const focusedMaterialCopy = focusedMaterialAdvance
    ? materialReconciliationCopy({
        outcome: focusedMaterialAdvance.reconciliationOutcome,
        resolution: focusedMaterialAdvance.reconciliationResolution,
        customerRefundAmount: focusedMaterialAdvance.customerRefundAmount,
        unapprovedOverageAmount: focusedMaterialAdvance.unapprovedOverageAmount,
        actorRole: 'CUSTOMER',
      })
    : null

  async function cancelOrderDirectly() {
    if (!order) return
    Alert.alert('Cancel this order?', cancellationPolicy.customerMessage, [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: async () => {
          const { error } = await invokeFunction('customer-order-action', {
            body: { orderId: order.id, action: 'cancel-order' },
          })
          if (error) {
            const message = isLikelyConnectivityIssue(error)
              ? 'Connection looks weak. We could not cancel this order yet. Retry when the signal improves.'
              : await readFunctionErrorMessage(
                  error,
                  'Could not cancel this order right now. Please try again.'
                )
            Alert.alert('Cancellation unavailable', message)
            return
          }
          await purgeTerminalOrderClientState({
            orderId: order.id,
            customerId: user?.id ?? null,
            sellerItemId: order.sellerItemId,
          })
          await fetchOrder()
        },
      },
    ])
  }

  function respondToScopeChange(decision: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    if (!order) return
    const actionLabel =
      decision === 'ACCEPTED' ? 'Accept change' : decision === 'DECLINED' ? 'Decline change' : 'Cancel request'
    const message =
      decision === 'ACCEPTED'
        ? 'This records your approval in Drapeon. If money or deadline changes are involved, Drapeon will still keep those steps formal.'
        : decision === 'DECLINED'
          ? 'This records that you do not approve the proposed change.'
          : 'This closes your change request without changing the order scope.'
    Alert.alert(actionLabel, message, [
      { text: 'Not now', style: 'cancel' },
      {
        text: actionLabel,
        onPress: async () => {
          const { error } = await invokeFunction('customer-order-action', {
            body: {
              orderId: order.id,
              action: 'respond-scope-change',
              scopeChangeDecision: decision,
            },
          })
          if (error) {
            const errorMessage = isLikelyConnectivityIssue(error)
              ? 'Connection looks weak. We could not update this change yet.'
              : await readFunctionErrorMessage(error, 'Could not update this change request right now.')
            Alert.alert('Change unavailable', errorMessage)
            return
          }
          void fetchOrder()
        },
      },
    ])
  }

  // ── QUOTE_SENT state — dedicated accept / decline view ──────────────────
  if (order.stage === 'QUOTE_SENT') {
    return (
      <QuoteReviewScreen
        order={order}
        onAction={fetchOrder}
        router={router}
        customerEmail={user?.email ?? ''}
        preferredTab={tab}
        returnTarget={explicitReturnPath}
        historyChain={historyChain}
        initialAction={action}
      />
    )
  }

  // ── PENDING_QUOTE — waiting on tailor ───────────────────────────────────
  if (order.stage === 'PENDING_QUOTE' || consultationQuotePreparationReady) {
    const isReadyMadeInquiry = order.orderKind === 'READY_MADE'
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.back} onPress={goBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.content}>
          {sent === '1' && (
            <View style={styles.sentBanner}>
              <Text style={styles.sentBannerText}>
                ✓ Brief sent to {order.tailorName.split(' ')[0]} · #{order.reference}
              </Text>
            </View>
          )}
          <Text style={styles.heading}>{order.garmentType}</Text>
          <Text style={styles.subheading}>
            {order.tailorName} · #{order.reference}
          </Text>
          <View style={styles.statusCard} testID="order-pending-quote">
            <DrapeStatusChip
              value={consultationQuotePreparationReady ? 'PENDING_QUOTE' : order.stage}
              label={isReadyMadeInquiry ? 'Inquiry Open' : 'Awaiting Quote'}
              domain="order"
            />
            <Text style={styles.statusNote}>
              {isReadyMadeInquiry
                ? `Your chat with ${order.tailorName.split(' ')[0]} is open. Ask about size, fit, colour, pickup, or delivery before you buy.`
                : consultationQuotePreparationReady
                  ? `The consultation finished. ${order.tailorName.split(' ')[0]} can now send your quote while any fee review finishes in the background.`
                  : `Your brief is with ${order.tailorName.split(' ')[0]}. Message them if needed.`}
            </Text>
          </View>
          <View style={styles.nextStepsCard}>
            <Text style={styles.nextStepsTitle}>What happens next</Text>
            {isReadyMadeInquiry ? (
              <>
                <Text style={styles.nextStepsItem}>1. Message the seller about this item</Text>
                <Text style={styles.nextStepsItem}>
                  2. Once you are ready, continue to checkout
                </Text>
                <Text style={styles.nextStepsItem}>
                  3. Your purchase order starts after checkout
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.nextStepsItem}>
                  1. {order.tailorName.split(' ')[0]} reviews your order and sends a quote
                </Text>
                <Text style={styles.nextStepsItem}>
                  2. You review the quote and accept or decline
                </Text>
                <Text style={styles.nextStepsItem}>3. Production starts once you accept</Text>
              </>
            )}
          </View>
          {scopeChangeOpen ? (
            <View style={[styles.supportCard, styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>Change request open</Text>
              {scopeChangeTypeLabel ? (
                <Text style={styles.supportBodyText}>{scopeChangeTypeLabel}</Text>
              ) : null}
              {scopeChange?.summary ? <Text style={styles.supportHint}>{scopeChange.summary}</Text> : null}
              {canCancelScopeChange ? (
                <Button
                  label="Cancel request"
                  variant="ghost"
                  onPress={() => respondToScopeChange('CANCELLED')}
                />
              ) : null}
            </View>
          ) : null}
          <Button
            label={conversationCtaLabel}
            variant="secondary"
            onPress={() =>
              router.navigate({
                pathname: '/(customer)/messages/[orderId]',
                params: {
                  orderId: order.id,
                  returnTo: `/(customer)/orders/${order.id}`,
                  historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                },
              })
            }
          />
          {!isReadyMadeInquiry ? (
            <Button
              label="Request consultation"
              variant="secondary"
              onPress={() => setShowCustomerConsultation(true)}
            />
          ) : null}
          {!isReadyMadeInquiry && canRequestScopeChange ? (
            <Button
              label="Update brief"
              variant="secondary"
              onPress={() => setShowScopeChange(true)}
            />
          ) : null}
          {isReadyMadeInquiry && order.sellerItemId ? (
            <Button
              label="Continue to checkout"
              onPress={() =>
                router.navigate({
                  pathname: '/(customer)/tailor/item/checkout/[itemId]',
                  params: {
                    itemId: order.sellerItemId as string,
                    returnTo: `/(customer)/orders/${order.id}`,
                    historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                  },
                })
              }
            />
          ) : null}
          {order.orderKind === 'CUSTOM' && canSelfCancelOrder ? (
            <Button
              label="Cancel request"
              variant="ghost"
              onPress={() => {
                void cancelOrderDirectly()
              }}
            />
          ) : null}
          {showCustomerConsultation ? (
            <CustomerConsultationRequestModal
              key={`customer-consultation-${order.id}`}
              visible
              orderId={order.id}
              tailorName={order.tailorName}
              tailorUserId={order.tailorId}
              onClose={() => setShowCustomerConsultation(false)}
              onSent={() => {
                setShowCustomerConsultation(false)
                void fetchOrder()
              }}
            />
          ) : null}
          {showScopeChange ? (
            <ScopeChangeModal
              key={`scope-change-${order.id}`}
              visible
              orderId={order.id}
              currency={order.quotedCurrency}
              onClose={() => setShowScopeChange(false)}
              onSubmitted={() => {
                setShowScopeChange(false)
                void fetchOrder()
              }}
            />
          ) : null}
        </View>
      </SafeAreaView>
    )
  }

  const sourcedFabricApprovalPanel = sourcedFabricPending ? (
    <View style={[styles.supportCard, styles.supportCardWarning]}>
      <View style={styles.disclosureHeader}>
        <View style={styles.disclosureCopy}>
          <Text style={styles.supportCardTitle}>Review sourced fabric</Text>
          <Text style={styles.supportHint}>Your approval is needed before cutting can begin.</Text>
        </View>
      </View>
      {sourcedFabricItems.length > 0 ? (
        <DrapeMediaMosaic
          items={sourcedFabricItems.map((item, index) => ({
            id: `sourced-fabric:${index}:${item.uri}`,
            uri: item.uri,
            kind: item.kind ?? 'photo',
            label: item.label,
            bucket: item.bucket,
          }))}
          contentFit="contain"
          onPressItem={(_, index) => openMediaPreview(sourcedFabricItems, index)}
          testID="customer-sourced-fabric-proof"
        />
      ) : (
        <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
          <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
            Fabric proof is missing. Ask the tailor to upload it before approving.
          </Text>
        </View>
      )}
      <Text style={styles.supportBodyText}>
        Approve this fabric to let the tailor continue toward cutting, or request a change before
        work becomes irreversible.
      </Text>
      <View style={styles.fabricApprovalActions}>
        <Button
          label="Approve fabric"
          onPress={() => decideSourcedFabric('approve-sourced-fabric')}
          loading={approvingFabric}
          disabled={sourcedFabricItems.length === 0}
        />
        <Input
          label="Change request"
          placeholder="e.g. I need a darker green or less shiny texture."
          value={fabricChangeNote}
          onChangeText={setFabricChangeNote}
          multiline
          numberOfLines={3}
          maxLength={300}
          filterContact
        />
        <Button
          label="Request changes"
          variant="secondary"
          onPress={() => decideSourcedFabric('request-sourced-fabric-change')}
          loading={approvingFabric}
          disabled={fabricChangeNote.trim().length < 5}
        />
      </View>
    </View>
  ) : null

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        {...capsuleNavScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 48, 72) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.needleGreen}
          />
        }
      >
        <View style={styles.content}>
          {/* Header */}
          <View>
            <Text style={styles.heading}>{order.garmentType}</Text>
            <Text style={styles.subheading}>
              {order.tailorName} · #{order.reference}
            </Text>
            {order.orderKind === 'READY_MADE' ? (
              <View style={styles.orderTypePill}>
                <Text style={styles.orderTypePillText}>Ready-made order</Text>
              </View>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={conversationCtaLabel}
              style={styles.messageAction}
              onPress={() =>
                router.navigate({
                  pathname: '/(customer)/messages/[orderId]',
                  params: {
                    orderId: order.id,
                    returnTo: `/(customer)/orders/${order.id}`,
                    historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                  },
                })
              }
            >
              <Feather name="message-circle" size={17} color={Colors.needleGreenDark} />
              <Text style={styles.messageActionText}>{conversationCtaLabel}</Text>
              <Feather name="chevron-right" size={17} color={Colors.midGrey} />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              <CommercialReceiptCard orderId={order.id} actorRole="CUSTOMER" />
              <SettlementProgressCard orderId={order.id} actorRole="CUSTOMER" />
            </View>
            <DrapeonDispatchCard
              orderId={order.id}
              orderStage={order.stage}
              actorRole="CUSTOMER"
              onOpenChange={setDispatchModalOpen}
              onDeliveryStateChange={setDispatchHandoffComplete}
              onFulfillmentStateChange={setDispatchFulfillmentState}
              onOrderStateChange={() => fetchOrder({ silent: true })}
            />
            {progressIsTerminalComplete && reviewCheckComplete && !hasReview && !showCompletionPrompt ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Rate this order and optionally tip the tailor"
                style={styles.completionAction}
                activeOpacity={0.82}
                onPress={() => setShowCompletionPrompt(true)}
              >
                <View style={styles.completionActionIcon}>
                  <Feather name="star" size={16} color={Colors.needleGreenDark} />
                </View>
                <View style={styles.flexOne}>
                  <Text style={styles.completionActionTitle}>Rate & thank {order.tailorName.split(' ')[0]}</Text>
                  <Text style={styles.completionActionBody}>Add a review or optional tip</Text>
                </View>
                <Feather name="chevron-right" size={18} color={Colors.midGrey} />
              </TouchableOpacity>
            ) : null}
          </View>

          <FabricWorkflowCard orderId={order.id} policyVersion={order.fabricFundingPolicyVersion} />

          {/* Collection code is the primary handoff credential, never the order reference. */}
          {order.stage === 'READY_FOR_COLLECTION'
            && order.collectionCode
            && (dispatchFulfillmentState?.pickupCredentialActive ?? order.deliveryMethod === 'LOCAL_COLLECTION') ? (
            <View style={styles.collectionCard} accessibilityRole="summary" accessibilityLabel={`Collection code ${order.collectionCode}`}>
              <Text style={styles.collectionEyebrow}>COLLECTION CODE</Text>
              <Text style={styles.collectionTitle}>Show this code to {order.tailorName}</Text>
              <View style={styles.codeBox}>
                {order.collectionCode.split('').map((digit, i) => (
                  <View key={`${digit}-${i}`} style={styles.codeDigit}>
                    <Text style={styles.codeDigitText}>{digit}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.collectionHint}>
                This is not your order number. Inspect the order first, then share the code so Drapeon can record the pickup handoff.
              </Text>
              {order.collectionCodeExpiry ? (
                <Text style={styles.collectionExpiry}>
                  Available until {formatExplicitZonedDateTime(order.collectionCodeExpiry)}.
                </Text>
              ) : null}
              <Button
                label="Generate new code"
                variant="secondary"
                onPress={() => Alert.alert(
                  'Generate a new pickup code?',
                  'The current code will stop working immediately.',
                  [
                    { text: 'Keep current code', style: 'cancel' },
                    {
                      text: 'Generate',
                      onPress: () => { void invokeFunction('customer-order-action', {
                        body: {
                          action: 'refresh-collection-code',
                          orderId: order.id,
                          force: true,
                        },
                      }).then(({ error }) => {
                        if (error) throw error
                        return fetchOrder({ silent: true })
                      }).catch(() => Alert.alert('Could not refresh code', 'Try again in a moment.')) },
                    },
                  ],
                )}
              />
              <TouchableOpacity onPress={() => setShowDispute(true)} accessibilityRole="button">
                <Text style={styles.disputeLink}>Something wrong? Report issue</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {focusedMaterialAdvance ? (
            <View accessibilityRole="alert" style={[styles.supportCard, focusedMaterialCopy?.tone === 'warning' ? styles.supportCardWarning : undefined]}>
              <Text style={styles.supportCardTitle}>{focusedMaterialCopy?.title ?? formatMaterialAdvanceStatusLabel(focusedMaterialAdvance.status, 'customer')}</Text>
              <Text style={styles.supportBodyText}>{focusedMaterialAdvance.title}</Text>
              <Text style={styles.supportHint}>{focusedMaterialCopy?.body ?? 'This protected fabric update is recorded on your order.'}</Text>
            </View>
          ) : null}

          {justPlacedReadyMade ? (
            <View style={styles.sentBanner}>
              <Text style={styles.sentBannerText}>
                ✓ Order placed · #{order.reference}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' ? ' · item paid first' : ''}
              </Text>
            </View>
          ) : null}

          {materialAdvanceConfirmation ? (
            <View
              accessibilityRole="alert"
              style={[
                styles.supportCard,
                materialAdvanceConfirmation.decision === 'DECLINE'
                  ? styles.supportCardWarning
                  : styles.materialDecisionSuccess,
              ]}
            >
              <Text style={styles.supportCardTitle}>{materialAdvanceConfirmation.title}</Text>
              <Text style={styles.supportBodyText}>{materialAdvanceConfirmation.detail}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Dismiss material request confirmation"
                onPress={() => setMaterialAdvanceConfirmation(null)}
              >
                <Text style={styles.disclosureAction}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Stage progress bar */}
          {PRE_PRODUCTION_STAGES.includes(order.stage) &&
          order.stage !== 'PAYMENT_PENDING' &&
          order.stage !== 'PAYMENT_FAILED' ? (
            <View style={styles.preProductionBar}>
              <View style={styles.preProductionDot} />
              <Text style={styles.preProductionLabel}>
                {order.stage === 'CONSULTATION' && consultationQuotePreparationReady
                  ? 'Quote ready'
                  : preProductionLabel(order.stage, order.orderKind)}
              </Text>
            </View>
          ) : (
            <View style={styles.progressBar}>
              {progressStages.map((s, i) => {
                const done = i <= currentStageIdx
                const active = i === currentStageIdx && !progressIsTerminalComplete
                return (
                  <View key={s} style={styles.progressStep}>
                    <View
                      style={[
                        styles.progressDot,
                        done && styles.progressDotDone,
                        active && styles.progressDotActive,
                      ]}
                    >
                      {done && !active && <Text style={styles.progressCheck}>✓</Text>}
                    </View>
                    {i < progressStages.length - 1 && (
                      <View
                        style={[
                          styles.progressLine,
                          done && i < currentStageIdx && styles.progressLineDone,
                        ]}
                      />
                    )}
                    <Text style={[styles.progressLabel, done && styles.progressLabelDone]}>
                      {progressLabel(s, order.orderKind, isCollection, order.stage)}
                    </Text>
                  </View>
                )
              })}
            </View>
          )}

          {/* Current stage status */}
          {!(
            (order.stage === 'CONSULTATION' && consultationRescheduleRequired) ||
            order.stage === 'PAYMENT_PENDING' ||
            order.stage === 'PAYMENT_FAILED'
          ) ? (
          <View style={styles.statusCard} testID="order-tracking-status">
            <DrapeStatusChip
              value={order.stage === 'READY_FOR_COLLECTION' && !isCollection ? 'READY_FOR_DRAPE_DISPATCH' : order.stage}
              label={stageStatusLabel}
              domain="order"
            />
            {stageHelp && <Text style={styles.statusHelp}>{stageHelp}</Text>}
            {latestUpdate?.note && (
              <Text style={styles.statusNote}>{formatOrderUpdateNote(latestUpdate.note)}</Text>
            )}
            {latestUpdate?.photoUrl && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open latest order progress proof"
                accessibilityHint="Opens the order evidence gallery full screen"
                activeOpacity={0.88}
                onPress={() => {
                  const mediaIndex = timelineMediaItems.findIndex((item) => item.uri === latestUpdate.photoUrl)
                  openMediaPreview(timelineMediaItems, Math.max(0, mediaIndex))
                }}
              >
                <StageMediaPreview
                  uri={latestUpdate.photoUrl}
                  style={styles.progressPhoto}
                  surface="customer_order_progress_photo"
                  accessibilityLabel="Latest order progress proof"
                />
              </TouchableOpacity>
            )}
            {order.quotedCompletionDate &&
              order.stage !== 'COMPLETE' &&
              order.stage !== 'DELIVERED' &&
              order.stage !== 'COLLECTED' &&
              order.stage !== 'IN_DISPUTE' && (
                <Text style={styles.statusEta}>
                  Est. ready{' '}
                  {new Date(order.quotedCompletionDate).toLocaleDateString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
              )}
          </View>
          ) : null}

          {sourcedFabricApprovalPanel}

          {styleAlignment?.status === 'PENDING_CUSTOMER_APPROVAL' ? (
            <View style={[styles.supportCard, styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>Review the tailor&apos;s style plan</Text>
              <Text style={styles.supportHint}>
                {styleAlignment.tailorInterpretation ??
                  'Your tailor added their interpretation of your references. Approve it before cutting, or request a correction.'}
              </Text>
              <Button
                label={approvingStyle ? 'Saving...' : 'Approve style plan'}
                onPress={() => decideStyleAlignment('approve-style-alignment')}
                disabled={approvingStyle}
              />
              {showStyleCorrection ? (
                <>
                  <Input
                    label="What should change?"
                    value={styleChangeNote}
                    onChangeText={setStyleChangeNote}
                    placeholder="Example: Please make the neckline closer to the first reference."
                    multiline
                  />
                  <Button
                    label={approvingStyle ? 'Sending...' : 'Send correction'}
                    variant="secondary"
                    onPress={() => decideStyleAlignment('request-style-alignment-change')}
                    disabled={approvingStyle || !styleChangeNote.trim()}
                  />
                </>
              ) : (
                <Button
                  label="Request changes"
                  variant="secondary"
                  onPress={() => setShowStyleCorrection(true)}
                  disabled={approvingStyle}
                />
              )}
            </View>
          ) : null}

          {styleAlignment?.status === 'CHANGES_REQUESTED' ? (
            <View style={[styles.supportCard, styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>Style clarification requested</Text>
              <Text style={styles.supportHint} numberOfLines={3}>
                {styleAlignment.tailorInterpretation ?? 'The tailor needs to update the style plan before cutting.'}
              </Text>
              {styleChangeFeedback ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="View your requested style clarification"
                  style={styles.decisionLink}
                  onPress={() => setShowStyleChangeFeedback(true)}
                >
                  <Text style={styles.decisionLinkText}>View changes</Text>
                  <Feather name="chevron-right" size={14} color={Colors.needleGreenDark} />
                </TouchableOpacity>
              ) : null}
              <Text style={styles.supportBodyText}>Your tailor must send an updated interpretation before you approve it.</Text>
            </View>
          ) : null}

          {styleAlignment?.status === 'APPROVED' && PRE_CUTTING_STAGES.includes(order.stage) ? (
            <View style={styles.supportCard} accessibilityRole="summary">
              <View style={[styles.supportStatusBadge, styles.supportStatusSuccess]}>
                <Text style={[styles.supportStatusText, styles.supportStatusTextSuccess]}>Style plan approved</Text>
              </View>
              <Text style={styles.supportBodyText}>Your approved interpretation is recorded with this order before cutting.</Text>
            </View>
          ) : null}

          {activeMaterialAdvances.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Material advance</Text>
              {activeMaterialAdvances.map((advance) => {
                const amountLabel = formatAmount(
                  advance.amount,
                  advance.currency,
                  advance.currency,
                  STATIC_FALLBACK_RATES
                )
                const needsDecision = advance.status === 'REQUESTED'
                const needsPayment =
                  advance.status === 'PAYMENT_PENDING' || advance.status === 'PAYMENT_FAILED'
                const reconciliationCopy = materialReconciliationCopy({ outcome: advance.reconciliationOutcome, resolution: advance.reconciliationResolution, customerRefundAmount: advance.customerRefundAmount, unapprovedOverageAmount: advance.unapprovedOverageAmount, actorRole: 'CUSTOMER' })
                return (
                  <View
                    key={advance.id}
                    style={[
                      styles.supportCard,
                      (needsDecision || needsPayment || advance.status === 'BLOCKED') &&
                        styles.supportCardWarning,
                    ]}
                  >
                    <View style={styles.disclosureHeader}>
                      <View style={styles.disclosureCopy}>
                        <Text style={styles.supportCardTitle}>{advance.title}</Text>
                        <Text style={styles.supportHint}>
                          {formatMaterialAdvanceStatusLabel(advance.status, 'customer')}
                        </Text>
                      </View>
                      <Text style={styles.disclosureAction}>{amountLabel}</Text>
                    </View>
                    <Text style={styles.supportBodyText}>{advance.description}</Text>
                    <Text style={styles.supportHint}>
                      {advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE'
                        ? 'This exact amount comes from the fabric allowance already paid at checkout. Approval does not charge you again; Drapeon Money Desk reviews the release before the tailor receives it.'
                        : 'This is separate from the main order funds. Approve only if this material cost makes sense; Drapeon reviews the release before the tailor receives it.'}
                    </Text>
                    {advance.estimateStorageBucket && advance.estimateStoragePath ? (
                      <Button label="View proof" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'estimate') }} />
                    ) : (
                      <View style={styles.materialProofMissing}>
                        <Text style={styles.materialProofMissingTitle}>Supplier proof unavailable</Text>
                        <Text style={styles.supportHint}>Do not approve this request. Ask the tailor to resubmit it with an estimate or supplier photo.</Text>
                      </View>
                    )}
                    {advance.customerResponseReason ? (
                      <Text style={styles.supportHint}>Decision reason: {materialAdvanceDeclineReasonLabel(advance.customerResponseReason) ?? 'Not specified'}</Text>
                    ) : null}
                    {advance.customerResponseNote ? (
                      <Text style={styles.supportHint}>Your note: {advance.customerResponseNote}</Text>
                    ) : null}
                    {advance.receiptStoragePath ? (
                      <Button label="View final receipt" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'receipt') }} />
                    ) : null}
                    {advance.acquiredStoragePath ? (
                      <Button label="View acquired fabric" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'acquired') }} />
                    ) : null}
                    {reconciliationCopy ? (
                      <View style={[styles.supportStatusBadge, reconciliationCopy.tone === 'success' ? styles.supportStatusSuccess : styles.supportStatusWarning]} accessibilityRole="summary">
                        <Text style={[styles.supportStatusText, reconciliationCopy.tone === 'success' ? styles.supportStatusTextSuccess : styles.supportStatusTextWarning]}>{reconciliationCopy.title}</Text>
                        <Text style={styles.supportHint}>{reconciliationCopy.body}</Text>
                        {advance.customerRefundAmount > 0 ? <Text style={styles.supportStatusText}>Refund value: {formatAmount(advance.customerRefundAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                        {advance.unapprovedOverageAmount > 0 ? <Text style={styles.supportStatusText}>Unapproved overage: {formatAmount(advance.unapprovedOverageAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                      </View>
                    ) : null}
                    {needsDecision ? (
                      <View style={styles.inlineActions}>
                        <Button
                          label="Approve"
                          onPress={() => respondToMaterialAdvance(advance, 'APPROVE')}
                          loading={respondingAdvanceId === advance.id}
                          disabled={!!respondingAdvanceId || !advance.estimateStorageBucket || !advance.estimateStoragePath}
                        />
                        <Button
                          label="Decline"
                          variant="secondary"
                          onPress={() => openMaterialAdvanceDecline(advance)}
                          disabled={!!respondingAdvanceId}
                        />
                      </View>
                    ) : needsPayment ? (
                      <Button
                        label={advance.status === 'PAYMENT_FAILED' ? 'Retry payment' : 'Pay material advance'}
                        onPress={() => payMaterialAdvance(advance)}
                        loading={payingAdvanceId === advance.id}
                        disabled={!!payingAdvanceId}
                      />
                    ) : null}
                  </View>
                )
              })}
            </View>
          ) : null}

          {showCancellationPolicyCard && cancellationReviewOpen && (
            <SupportDisclosure
              title={cancellationCardTitle}
              summary={
                canSelfCancelOrder
                  ? 'Stop this order before the next step.'
                  : 'Review cancellation and refund options.'
              }
              defaultExpanded={false}
            >
              {cancellationReviewOpen ? (
                <>
                  <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                    <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                      Review open
                    </Text>
                  </View>
                  <Text style={styles.supportHint}>
                    Drapeon is reviewing this cancellation request before handoff. Keep all updates
                    inside this order while we decide the next step.
                  </Text>
                  {cancellationReasonLabel ? (
                    <Text style={styles.supportBodyText}>Reason: {cancellationReasonLabel}</Text>
                  ) : null}
                  {cancellationReview?.note ? (
                    <Text style={styles.supportHint}>{cancellationReview.note}</Text>
                  ) : null}
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}
                    </Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                </>
              ) : canSelfCancelOrder ? (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.customerMessage}</Text>
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Check the order terms for:{' '}
                      {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                  {cancellationPolicy.nonRefundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Not normally refunded:{' '}
                      {refundCoverageLabel(cancellationPolicy.nonRefundableNow)}
                    </Text>
                  ) : null}
                  <Button
                    label="Cancel this order"
                    variant="secondary"
                    onPress={() => {
                      void cancelOrderDirectly()
                    }}
                  />
                </>
              ) : canRequestCancellationReview ? (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.customerMessage}</Text>
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}
                    </Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                  <Button
                    label="Request cancellation review"
                    variant="secondary"
                    onPress={() => setShowCancellationReview(true)}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.customerMessage}</Text>
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                </>
              )}
            </SupportDisclosure>
          )}

          {deliveryReviewOpen && (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Shipping &amp; delivery help</Text>
              {deliveryReviewOpen ? (
                <>
                  <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                    <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                      Review open
                    </Text>
                  </View>
                  <Text style={styles.supportHint}>
                    Drapeon is reviewing this fulfillment issue. Keep updates and evidence inside the
                    order. High-risk custody or delivery problems pause the order; routine delays do not.
                  </Text>
                  {deliveryReasonLabel ? (
                    <Text style={styles.supportBodyText}>Reason: {deliveryReasonLabel}</Text>
                  ) : null}
                  {deliveryReview?.note ? (
                    <Text style={styles.supportHint}>{deliveryReview.note}</Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>
                    Available after payment, including after completion. Report tracking, custody,
                    recipient, customs, damage, missing contents, or delivery problems here.
                  </Text>
                  <Button
                    label="Get shipping or delivery help"
                    variant="secondary"
                    onPress={() => setShowDeliveryReview(true)}
                  />
                </>
              )}
            </View>
          )}

          {(order.stage === 'PAYMENT_PENDING' || order.stage === 'PAYMENT_FAILED') && (
            <View style={styles.videoCallCard}>
              <Text style={styles.videoCallTitle}>
                {order.stage === 'PAYMENT_FAILED'
                  ? order.orderKind === 'READY_MADE'
                    ? 'Checkout failed'
                    : 'Payment failed'
                  : order.orderKind === 'READY_MADE'
                    ? 'Complete checkout'
                    : 'Finish payment'}
              </Text>
              <Text style={styles.videoCallHint}>
                {order.stage === 'PAYMENT_FAILED'
                  ? order.orderKind === 'READY_MADE'
                    ? 'This checkout did not complete. Retry within 2 hours or it will cancel automatically.'
                    : 'This payment did not complete. Retry within 2 hours or the order will cancel automatically.'
                  : order.orderKind === 'READY_MADE'
                    ? 'Your checkout is saved for now. Payment must succeed before this becomes a placed order.'
                    : 'Your tailor will only see this order as confirmed after payment succeeds.'}
              </Text>
              {paymentRouteCopyForCurrency(order.quotedCurrency) ? (
                <Text style={styles.videoCallHint}>
                  {paymentRouteCopyForCurrency(order.quotedCurrency)}
                </Text>
              ) : null}
              {order.stage === 'PAYMENT_PENDING' ? (
                <Text style={styles.videoCallHint}>
                  If your bank already shows a charge, do not pay again. Refresh this order or contact support if it still looks pending after a few minutes.
                </Text>
              ) : null}
              <CommercialBenefitsCard
                orderId={order.id}
                currency={order.quotedCurrency}
                variant="checkout"
                onChanged={() => fetchOrder({ silent: true })}
              />
              <Button
                label={
                  order.stage === 'PAYMENT_FAILED'
                    ? order.orderKind === 'READY_MADE'
                      ? 'Retry checkout'
                      : 'Retry payment'
                    : order.orderKind === 'READY_MADE'
                      ? 'Complete checkout'
                      : 'Continue payment'
                }
                onPress={continuePayment}
                loading={paying}
                disabled={paying}
              />
            </View>
          )}

          {hasPendingFulfillmentPayment(order) && (
            <View style={styles.videoCallCard}>
              <Text style={styles.videoCallTitle}>{pendingFulfillmentPaymentLabel(order)}</Text>
              <Text style={styles.videoCallHint}>
                {order.deliveryMethod === 'LOCAL_DELIVERY'
                  ? 'Your item is already paid. Drapeon requested an extra delivery payment for a non-standard handoff, such as rush or exception dispatch.'
                  : 'Your item is already paid. Drapeon requested an extra shipping payment for a non-standard handoff, such as rush or exception dispatch.'}
              </Text>
              {paymentRouteCopyForCurrency(order.quotedCurrency) ? (
                <Text style={styles.videoCallHint}>
                  {paymentRouteCopyForCurrency(order.quotedCurrency)}
                </Text>
              ) : null}
              <View style={styles.timelineContent}>
                {baseAmount(order) != null ? (
                  <SummaryLine
                    label="Item already paid"
                    value={formatAmount(
                      baseAmount(order) ?? 0,
                      order.quotedCurrency,
                      order.quotedCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  />
                ) : null}
                <SummaryLine
                  label={
                    order.deliveryMethod === 'LOCAL_DELIVERY'
                      ? 'Delivery payment'
                      : 'Shipping payment'
                  }
                  value={formatAmount(
                    order.fulfillmentFee,
                    order.quotedCurrency,
                    order.quotedCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                />
              </View>
              <Button
                label={
                  order.deliveryMethod === 'LOCAL_DELIVERY'
                    ? 'Pay extra delivery fee'
                    : 'Pay extra shipping fee'
                }
                onPress={continuePayment}
                loading={paying}
                disabled={paying}
              />
            </View>
          )}

          {/* Consultation */}
          {order.stage === 'CONSULTATION' && !consultationRescheduleRequired && (
            <View style={styles.videoCallCard}>
              <Text style={styles.videoCallTitle}>
                {consultationMeta?.requestedBy === 'CUSTOMER' &&
                consultationMeta.status === 'REQUESTED'
                  ? 'Consultation request sent'
                  : consultationMeta?.status === 'EXPIRED'
                    ? 'Consultation expired'
                    : consultationPaymentRequired
                      ? 'Consultation payment required'
                      : consultationCallAvailable
                        ? 'Consultation call available'
                        : consultationCallExpired
                          ? 'Consultation window ended'
                          : consultationApproved
                            ? 'Consultation scheduled'
                            : 'Consultation requested'}
              </Text>
              {order.consultationFee != null && (
                <Text style={styles.consultationFeeText}>
                  Consultation fee:{' '}
                  {formatAmount(
                    order.consultationFee,
                    order.quotedCurrency,
                    order.quotedCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                </Text>
              )}
              {consultationMeta ? (
                <View style={styles.timelineContent}>
                  {consultationMeta.feeAmount ? (
                    <SummaryLine
                      label="Fee treatment"
                      value={
                        consultationMeta.feeCreditable
                          ? 'Counts toward the final order if you go ahead'
                          : 'Separate consultation fee'
                      }
                    />
                  ) : null}
                  {consultationMeta.scheduledStartAt ? (
                    <SummaryLine
                      label="Scheduled for"
                      value={formatConsultationStart(consultationMeta.scheduledStartAt, consultationMeta.timezone)}
                    />
                  ) : consultationMeta.proposedStartAt ? (
                    <SummaryLine
                      label="Requested time"
                      value={formatConsultationStart(consultationMeta.proposedStartAt, consultationMeta.timezone)}
                    />
                  ) : null}
                  {consultationMeta.status === 'REQUESTED' && consultationMeta.requestExpiresAt ? (
                    <SummaryLine
                      label="Respond by"
                      value={formatConsultationStart(consultationMeta.requestExpiresAt, consultationMeta.timezone)}
                    />
                  ) : null}
                  {consultationMeta.paymentTiming ? (
                    <SummaryLine
                      label="Payment timing"
                      value={CONSULTATION_PAYMENT_TIMING_LABELS[consultationMeta.paymentTiming]}
                    />
                  ) : null}
                  {consultationMeta.reschedulePolicy ? (
                    <SummaryLine
                      label="Rescheduling"
                      value={
                        CONSULTATION_RESCHEDULE_POLICY_LABELS[consultationMeta.reschedulePolicy]
                      }
                    />
                  ) : null}
                  {consultationMeta.noShowPolicy ? (
                    <SummaryLine
                      label="No-show policy"
                      value={CONSULTATION_NO_SHOW_POLICY_LABELS[consultationMeta.noShowPolicy]}
                    />
                  ) : null}
                  {consultationMeta.status !== 'REQUESTED' && consultationMeta.expiryPolicy ? (
                    <SummaryLine
                      label="Booking validity"
                      value={CONSULTATION_EXPIRY_POLICY_LABELS[consultationMeta.expiryPolicy]}
                    />
                  ) : null}
                  {consultationPaymentPaid ? (
                    <SummaryLine
                      label="Payment status"
                      value="Paid"
                    />
                  ) : null}
                  <SummaryLine
                    label="Bring to call"
                    value="Fit concerns, reference photos, fabric questions, and any deadline risk"
                  />
                </View>
              ) : null}
              <Text style={styles.videoCallHint}>
                {consultationPaymentRequired
                  ? 'Your tailor approved the slot and charges for this consultation. Pay the consultation fee here first; the call opens around the scheduled time.'
                  : consultationCallAvailable
                    ? 'Your protected consultation call is available now.'
                    : consultationMeta?.requestedBy === 'CUSTOMER' &&
                        consultationMeta.status === 'REQUESTED'
                      ? `Waiting for ${order.tailorName.split(' ')[0]}. This request expires after 48 hours.`
                      : consultationMeta?.status === 'EXPIRED'
                        ? 'This consultation window expired. The order is back in quote review so your tailor can send a quote, reschedule, or decline.'
                        : consultationCallExpired
                          ? 'The scheduled call window has ended. Message your tailor to agree on another time.'
                        : consultationPaymentPaid
                          ? `Your consultation fee is paid. ${formatCallCountdown(consultationCallLifecycle.msUntilOpen)}.`
                          : consultationApproved
                            ? 'This consultation is scheduled. Open the call around the scheduled time.'
                            : `Your tailor wants to speak before production starts. Keep chatting here and ${order.tailorName.split(' ')[0]} will share the call link when ready.`}
              </Text>
              {consultationPaymentRequired ? (
                <Button
                  label="Pay consultation fee"
                  onPress={continuePayment}
                  loading={paying}
                  disabled={paying}
                />
              ) : consultationCallAvailable ? (
                <Button
                  label={`Join ${consultationMeta?.callType === 'AUDIO' ? 'audio' : 'video'} call now`}
                  onPress={() => { void startConsultationCall(consultationMeta?.callType === 'AUDIO' ? 'audio' : 'video') }}
                  loading={!!startingConsultationCall}
                  disabled={!!startingConsultationCall}
                />
              ) : consultationApproved && consultationCallLifecycle.status === 'upcoming' ? (
                <>
                  <Button
                    label={formatCallCountdown(consultationCallLifecycle.msUntilOpen)}
                    variant="secondary"
                    onPress={() => {}}
                    disabled
                  />
                  {!consultationReschedulePending ? (
                    <Button
                      label="Need another time?"
                      variant="secondary"
                      onPress={askToRescheduleConsultation}
                    />
                  ) : null}
                </>
              ) : (
                <Button
                  label={conversationCtaLabel}
                  variant="secondary"
                  onPress={() =>
                    router.navigate({
                      pathname: '/(customer)/messages/[orderId]',
                      params: {
                        orderId: order.id,
                        returnTo: `/(customer)/orders/${order.id}`,
                        historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                      },
                    })
                  }
                />
              )}
            </View>
          )}

          {consultationMeta?.scheduledStartAt ? (
            <ConsultationAttendancePanel orderId={order.id} actorRole="CUSTOMER" />
          ) : null}
          {consultationMeta?.scheduledStartAt ? (
            <ConsultationReschedulePanel
              orderId={order.id}
              actorRole="CUSTOMER"
              actorId={userId}
              counterpartName={order.tailorName.split(' ')[0]}
              onOpenChat={openOrderMessages}
              onOpenCall={(callType) => { void startConsultationCall(callType) }}
              onUpdated={() => { void fetchOrder({ silent: true }) }}
              onPendingChange={setConsultationReschedulePending}
              onRescheduleRequiredChange={setConsultationRescheduleRequired}
            />
          ) : null}
          {consultationMeta?.scheduledStartAt && !consultationRescheduleRequired && !consultationCallExpired ? (
            <ConsultationLifecyclePanel orderId={order.id} actorRole="CUSTOMER" onUpdated={() => { void fetchOrder({ silent: true }) }} />
          ) : null}
          <TaxDecisionSummaryCard orderId={order.id} />
          {order.orderKind === 'CUSTOM' && !['CANCELLED'].includes(order.stage) ? (
            <SupportDisclosure
              title="Fit protection"
              summary="Measurements, style decisions, and aftercare are recorded here."
              defaultExpanded={false}
            >
              <Text style={styles.supportHint}>
                Before cutting, confirm the measurements and decisions that affect fit. After
                handoff, you can report fit or finish issues from this page for 14 days.
              </Text>
              <View style={styles.timelineContent}>
                <SummaryLine
                  label="Before cutting"
                  value={
                    measurementConfirmationNeeded
                      ? 'Waiting for your measurement confirmation'
                      : 'Measurements and material should be confirmed here'
                  }
                />
                {styleAlignment?.requiredBeforeCutting ? (
                  <SummaryLine
                    label="Style references"
                    value={
                      styleAlignment.status === 'APPROVED'
                        ? 'Approved before cutting'
                        : styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL'
                          ? 'Waiting for your approval'
                          : 'Tailor should confirm their interpretation before cutting'
                    }
                  />
                ) : null}
                <SummaryLine
                  label="After handoff"
                  value="Use aftercare if the garment arrives with a fit or finish issue"
                />
              </View>
            </SupportDisclosure>
          ) : null}

          {(scopeChangeOpen || canRequestScopeChange) && (
            <View style={[styles.supportCard, scopeChangeOpen && styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>
                {scopeChangeOpen ? 'Change request open' : 'Need to change something?'}
              </Text>
              {scopeChangeOpen ? (
                <>
                  <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                    <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                      {scopeChangeStatusLabel ?? 'Waiting for review'}
                    </Text>
                  </View>
                  {scopeChangeTypeLabel ? (
                    <Text style={styles.supportBodyText}>{scopeChangeTypeLabel}</Text>
                  ) : null}
                  {scopeChange?.summary ? (
                    <Text style={styles.supportHint}>{scopeChange.summary}</Text>
                  ) : null}
                  {scopeChange?.impacts?.length ? (
                    <Text style={styles.supportHint}>
                      Affects:{' '}
                      {scopeChange.impacts
                        .map((impact) => SCOPE_CHANGE_IMPACT_LABELS[impact])
                        .join(', ')}
                    </Text>
                  ) : null}
                  <Text style={styles.supportHint}>
                    Keep working details in Messages. Price, deadline, fit, fabric, or fulfillment changes need a clear Drapeon record before the next step.
                  </Text>
                  {canRespondScopeChange ? (
                    <View style={{ gap: Spacing.sm }}>
                      <Button
                        label="Accept change"
                        variant="secondary"
                        onPress={() => respondToScopeChange('ACCEPTED')}
                      />
                      <Button
                        label="Decline change"
                        variant="ghost"
                        onPress={() => respondToScopeChange('DECLINED')}
                      />
                    </View>
                  ) : null}
                  {canCancelScopeChange ? (
                    <Button
                      label="Cancel request"
                      variant="ghost"
                      onPress={() => respondToScopeChange('CANCELLED')}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>
                    Use this for measurement amendments, style/reference changes, deadline shifts, pause/restart moments, or rework before handoff. Drapeon keeps the change tied to this order.
                  </Text>
                  <Button
                    label="Request change"
                    variant="secondary"
                    onPress={() => setShowScopeChange(true)}
                  />
                </>
              )}
            </View>
          )}

          {['CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED'].includes(order.stage) ? (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>Event emergency</Text>
              <Text style={styles.supportHint}>
                Use this only when a real wear date is at risk, the item cannot be worn, or delivery has gone wrong close to the event. Drapeon treats it as urgent ops review.
              </Text>
              <Button
                label="Request emergency help"
                variant="secondary"
                onPress={() => setShowEmergencySupport(true)}
              />
            </View>
          ) : null}

          {isCollection ? (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>
                {pickupDetailsUnlocked ? 'Pickup details' : 'Pickup plan'}
              </Text>
              {pickupDetailsUnlocked && order.pickupAddress ? (
                <>
                  <Text style={styles.supportBodyText}>{order.pickupAddress}</Text>
                  {order.pickupInstructions ? (
                    <Text style={styles.supportHint}>{order.pickupInstructions}</Text>
                  ) : (
                    <Text style={styles.supportHint}>
                      Bring your collection code and inspect the order before confirming pickup.
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.supportHint}>
                  {pickupDetailsUnlocked
                    ? 'Your seller marked this order ready for collection, but exact pickup details are still missing. Message them in Drapeon before travelling.'
                    : order.tailorLocation
                      ? `This is a pickup order in ${order.tailorLocation}. Exact pickup details appear once the seller marks the order ready for collection.`
                      : 'This is a pickup order. Exact pickup details appear once the seller marks the order ready for collection.'}
                </Text>
              )}
            </View>
          ) : null}

          {handoffHelpAvailable ? (
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>
                {handoffHelpCardTitle('CUSTOMER', order.deliveryMethod)}
              </Text>
              <Text style={styles.supportHint}>
                {handoffHelpCardBody('CUSTOMER', order.deliveryMethod)}
              </Text>
              {handoffIssue ? (
                <View style={styles.handoffIssueCard}>
                  <View style={styles.handoffIssueHeader}>
                    <Text style={styles.handoffIssueTitle}>
                      {handoffIssueLabel(handoffIssue.issueType)}
                    </Text>
                    <View
                      style={[
                        styles.handoffStatusPill,
                        handoffIssue.status === 'ESCALATED' && styles.handoffStatusPillEscalated,
                      ]}
                    >
                      <Text style={styles.handoffStatusText}>
                        {handoffIssueStatusLabel(handoffIssue.status)}
                      </Text>
                    </View>
                  </View>
                  {handoffIssue.description ? (
                    <Text style={styles.supportHint}>{handoffIssue.description}</Text>
                  ) : null}
                  <Text style={styles.supportHint}>
                    {handoffIssue.status === 'ESCALATED'
                      ? 'Drapeon support has been flagged for follow-up. Keep all updates in this order thread.'
                      : 'This handoff help thread is open inside Drapeon. Keep all updates here so the timeline stays clear.'}
                  </Text>
                  <Button
                    label="Mark help resolved"
                    variant="secondary"
                    onPress={() => {
                      void markHandoffIssueResolved()
                    }}
                    loading={resolvingHandoffIssue}
                    disabled={resolvingHandoffIssue}
                  />
                </View>
              ) : null}
              <View style={{ gap: Spacing.md }}>
                <Button
                  label={handoffOpsButtonLabel(order.deliveryMethod, !!handoffIssue)}
                  onPress={() => setShowHandoffSupport(true)}
                />
                <Button
                  label="Message tailor"
                  variant="secondary"
                  onPress={openOrderMessages}
                />
              </View>
            </View>
          ) : null}

          {/* Confirm receipt button — shipping path */}
          {['SHIPPED', 'OUT_FOR_DELIVERY'].includes(order.stage) &&
            !dispatchHandoffComplete &&
            order.deliveryMethod !== 'LOCAL_COLLECTION' && (
              <Button
                label="I've received my order"
                onPress={confirmReceipt}
                loading={confirming}
                disabled={confirming}
              />
            )}

          {showShipmentDetails ? (
            <View style={styles.trackingRow}>
              <View>
                <Text style={styles.trackingLabel}>
                  {order.deliveryMethod === 'LOCAL_DELIVERY'
                    ? 'Delivery details'
                    : 'Shipment details'}
                </Text>
                {dispatchRecord?.serviceLevel ? (
                  <Text style={styles.fabricSavedNote}>
                    Service level: {DISPATCH_SERVICE_LEVEL_LABELS[dispatchRecord.serviceLevel]}
                  </Text>
                ) : null}
                {order.fulfillmentProvider ? (
                  <Text style={styles.trackingNumber}>{order.fulfillmentProvider}</Text>
                ) : null}
                {order.trackingNumber ? (
                  <Text style={styles.fabricSavedNote}>
                    Tracking:{' '}
                    {safeOperationalText(
                      order.trackingNumber,
                      'Tracking reference saved in Drapeon'
                    )}
                  </Text>
                ) : null}
                {order.fulfillmentReference ? (
                  <Text style={styles.fabricSavedNote}>Reference: {order.fulfillmentReference}</Text>
                ) : null}
                {order.fulfillmentContactName ? (
                  <Text style={styles.fabricSavedNote}>Contact: {order.fulfillmentContactName}</Text>
                ) : null}
                {order.fulfillmentContactPhone ? (
                  <Text style={styles.fabricSavedNote}>
                    {safeOperationalText(
                      order.fulfillmentContactPhone,
                      'Courier contact saved in Drapeon'
                    )}
                  </Text>
                ) : null}
                {!order.fulfillmentProvider && order.carrier ? (
                  <Text style={styles.trackingNumber}>{order.carrier}</Text>
                ) : null}
              </View>
              {order.trackingNumber ? (
                <View style={styles.trackingAction}>
                  <Button
                    label="Track shipment"
                    variant="secondary"
                    onPress={() => {
                      void openTrackingPage({
                        trackingNumber: order.trackingNumber!,
                        carrier: order.fulfillmentProvider ?? order.carrier,
                        audience: 'customer',
                      })
                    }}
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          {showNonCollectionHandoffPanels ? (
            <SupportDisclosure
              title={
                order.deliveryMethod === 'LOCAL_DELIVERY'
                  ? 'Delivery protection'
                  : 'Shipping protection'
              }
              summary="What to do if handoff, courier, or tracking goes off track."
              defaultExpanded={!compressReadyMadeSupport}
            >
              <Text style={styles.supportHint}>
                Do not confirm receipt until the garment is actually in hand. If dispatch stalls,
                the rider or courier cannot be reached, or the handoff goes off track, keep the
                conversation in this order and open a concern here instead of trying to settle it
                offline.
              </Text>
            </SupportDisclosure>
          ) : null}

          {(wearerLabel || measurementSource || fitConfidence || measurementAgeText || measurementConfirmationNeeded) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Measurement check</Text>
              <View style={styles.supportCard}>
                <View style={styles.supportMetaList}>
                  {wearerLabel ? <SummaryLine label="Wearer" value={wearerLabel} /> : null}
                  {measurementSource ? (
                    <SummaryLine
                      label="Source"
                      value={
                        MEASUREMENT_SOURCE_LABELS[measurementSource] ?? String(measurementSource)
                      }
                    />
                  ) : null}
                  {fitConfidence ? (
                    <SummaryLine
                      label="Fit confidence"
                      value={FIT_CONFIDENCE_LABELS[fitConfidence] ?? String(fitConfidence)}
                    />
                  ) : null}
                  {measurementAgeText ? (
                    <SummaryLine label="Last updated" value={measurementAgeText} />
                  ) : null}
                </View>
                {measurementAge?.stale ? (
                  <Text style={styles.supportWarningText}>
                    These measurements are over {STALE_MEASUREMENT_MONTHS} months old. If your fit
                    changed, ask for a measurement amendment before cutting starts.
                  </Text>
                ) : null}
                {measurementConfirmationNeeded ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Confirmation needed before cutting
                      </Text>
                    </View>
                    {order.measurementSnapshot?.confirmationReason ? (
                      <Text style={styles.supportBodyText}>
                        {order.measurementSnapshot.confirmationReason}
                      </Text>
                    ) : null}
                    {measurementConfirmationFields.length > 0 ? (
                      <View style={styles.measurementConfirmGuideList}>
                        {measurementConfirmationFields.map((field) => {
                          const guide = measurementGuideForField(field)
                          return (
                            <View key={field} style={styles.measurementConfirmGuideCard}>
                              <Text style={styles.measurementConfirmGuideTitle}>
                                {labelMeasurementField(field)}
                              </Text>
                              {guide ? (
                                <Text style={styles.measurementConfirmGuideText}>{guide}</Text>
                              ) : (
                                <Text style={styles.measurementConfirmGuideText}>
                                  Confirm this value against your latest tape measurement before the
                                  tailor cuts.
                                </Text>
                              )}
                            </View>
                          )
                        })}
                      </View>
                    ) : null}
                    <Text style={styles.supportHint}>
                      Your tailor has paused cutting until you confirm these measurements are still
                      correct.
                    </Text>
                    <Button
                      label="Confirm measurements"
                      onPress={confirmMeasurements}
                      loading={confirmingMeasurements}
                      disabled={confirmingMeasurements}
                    />
                  </>
                ) : order.measurementSnapshot?.confirmedAt ? (
                  <Text style={styles.supportHint}>
                    Measurements were confirmed on{' '}
                    {new Date(order.measurementSnapshot.confirmedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    .
                  </Text>
                ) : (
                  <Text style={styles.supportHint}>
                    Your saved measurement source is attached to this order for fit review.
                  </Text>
                )}
              </View>
            </View>
          )}

          {fitProfile ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Fit notes</Text>
              <View style={styles.supportCard}>
                <View style={styles.supportMetaList}>
                  {fitProfile.status ? (
                    <SummaryLine
                      label="Status"
                      value={formatMeasurementStatusLabel(fitProfile.status)}
                    />
                  ) : null}
                  {fitProfile.fitIntent ? (
                    <SummaryLine
                      label="Fit direction"
                      value={FIT_INTENT_LABELS[fitProfile.fitIntent]}
                    />
                  ) : null}
                  {fitProfile.fabricStretch ? (
                    <SummaryLine
                      label="Stretch"
                      value={FABRIC_STRETCH_LABELS[fitProfile.fabricStretch]}
                    />
                  ) : null}
                  {fitProfile.wearDaySupport ? (
                    <SummaryLine
                      label="Support"
                      value={WEAR_DAY_SUPPORT_LABELS[fitProfile.wearDaySupport]}
                    />
                  ) : null}
                  {fitProfile.coveragePreference ? (
                    <SummaryLine
                      label="Coverage"
                      value={COVERAGE_PREFERENCE_LABELS[fitProfile.coveragePreference]}
                    />
                  ) : null}
                  {typeof fitProfile.heelHeightCm === 'number' ? (
                    <SummaryLine label="Heel height" value={`${fitProfile.heelHeightCm} cm`} />
                  ) : null}
                </View>
                {fitProfile.styleEaseNotes ? (
                  <Text style={styles.supportBodyText}>{fitProfile.styleEaseNotes}</Text>
                ) : null}
                {fitProfile.postureNote ? (
                  <Text style={styles.supportHint}>Posture: {fitProfile.postureNote}</Text>
                ) : null}
                {fitProfile.asymmetryNote ? (
                  <Text style={styles.supportHint}>Asymmetry: {fitProfile.asymmetryNote}</Text>
                ) : null}
                {fitProfile.tailorMeasurementOverrideReason ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusSuccess]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextSuccess]}>
                        Tailor reviewed these fit notes
                      </Text>
                    </View>
                    <Text style={styles.supportHint}>
                      {fitProfile.tailorMeasurementOverrideReason}
                    </Text>
                  </>
                ) : fitProfile.requiresTailorReview ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Tailor review will happen before cutting
                      </Text>
                    </View>
                    <Text style={styles.supportHint}>
                      Your tailor will review these fit notes before moving this order into cutting.
                    </Text>
                  </>
                ) : (
                  <Text style={styles.supportHint}>
                    These fit notes were attached to help your tailor quote and cut with more
                    context.
                  </Text>
                )}
              </View>
            </View>
          ) : null}

          {order.orderKind === 'CUSTOM' && (consultationMeta || quoteBreakdown || bulkOrder) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Quote setup</Text>
              {consultationMeta ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Consultation terms</Text>
                  <View style={styles.supportMetaList}>
                    <SummaryLine
                      label="Status"
                      value={formatConsultationStatusLabel(consultationMeta.status)}
                    />
                    <SummaryLine
                      label="Fee"
                      value={
                        consultationMeta.feeAmount && consultationMeta.feeCurrency
                          ? formatAmount(
                              consultationMeta.feeAmount,
                              consultationMeta.feeCurrency as CurrencyCode,
                              consultationMeta.feeCurrency as CurrencyCode,
                              STATIC_FALLBACK_RATES
                            )
                          : 'Free'
                      }
                    />
                    {consultationMeta.feeAmount ? (
                      <SummaryLine
                        label="Fee treatment"
                        value={
                          consultationMeta.feeCreditable
                            ? 'Counts toward the final order'
                            : 'Separate consultation fee'
                        }
                      />
                    ) : null}
                    {consultationMeta.scheduledStartAt ? (
                      <SummaryLine
                        label="Scheduled for"
                        value={formatConsultationStart(consultationMeta.scheduledStartAt, consultationMeta.timezone)}
                      />
                    ) : consultationMeta.proposedStartAt ? (
                      <SummaryLine
                        label="Requested time"
                        value={formatConsultationStart(consultationMeta.proposedStartAt, consultationMeta.timezone)}
                      />
                    ) : null}
                    {consultationMeta.paymentTiming ? (
                      <SummaryLine
                        label="Payment timing"
                        value={CONSULTATION_PAYMENT_TIMING_LABELS[consultationMeta.paymentTiming]}
                      />
                    ) : null}
                    {consultationMeta.reschedulePolicy ? (
                      <SummaryLine
                        label="Rescheduling"
                        value={
                          CONSULTATION_RESCHEDULE_POLICY_LABELS[consultationMeta.reschedulePolicy]
                        }
                      />
                    ) : null}
                    {consultationMeta.noShowPolicy ? (
                      <SummaryLine
                        label="No-show"
                        value={CONSULTATION_NO_SHOW_POLICY_LABELS[consultationMeta.noShowPolicy]}
                      />
                    ) : null}
                    {consultationMeta.expiryPolicy ? (
                      <SummaryLine
                        label="Window"
                        value={CONSULTATION_EXPIRY_POLICY_LABELS[consultationMeta.expiryPolicy]}
                      />
                    ) : null}
                  </View>
                  {consultationMeta.requestNote ? (
                    <Text style={styles.supportHint}>{consultationMeta.requestNote}</Text>
                  ) : null}
                </View>
              ) : null}

              {quoteBreakdown ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Pricing breakdown</Text>
                  <View style={styles.supportMetaList}>
                    {typeof quoteBreakdown.laborAmount === 'number' ? (
                      <SummaryLine
                        label="Labour"
                        value={formatAmount(
                          quoteBreakdown.laborAmount,
                          order.quotedCurrency,
                          order.quotedCurrency,
                          STATIC_FALLBACK_RATES
                        )}
                      />
                    ) : null}
                    {typeof quoteBreakdown.sourcingAmount === 'number' ? (
                      <SummaryLine
                        label="Sourcing"
                        value={formatAmount(
                          quoteBreakdown.sourcingAmount,
                          order.quotedCurrency,
                          order.quotedCurrency,
                          STATIC_FALLBACK_RATES
                        )}
                      />
                    ) : null}
                    {typeof quoteBreakdown.rushAmount === 'number' ? (
                      <SummaryLine
                        label="Rush fee"
                        value={formatAmount(
                          quoteBreakdown.rushAmount,
                          order.quotedCurrency,
                          order.quotedCurrency,
                          STATIC_FALLBACK_RATES
                        )}
                      />
                    ) : null}
                    {typeof quoteBreakdown.consultationCreditAmount === 'number' &&
                    quoteBreakdown.consultationCreditAmount > 0 ? (
                      <SummaryLine
                        label="Consultation fee credit"
                        value={`-${formatAmount(quoteBreakdown.consultationCreditAmount, order.quotedCurrency, order.quotedCurrency, STATIC_FALLBACK_RATES)}`}
                      />
                    ) : null}
                  </View>
                  {quoteBreakdown.summary ? (
                    <Text style={styles.supportBodyText}>{quoteBreakdown.summary}</Text>
                  ) : null}
                  {quoteBreakdown.included && quoteBreakdown.included.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Included: {quoteBreakdown.included.join(', ')}
                    </Text>
                  ) : null}
                  {quoteBreakdown.excluded && quoteBreakdown.excluded.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Not included: {quoteBreakdown.excluded.join(', ')}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {bulkOrder?.enabled ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Bulk order note</Text>
                  <View style={styles.supportMetaList}>
                    {bulkOrder.label ? <SummaryLine label="Group" value={bulkOrder.label} /> : null}
                    {bulkOrder.recipientCount ? (
                      <SummaryLine label="Recipients" value={`${bulkOrder.recipientCount}`} />
                    ) : null}
                    {bulkOrder.memberNames && bulkOrder.memberNames.length > 0 ? (
                      <SummaryLine label="Members" value={bulkOrder.memberNames.join(', ')} />
                    ) : null}
                    <SummaryLine
                      label="Handling"
                      value={
                        bulkOrder.statusPolicy === 'OPS_MANAGED_LINKED_CHILDREN'
                          ? 'Drapeon manages linked recipient timelines for this order.'
                          : 'Drapeon manages linked recipients and status flow for this order.'
                      }
                    />
                    <SummaryLine
                      label="Measurement privacy"
                      value={
                        bulkOrder.measurementPrivacy === 'TAILOR_ONLY'
                          ? 'Recipient measurements stay tailor-only.'
                          : 'Measurements stay private to the tailor.'
                      }
                    />
                    {bulkOrder.memberMeasurementPolicy ? (
                      <SummaryLine label="Measurement rule" value={bulkOrder.memberMeasurementPolicy} />
                    ) : null}
                    <SummaryLine
                      label="Payer model"
                      value={
                        bulkOrder.payerModel === 'SINGLE_PAYER'
                          ? 'One payer covers the whole group order'
                          : 'Single payer'
                      }
                    />
                    <SummaryLine
                      label="Dye-lot consistency"
                      value={
                        bulkOrder.dyeLotConsistencyRequired
                          ? 'Keep fabrics matched across the whole group'
                          : 'Not flagged'
                      }
                    />
                  </View>
                  {bulkOrder.notes ? (
                    <Text style={styles.supportHint}>{bulkOrder.notes}</Text>
                  ) : null}
                  {groupMembers.length > 0 ? (
                    <View style={styles.groupMemberList}>
                      {groupMembers.map((member) => (
                        <View key={member.id} style={styles.groupMemberRow}>
                          <View style={styles.groupMemberCopy}>
                            <Text style={styles.groupMemberName}>{member.displayName}</Text>
                            <Text style={styles.groupMemberStatus}>
                              {member.status === 'ACCEPTED'
                                ? 'Measurements attached'
                                : member.status === 'DECLINED'
                                  ? 'Invite declined'
                                  : member.status === 'INVITED'
                                    ? 'Invite sent'
                                    : 'Invite not sent'}
                            </Text>
                          </View>
                          {member.status === 'ACCEPTED' ? (
                            <View style={styles.groupMemberBadge}>
                              <Feather name="check" size={14} color={Colors.needleGreenDark} />
                              <Text style={styles.groupMemberBadgeText}>Ready</Text>
                            </View>
                          ) : member.status === 'REMOVED' ? null : (
                            <TouchableOpacity
                              style={styles.groupInviteButton}
                              onPress={() => { void shareGroupInvite(member) }}
                              activeOpacity={0.75}
                            >
                              <Text style={styles.groupInviteButtonText}>
                                {member.status === 'INVITED' ? 'Reshare' : 'Invite'}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {order.fabricFundingPolicyVersion !== 'fabric-funding-2026-08-21-v2' && (order.fabricSource === 'CUSTOMER_SUPPLIES' ||
            fabricHandoffLabel ||
            fabricPolicy ||
            materialIssue) && (
            <View style={styles.section}>
              <SupportDisclosure
                title="Fabric handoff"
                summary={
                  order.supportMeta.fabricReceivedAt
                    ? 'Received and recorded'
                    : sourcedFabricPending
                      ? 'Your approval is needed'
                      : fabricHandoffLabel ?? (order.fabricSource === 'CUSTOMER_SUPPLIES' ? 'You supply the fabric' : 'Tailor sources fabric')
                }
                defaultExpanded={Boolean(sourcedFabricPending || showFabricTrackingSection)}
              >
                <View style={styles.supportMetaList}>
                  <SummaryLine
                    label="Fabric source"
                    value={
                      order.fabricSource === 'CUSTOMER_SUPPLIES'
                        ? 'You supply the fabric'
                        : 'Tailor sources fabric'
                    }
                  />
                  {fabricHandoffLabel ? (
                    <SummaryLine label="Handoff plan" value={fabricHandoffLabel} />
                  ) : order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                    <SummaryLine
                      label="Handoff plan"
                      value="To be confirmed in chat or consultation"
                    />
                  ) : null}
                </View>
                {order.supportMeta.fabricReceivedAt ? (
                  <View style={[styles.supportStatusBadge, styles.supportStatusSuccess]}>
                    <Text style={[styles.supportStatusText, styles.supportStatusTextSuccess]}>
                      Tailor confirmed fabric receipt
                    </Text>
                  </View>
                ) : null}
                {order.supportMeta.fabricReceivedAt ? (
                  <Text style={styles.supportHint}>
                    Confirmed on{' '}
                    {new Date(order.supportMeta.fabricReceivedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {order.supportMeta.fabricReceivedNote
                      ? ` · ${order.supportMeta.fabricReceivedNote}`
                      : ''}
                    .
                  </Text>
                ) : showFabricTrackingSection ? (
                  <View style={styles.fabricTrackingAction}>
                    <Text style={styles.supportBodyText}>Add the shipping reference when the fabric is on its way.</Text>
                    <View style={styles.fabricInputRow}>
                      <TextInput
                        style={styles.fabricInput}
                        placeholder="Tracking or shipping reference"
                        placeholderTextColor={Colors.midGrey}
                        value={fabricTracking}
                        onChangeText={setFabricTracking}
                        editable={!savingFabric}
                        autoCapitalize="characters"
                        autoCorrect={false}
                      />
                      <TouchableOpacity
                        style={[
                          styles.fabricSaveBtn,
                          (!fabricTracking.trim() || fabricTracking === order.fabricTracking) &&
                            styles.fabricSaveBtnDisabled,
                        ]}
                        onPress={saveFabricTracking}
                        disabled={
                          !fabricTracking.trim() ||
                          fabricTracking === order.fabricTracking ||
                          savingFabric
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Save fabric tracking"
                      >
                        {savingFabric ? (
                          <ActivityIndicator color={Colors.textInverse} size="small" />
                        ) : (
                          <Text style={styles.fabricSaveBtnText}>Save</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                    {order.fabricTracking ? (
                      <Text style={styles.fabricSavedNote}>
                        Saved: {order.fabricTracking}
                      </Text>
                    ) : null}
                  </View>
                ) : order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                  <Text style={styles.supportHint}>
                    Share dropoff photos, courier tracking, or a receipt in the order thread until the tailor confirms the fabric is in hand.
                  </Text>
                ) : (
                  <Text style={styles.supportHint}>
                    The tailor will source materials from the accepted quote instead of waiting on a
                    customer handoff. Ask for fabric proof here before approving cutting if color,
                    texture, or quality matters. For color-sensitive fabric, ask them to place a
                    white piece of paper beside the fabric in natural light.
                  </Text>
                )}
                {order.fabricSource === 'TAILOR_SOURCES' &&
                order.customDetail?.fabricDescription ? (
                  <Text style={styles.supportHint}>
                    Fabric requested: {order.customDetail.fabricDescription}
                  </Text>
                ) : null}
                {order.fabricSource === 'TAILOR_SOURCES' &&
                order.customDetail?.fabricApprovalStatus ? (
                  <View
                    style={[
                      styles.supportStatusBadge,
                      order.customDetail.fabricApprovalStatus === 'APPROVED'
                        ? styles.supportStatusSuccess
                        : styles.supportStatusWarning,
                    ]}
                  >
                    <Text
                      style={[
                        styles.supportStatusText,
                        order.customDetail.fabricApprovalStatus === 'APPROVED'
                          ? styles.supportStatusTextSuccess
                          : styles.supportStatusTextWarning,
                      ]}
                    >
                      {order.customDetail.fabricApprovalStatus === 'APPROVED'
                        ? 'Sourced fabric approved'
                        : order.customDetail.fabricApprovalStatus === 'CHANGES_REQUESTED'
                          ? 'Fabric changes requested'
                          : order.customDetail.fabricApprovalStatus === 'PENDING_CUSTOMER_APPROVAL'
                            ? 'Your fabric approval is needed'
                            : 'Fabric approval pending'}
                    </Text>
                  </View>
                ) : null}
              </SupportDisclosure>
              {fabricPolicy ? (
                <SupportDisclosure
                  title="Fabric rules and exceptions"
                  summary="Preparation, rejection, late fabric, replacements, and disputes"
                  defaultExpanded={false}
                >
                  {fabricPolicy.rejectionReasons && fabricPolicy.rejectionReasons.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Tailor can reject before cutting for:{' '}
                      {fabricPolicy.rejectionReasons.join(' · ')}
                    </Text>
                  ) : null}
                  {fabricPolicy.prepRequirements && fabricPolicy.prepRequirements.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Preparation: {fabricPolicy.prepRequirements.join(' · ')}
                    </Text>
                  ) : null}
                  {fabricPolicy.lateFabricRule ? (
                    <Text style={styles.supportHint}>
                      If fabric is late: {fabricPolicy.lateFabricRule}
                    </Text>
                  ) : null}
                  {fabricPolicy.missingFabricRule ? (
                    <Text style={styles.supportHint}>
                      If fabric never arrives: {fabricPolicy.missingFabricRule}
                    </Text>
                  ) : null}
                  {fabricPolicy.replacementRule ? (
                    <Text style={styles.supportHint}>
                      Replacement: {fabricPolicy.replacementRule}
                    </Text>
                  ) : null}
                  {fabricPolicy.disagreementRule ? (
                    <Text style={styles.supportHint}>
                      If suitability is disputed: {fabricPolicy.disagreementRule}
                    </Text>
                  ) : null}
                </SupportDisclosure>
              ) : null}
            </View>
          )}

          {materialIssue ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Material issue</Text>
              <View style={[styles.supportCard, materialIssueOpen && styles.supportCardWarning]}>
                {materialIssueReasonLabel ? (
                  <SummaryLine label="Issue" value={materialIssueReasonLabel} />
                ) : null}
                {materialIssue.note ? (
                  <Text style={styles.supportBodyText}>{materialIssue.note}</Text>
                ) : null}
                {materialIssueNeedsResponse ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Your decision is needed before cutting
                      </Text>
                    </View>
                    <Text style={styles.supportHint}>
                      Choose how you want to handle the fabric issue so the order can move forward
                      cleanly.
                    </Text>
                    <Button
                      label="Respond to fabric issue"
                      onPress={() => setShowMaterialIssueResponse(true)}
                    />
                  </>
                ) : materialIssueCancellationRequested ? (
                  <>
                    <View style={[styles.supportStatusBadge, styles.supportStatusWarning]}>
                      <Text style={[styles.supportStatusText, styles.supportStatusTextWarning]}>
                        Cancellation request sent for review
                      </Text>
                    </View>
                    {materialIssueResponseLabel ? (
                      <Text style={styles.supportHint}>
                        Your response: {materialIssueResponseLabel}.
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <>
                    {materialIssueResponseLabel ? (
                      <SummaryLine label="Your response" value={materialIssueResponseLabel} />
                    ) : null}
                    {materialIssue.responseNote ? (
                      <Text style={styles.supportHint}>{materialIssue.responseNote}</Text>
                    ) : null}
                    {materialIssue.status === 'RESOLVED' ? (
                      <View style={[styles.supportStatusBadge, styles.supportStatusSuccess]}>
                        <Text style={[styles.supportStatusText, styles.supportStatusTextSuccess]}>
                          Material issue resolved
                        </Text>
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            </View>
          ) : null}

          {closedMaterialAdvances.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Material advance</Text>
              {closedMaterialAdvances.map((advance) => {
                const amountLabel = formatAmount(
                  advance.amount,
                  advance.currency,
                  advance.currency,
                  STATIC_FALLBACK_RATES
                )
                const needsDecision = advance.status === 'REQUESTED'
                const needsPayment = advance.status === 'PAYMENT_PENDING' || advance.status === 'PAYMENT_FAILED'
                const reconciliationCopy = materialReconciliationCopy({ outcome: advance.reconciliationOutcome, resolution: advance.reconciliationResolution, customerRefundAmount: advance.customerRefundAmount, unapprovedOverageAmount: advance.unapprovedOverageAmount, actorRole: 'CUSTOMER' })
                return (
                  <View
                    key={advance.id}
                    style={[styles.supportCard, (needsDecision || needsPayment || advance.status === 'BLOCKED') && styles.supportCardWarning]}
                  >
                    <View style={styles.disclosureHeader}>
                      <View style={styles.disclosureCopy}>
                        <Text style={styles.supportCardTitle}>{advance.title}</Text>
                        <Text style={styles.supportHint}>
                          {formatMaterialAdvanceStatusLabel(advance.status, 'customer')}
                        </Text>
                      </View>
                      <Text style={styles.disclosureAction}>{amountLabel}</Text>
                    </View>
                    <Text style={styles.supportBodyText}>{advance.description}</Text>
                    <Text style={styles.supportHint}>
                      This is separate from the main escrow. Drapeon only releases the approved material amount after payment and ops review.
                    </Text>
                    {advance.estimateStorageBucket && advance.estimateStoragePath ? (
                      <Button label="View proof" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'estimate') }} />
                    ) : (
                      <View style={styles.materialProofMissing}>
                        <Text style={styles.materialProofMissingTitle}>Supplier proof unavailable</Text>
                        <Text style={styles.supportHint}>This request cannot be approved without an estimate or supplier photo.</Text>
                      </View>
                    )}
                    {advance.customerResponseReason ? (
                      <Text style={styles.supportHint}>Decision reason: {materialAdvanceDeclineReasonLabel(advance.customerResponseReason) ?? 'Not specified'}</Text>
                    ) : null}
                    {advance.customerResponseNote ? (
                      <Text style={styles.supportHint}>Your note: {advance.customerResponseNote}</Text>
                    ) : null}
                    {advance.receiptStoragePath ? (
                      <Button label="View final receipt" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'receipt') }} />
                    ) : null}
                    {advance.acquiredStoragePath ? (
                      <Button label="View acquired fabric" variant="secondary" onPress={() => { void openMaterialAdvanceEvidence(advance, 'acquired') }} />
                    ) : null}
                    {reconciliationCopy ? (
                      <View style={[styles.supportStatusBadge, reconciliationCopy.tone === 'success' ? styles.supportStatusSuccess : styles.supportStatusWarning]} accessibilityRole="summary">
                        <Text style={[styles.supportStatusText, reconciliationCopy.tone === 'success' ? styles.supportStatusTextSuccess : styles.supportStatusTextWarning]}>{reconciliationCopy.title}</Text>
                        <Text style={styles.supportHint}>{reconciliationCopy.body}</Text>
                        {advance.customerRefundAmount > 0 ? <Text style={styles.supportStatusText}>Refund value: {formatAmount(advance.customerRefundAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                        {advance.unapprovedOverageAmount > 0 ? <Text style={styles.supportStatusText}>Unapproved overage: {formatAmount(advance.unapprovedOverageAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                      </View>
                    ) : null}
                    {needsDecision ? (
                      <View style={styles.inlineActions}>
                        <Button
                          label="Approve"
                          onPress={() => respondToMaterialAdvance(advance, 'APPROVE')}
                          loading={respondingAdvanceId === advance.id}
                          disabled={!!respondingAdvanceId || !advance.estimateStorageBucket || !advance.estimateStoragePath}
                        />
                        <Button
                          label="Decline"
                          variant="secondary"
                          onPress={() => openMaterialAdvanceDecline(advance)}
                          disabled={!!respondingAdvanceId}
                        />
                      </View>
                    ) : needsPayment ? (
                      <Button
                        label={advance.status === 'PAYMENT_FAILED' ? 'Retry payment' : 'Pay material advance'}
                        onPress={() => payMaterialAdvance(advance)}
                        loading={payingAdvanceId === advance.id}
                        disabled={!!payingAdvanceId}
                      />
                    ) : null}
                  </View>
                )
              })}
            </View>
          ) : null}

          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Aftercare</Text>
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Fit or finish issue?</Text>
                <Text style={styles.supportHint}>
                  Raise obvious fit or finish issues within 14 days. If you spot a credible
                  workmanship issue later, tell support as early as possible and ideally within 30
                  days. Keep photos, tailoring notes, and any local alteration receipts in Drapeon.
                </Text>
                <Text style={styles.supportHint}>{aftercareStatus.message}</Text>
                <Button
                  label={
                    aftercareStatus.available ? 'Log aftercare issue in Drapeon' : 'Contact support'
                  }
                  onPress={() => {
                    if (aftercareStatus.available) {
                      setShowAftercareSupport(true)
                      return
                    }
                    void contactSupport('aftercare')
                  }}
                />
              </View>
            </View>
          )}

          {/* Review CTA — terminal stages without a review yet */}
          {['COMPLETE', 'DELIVERED', 'COLLECTED'].includes(order.stage) && !hasReview && (
            <TouchableOpacity
              style={styles.reviewCta}
              onPress={() =>
                router.push({
                  pathname: '/(customer)/review/[orderId]',
                  params: {
                    orderId: order.id,
                    historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
                  },
                })
              }
              activeOpacity={0.85}
            >
              <View style={styles.reviewCtaInner}>
                <Text style={styles.reviewCtaTitle}>
                  {order.stage === 'COMPLETE' ? 'Leave a review' : 'Finish this order'}
                </Text>
                <Text style={styles.reviewCtaHint}>
                  {order.stage === 'COMPLETE'
                    ? `Share how it went with ${order.tailorName.split(' ')[0]}`
                    : 'Review is optional on the next screen.'}
                </Text>
              </View>
              <Text style={styles.reviewCtaArrow}>
                {order.stage === 'COMPLETE' ? '★  Rate' : 'Finish →'}
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.section}>
            <SupportDisclosure
              title={briefDossier.title}
              summary="Summary, style refs, fabric plan, measurements, fulfillment, bulk details, and proof."
              defaultExpanded={false}
            >
              <View style={styles.dossierList}>
                {briefDossier.sections.map((section) => (
                  <CustomerBriefDossierCard
                    key={section.id}
                    section={section}
                    onOpenLink={openDossierLink}
                    onOpenMedia={openMediaPreview}
                    defaultExpanded={false}
                  />
                ))}
              </View>
            </SupportDisclosure>
          </View>

          {order.orderKind === 'READY_MADE' && (
            <View style={styles.section}>
              <SupportDisclosure
                title="Purchase details"
                summary={readyMadePurchaseSummary ?? 'Item, fulfillment, and payment details.'}
                defaultExpanded={false}
              >
                <View style={styles.timelineContent}>
                {order.itemTitle ? <SummaryLine label="Item" value={order.itemTitle} /> : null}
                {order.itemSize ? <SummaryLine label="Size" value={order.itemSize} /> : null}
                <SummaryLine label="Quantity" value={`${order.itemQuantity}`} />
                {order.fulfillmentOption ? (
                  <SummaryLine
                    label="Fulfillment"
                    value={fulfillmentOptionLabel(order.fulfillmentOption, order.deliveryMethod)}
                  />
                ) : null}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.recipientName ? (
                  <SummaryLine label="Recipient" value={order.recipientName} />
                ) : null}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.recipientPhone ? (
                  <SummaryLine
                    label="Recipient phone"
                    value={
                      safeOperationalText(order.recipientPhone, 'Phone saved in Drapeon') ??
                      'Phone saved in Drapeon'
                    }
                  />
                ) : null}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' && order.deliveryAddress ? (
                  <SummaryLine
                    label={order.deliveryMethod === 'LOCAL_DELIVERY' ? 'Deliver to' : 'Ship to'}
                    value={order.deliveryAddress}
                  />
                ) : null}
                <SummaryLine
                  label={order.orderKind === 'READY_MADE' ? 'Item subtotal' : 'Quote amount'}
                  value={formatAmount(
                    order.subtotalAmount,
                    order.quotedCurrency,
                    order.quotedCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                />
                <SummaryLine
                  label={fulfillmentFeeLabel(order)}
                  value={
                    order.shippingAmount > 0
                      ? formatAmount(
                          order.shippingAmount,
                          order.quotedCurrency,
                          order.quotedCurrency,
                          STATIC_FALLBACK_RATES
                        )
                      : 'Free'
                  }
                />
                <SummaryLine
                  label={taxLabelForOrder(order)}
                  value={formatAmount(
                    order.taxAmount,
                    order.quotedCurrency,
                    order.quotedCurrency,
                    STATIC_FALLBACK_RATES
                  )}
                />
                {order.totalAmount > 0 ? (
                  <SummaryLine
                    label="Total"
                    value={formatAmount(
                      order.totalAmount,
                      order.quotedCurrency,
                      order.quotedCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  />
                ) : order.quotedAmount != null ? (
                  <SummaryLine
                    label="Total"
                    value={formatAmount(
                      order.quotedAmount,
                      order.quotedCurrency,
                      order.quotedCurrency,
                      STATIC_FALLBACK_RATES
                    )}
                  />
                ) : null}
                {order.taxFallback ? (
                  <Text style={styles.helperText}>
                    Tax was estimated because live tax lookup was unavailable for this delivery
                    address.
                  </Text>
                ) : null}
                {order.deliveryMethod !== 'LOCAL_COLLECTION' ? (
                  <Text style={styles.helperText}>
                    This includes Drapeon's standard{' '}
                    {order.deliveryMethod === 'LOCAL_DELIVERY' ? 'delivery' : 'shipping'} fee.
                    Carrier surcharges, customs, or import duties are never charged automatically;
                    Drapeon will ask you to approve anything extra before dispatch.
                  </Text>
                ) : null}
                </View>
              </SupportDisclosure>
            </View>
          )}

          <SupportDisclosure
            title="Order history"
            summary={orderHistorySummary({
              updateCount: order.stageUpdates.length + 1,
              lastUpdatedLabel: formatTimelineTimestamp(latestHistoryUpdate?.createdAt ?? order.createdAt),
              latestEventLabel: latestHistoryUpdate
                ? historyUpdateLabel(latestHistoryUpdate, true)
                : 'Order submitted',
            })}
            defaultExpanded={false}
          >
            <Text style={styles.supportHint}>
              Milestones, notes, and evidence stay together here. Tap any photo or video to view it full screen.
            </Text>
            <View style={styles.timeline}>
              <View style={styles.timelineItem}>
                <View style={[styles.timelineDot, { backgroundColor: Colors.needleGreen }]} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineStage}>Order submitted</Text>
                  <Text style={styles.timelineDate}>
                    {formatTimelineTimestamp(order.createdAt)}
                  </Text>
                </View>
              </View>
              {order.stageUpdates.map((u) => (
                <View key={u.id} style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: timelineDotColor(u) }]} />
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineStage}>
                      {historyUpdateLabel(u)}
                    </Text>
                    {u.note && (
                      <Text style={styles.timelineNote}>{formatOrderUpdateNote(u.note)}</Text>
                    )}
                    {u.photoUrl ? (() => {
                      const mediaIndex = timelineMediaItems.findIndex((item) => item.uri === u.photoUrl)
                      return (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${historyUpdateLabel(u)} evidence`}
                          accessibilityHint="Opens the order evidence gallery full screen"
                          activeOpacity={0.88}
                          onPress={() => openMediaPreview(timelineMediaItems, Math.max(0, mediaIndex))}
                        >
                          <StageMediaPreview
                            uri={u.photoUrl}
                            style={styles.timelinePhoto}
                            surface="customer_order_timeline_photo"
                            accessibilityLabel="Order timeline proof"
                          />
                        </TouchableOpacity>
                      )
                    })() : null}
                    <Text style={styles.timelineDate}>{formatTimelineTimestamp(u.createdAt)}</Text>
                  </View>
                </View>
              ))}
            </View>
            {timelineMosaicItems.length > 0 ? (
              <View style={{ gap: Spacing.sm }}>
                <Text style={styles.supportCardTitle}>All production evidence</Text>
                <DrapeMediaMosaic
                  items={timelineMosaicItems}
                  compact
                  onPressItem={(_, index) => openMediaPreview(timelineMediaItems, index)}
                  testID="customer-order-history-media"
                />
              </View>
            ) : null}
          </SupportDisclosure>

          <OpsRefundStatusCard orderId={order.id} actorRole="CUSTOMER" />
          {order.stage !== 'COMPLETE' ? (
            <ReturnResolutionCard
              orderId={order.id}
              actorRole="CUSTOMER"
              currency={order.quotedCurrency}
              allowOpen={['DELIVERED', 'COLLECTED'].includes(order.stage)}
              onChanged={fetchOrder}
            />
          ) : null}
          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) ? <OrderTipCard orderId={order.id} actorRole="CUSTOMER" currency={order.quotedCurrency} onChanged={fetchOrder} /> : null}
          {order.stage !== 'COMPLETE' ? <CommercialAdjustmentCard orderId={order.id} actorRole="CUSTOMER" onChanged={fetchOrder} /> : null}

          {(!deliveryReviewOpen && canRequestDeliveryReview) ||
          (!cancellationReviewOpen && showCancellationPolicyCard) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Help &amp; order options</Text>
              {!deliveryReviewOpen && canRequestDeliveryReview ? (
                <SupportDisclosure
                  title="Shipping & delivery help"
                  summary="Tracking, custody, damage, customs, or delivery support"
                  defaultExpanded={false}
                >
                  <Text style={styles.supportHint}>
                    Available after payment, including after completion. Report tracking, custody,
                    recipient, customs, damage, missing contents, or delivery problems here.
                  </Text>
                  <Button
                    label="Get shipping or delivery help"
                    variant="secondary"
                    onPress={() => setShowDeliveryReview(true)}
                  />
                </SupportDisclosure>
              ) : null}
              {!cancellationReviewOpen && showCancellationPolicyCard ? (
                <SupportDisclosure
                  title={cancellationCardTitle}
                  summary={canSelfCancelOrder ? 'Stop this order before the next step.' : 'Policy and reviewed cancellation options'}
                  defaultExpanded={false}
                >
                  <Text style={styles.supportHint}>{cancellationPolicy.customerMessage}</Text>
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}
                    </Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>
                      Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}
                    </Text>
                  ) : null}
                  {canSelfCancelOrder ? (
                    <Button
                      label="Cancel this order"
                      variant="secondary"
                      onPress={() => { void cancelOrderDirectly() }}
                    />
                  ) : canRequestCancellationReview ? (
                    <Button
                      label="Request cancellation review"
                      variant="secondary"
                      onPress={() => setShowCancellationReview(true)}
                    />
                  ) : null}
                </SupportDisclosure>
              ) : null}
            </View>
          ) : null}

          {[
            'CONFIRMED',
            'DESIGNING',
            'SOURCING',
            'CUTTING',
            'SEWING',
            'FINISHING',
            'OUT_FOR_DELIVERY',
            'SHIPPED',
            'READY_FOR_COLLECTION',
          ].includes(order.stage) && (
            <TouchableOpacity style={styles.disputeEntry} onPress={() => setShowDispute(true)}>
              <Text style={styles.disputeEntryText}>Something wrong? Raise a concern</Text>
            </TouchableOpacity>
          )}
          {order.stage === 'IN_DISPUTE' && (
            <TouchableOpacity
              style={styles.disputeEntry}
              onPress={() => {
                void contactSupport()
              }}
            >
              <Text style={styles.disputeEntryText}>Need help with this concern? Contact support</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {showDispute ? (
        <DisputeModal
          key={`dispute-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowDispute(false)}
          onSubmitted={() => {
            setShowDispute(false)
            fetchOrder()
          }}
        />
      ) : null}

      {showCancellationReview ? (
        <CancellationReviewModal
          key={`cancellation-review-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowCancellationReview(false)}
          onSubmitted={() => {
            setShowCancellationReview(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showDeliveryReview ? (
        <DeliveryReviewModal
          key={`delivery-review-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowDeliveryReview(false)}
          onSubmitted={() => {
            setShowDeliveryReview(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showAftercareSupport ? (
        <AftercareSupportModal
          key={`aftercare-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowAftercareSupport(false)}
          onSubmitted={() => {
            setShowAftercareSupport(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showMaterialIssueResponse ? (
        <MaterialIssueResponseModal
          key={`material-response-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowMaterialIssueResponse(false)}
          onSubmitted={() => {
            setShowMaterialIssueResponse(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showScopeChange ? (
        <ScopeChangeModal
          key={`scope-change-${order.id}`}
          visible
          orderId={order.id}
          currency={order.quotedCurrency}
          onClose={() => setShowScopeChange(false)}
          onSubmitted={() => {
            setShowScopeChange(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showEmergencySupport ? (
        <EmergencySupportModal
          key={`emergency-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowEmergencySupport(false)}
          onSubmitted={() => {
            setShowEmergencySupport(false)
            void fetchOrder()
          }}
        />
      ) : null}

      <DrapeSheet
        visible={showCompletionPrompt}
        title={order.deliveryMethod === 'LOCAL_COLLECTION' ? 'Pickup complete' : 'Delivered — how did it go?'}
        subtitle="Rate the order or send an optional thank-you. You can do either one now."
        onDismiss={() => setShowCompletionPrompt(false)}
        scrollable
        snapPoints={['82%']}
        enableDynamicSizing={false}
        primaryAction={{
          label: 'Rate this order',
          tone: 'primary',
          onPress: () => {
            setShowCompletionPrompt(false)
            router.push({
              pathname: '/(customer)/review/[orderId]',
              params: {
                orderId: order.id,
                historyChain: appendToHistory(historyChain, `/(customer)/orders/${order.id}`),
              },
            })
          },
        }}
        secondaryAction={{
          label: 'Maybe later',
          tone: 'secondary',
          onPress: () => setShowCompletionPrompt(false),
        }}
        testID="order-completion-prompt"
      >
        <OrderTipCard
          orderId={order.id}
          actorRole="CUSTOMER"
          currency={order.quotedCurrency}
          onChanged={fetchOrder}
        />
      </DrapeSheet>

      <DrapeMediaViewer
        items={mediaPreview?.items ?? []}
        activeIndex={mediaPreview?.index ?? null}
        onDismiss={() => setMediaPreview(null)}
        testID="order-dossier-media-viewer"
      />

      <DrapeSheet
        visible={showStyleChangeFeedback}
        title="Requested style clarification"
        subtitle="Your feedback"
        onDismiss={() => setShowStyleChangeFeedback(false)}
        scrollable
        snapPoints={['44%']}
        enableDynamicSizing={false}
      >
        <Text style={styles.decisionFeedbackBody}>
          {decodeDisplayText(styleChangeFeedback?.feedback ?? '')}
        </Text>
      </DrapeSheet>

      <DrapeSheet
        visible={!!decliningAdvance}
        title="Decline material request"
        subtitle={decliningAdvance ? `${decliningAdvance.title} · Tell the tailor what should happen next.` : undefined}
        onDismiss={() => setDecliningAdvance(null)}
        scrollable
        snapPoints={['72%']}
        enableDynamicSizing={false}
        primaryAction={{
          label: respondingAdvanceId === decliningAdvance?.id ? 'Declining...' : 'Decline request',
          onPress: submitMaterialAdvanceDecline,
          loading: respondingAdvanceId === decliningAdvance?.id,
          disabled: !!respondingAdvanceId,
          tone: 'destructive',
        }}
        secondaryAction={{
          label: 'Cancel',
          onPress: () => setDecliningAdvance(null),
          disabled: !!respondingAdvanceId,
          tone: 'secondary',
        }}
      >
        <View>
          <Text style={disputeStyles.label}>Why are you declining?</Text>
          {MATERIAL_ADVANCE_DECLINE_REASONS.map((reason) => (
            <TouchableOpacity
              key={reason}
              accessibilityRole="radio"
              accessibilityState={{ selected: materialAdvanceDeclineReason === reason }}
              style={[
                disputeStyles.reasonRow,
                materialAdvanceDeclineReason === reason && disputeStyles.reasonRowActive,
              ]}
              disabled={!!respondingAdvanceId}
              onPress={() => setMaterialAdvanceDeclineReason(reason)}
            >
              <View style={[
                disputeStyles.radio,
                materialAdvanceDeclineReason === reason && disputeStyles.radioActive,
              ]} />
              <Text style={[
                disputeStyles.reasonText,
                materialAdvanceDeclineReason === reason && disputeStyles.reasonTextActive,
              ]}>
                {MATERIAL_ADVANCE_DECLINE_REASON_LABELS[reason]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Input
          label={materialAdvanceDeclineReason === 'OTHER' ? 'Explanation *' : 'Note (optional)'}
          placeholder="Add useful context for the tailor."
          value={materialAdvanceDeclineNote}
          onChangeText={setMaterialAdvanceDeclineNote}
          multiline
          maxLength={300}
        />
      </DrapeSheet>

      <HandoffSupportModal
        visible={showHandoffSupport}
        orderId={order.id}
        role="CUSTOMER"
        deliveryMethod={order.deliveryMethod}
        onClose={() => setShowHandoffSupport(false)}
        onSubmitted={() => {
          setShowHandoffSupport(false)
          void fetchOrder()
        }}
      />
      {showConsultationReschedule && order ? (
        <ConsultationRescheduleModal
          visible
          orderId={order.id}
          counterpartName={order.tailorName}
          onClose={() => setShowConsultationReschedule(false)}
          onSent={() => {
            setShowConsultationReschedule(false)
            setConsultationReschedulePending(true)
            Alert.alert('New time sent', `Your current time stays booked until ${order.tailorName.split(' ')[0]} accepts the replacement.`)
            void fetchOrder({ silent: true })
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}


function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryLine}>
      <Text style={styles.summaryLineLabel}>{label}</Text>
      <Text style={styles.summaryLineValue}>{decodeDisplayText(value)}</Text>
    </View>
  )
}




// ─── Dispute Modal ────────────────────────────────────────────────────────────

// V1.1 TODO: extract to locale strings for i18n
// Customer support and resolution dialogs live in CustomerOrderDialogs.


// ─── Quote Review Screen ──────────────────────────────────────────────────────
