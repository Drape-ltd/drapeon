import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { TailorOrderDetailQueryRow } from '@/features/orders/tailor/TailorOrderQueryTypes'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, AppState, TextInput, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, Linking,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter, useNavigation } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { DrapeDateTimePicker as DateTimePicker } from '@/components/ui/DrapeDateTimePicker'
import { ConsultationAttendancePanel } from '@/components/ui/ConsultationAttendancePanel'
import { CommercialReceiptCard } from '@/components/ui/CommercialReceiptCard'
import { FabricWorkflowCard } from '@/components/ui/FabricWorkflowCard'
import { ImageCropEditor } from '@/components/ui/ImageCropEditor'
import { TaxDecisionSummaryCard } from '@/components/ui/TaxDecisionSummaryCard'
import { ConsultationReschedulePanel } from '@/components/ui/ConsultationReschedulePanel'
import { ConsultationLifecyclePanel } from '@/components/ui/ConsultationLifecyclePanel'
import { CommercialAdjustmentCard } from '@/components/ui/CommercialAdjustmentCard'
import { ExtensionRequestCard } from '@/components/ui/ExtensionRequestCard'
import { SettlementProgressCard } from '@/components/ui/SettlementProgressCard'
import { DrapeonDispatchCard } from '@/components/ui/DrapeonDispatchCard'
import { ReturnResolutionCard } from '@/components/ui/ReturnResolutionCard'
import { OpsRefundStatusCard } from '@/components/ui/OpsRefundStatusCard'
import { OrderTipCard } from '@/components/ui/OrderTipCard'
import { Feather } from '@expo/vector-icons'
import { formatExplicitZonedDateTime } from '@drape/shared/date-time'
import {
  canSubmitTailorFabricApproval,
  FABRIC_FUNDING_POLICY_V2_VERSION,
  formatCallCountdown,
  formatMoneyInputValue,
  getCallLifecycleState,
  deriveFulfillmentAwareHistoryLabel,
  deriveFulfillmentAwareOrderStagePresentation,
  isMeaningfulTailorQuoteDraft,
  materialReconciliationCopy,
  parseMoneyInputToMinorUnits,
  recommendedSchedulingStartDate,
  QUOTE_ORDER_REVIEW_COPY,
  QUOTE_ORDER_REVIEW_VERSION,
  TAILOR_QUOTE_DRAFT_VERSION,
  type AccountCurrencyCode,
  type DispatchFulfillmentPresentation,
  type TailorQuoteDraftFields,
} from '@drape/shared'
import { supabase, invokeFunction } from '@/lib/supabase'
import { fetchReadGateway } from '@/lib/read-gateway'
import { useAuth } from '@/lib/auth'
import { capture } from '@/lib/analytics'
import { appendToHistory, goBackOrReturnTo, pickSafeReturnTo, resetTo } from '@/lib/navigation'
import { useContextualBackHandler } from '@/lib/use-contextual-back'
import { isLikelyConnectivityIssue, readFunctionErrorMessage, readFunctionErrorPayload } from '@/lib/function-errors'
import { Sentry } from '@/lib/sentry'
import { uploadPrivateStorageImage, uploadPublicStorageImage } from '@/lib/storage-upload'
import { launchImagePickerSafely, preferCompatibleVideoRepresentation } from '@/lib/image-picker-safe'
import {
  getFulfillmentStagePreflightError,
  normalizeContactPhoneInput,
  normalizeDispatchReferenceInput,
  normalizeTrackingNumberInput,
  openTrackingPage,
} from '@/lib/shipping'
import { stripExif } from '@/lib/stripExif'
import {
  CANCELLATION_REVIEW_REASON_LABELS,
  CONSULTATION_EXPIRY_POLICY_LABELS,
  CONSULTATION_NO_SHOW_POLICY_LABELS,
  CONSULTATION_PAYMENT_TIMING_LABELS,
  CONSULTATION_RESCHEDULE_POLICY_LABELS,
  COVERAGE_PREFERENCE_LABELS,
  DELIVERY_REVIEW_REASON_LABELS,
  DISPATCH_SERVICE_LEVEL_LABELS,
  enrichMeasurementSnapshot,
  FABRIC_HANDOFF_LABELS,
  FABRIC_STRETCH_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_INTENT_LABELS,
  getAdditionalMeasurementRows,
  getMeasurementConfirmationFields,
  labelMeasurementField,
  MATERIAL_ISSUE_REASON_LABELS,
  MATERIAL_ISSUE_RESPONSE_LABELS,
  measurementAgeLabel,
  MEASUREMENT_SOURCE_LABELS,
  WEAR_DAY_SUPPORT_LABELS,
  labelFitContextFlag,
  fitProfileNeedsTailorReview,
  hasOpenCancellationReview,
  hasOpenDeliveryReview,
  hasOpenMaterialIssue,
  hasOpenScopeChange,
  parseOrderSupportMeta,
  withConsultationBookingFallback,
  resolveMeasurementAgeMeta,
  SCOPE_CHANGE_IMPACT_LABELS,
  SCOPE_CHANGE_TYPE_LABELS,
  STALE_MEASUREMENT_MONTHS,
  type CancellationReviewReason,
  type DeliveryReviewReason,
  type MaterialIssueReason,
  type MeasurementSnapshotMeta,
  type OrderSupportMeta,
  type ScopeChangeImpact,
  type ScopeChangeType,
} from '@/lib/order-support'
import {
  isReadyMadePreparationStage,
  tailorOrderStageLabel,
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
  PhoneNumberInput,
  RemoteImage,
  type DrapeMediaMosaicItem,
  type MediaLightboxItem,
} from '@/components/ui'
import { BottomSheetScaffold } from '@/components/ui/BottomSheetScaffold'
import { useDrapeCapsuleNavScroll } from '@/components/ui/DrapeCapsuleNav'
import {
  buildBriefDossier,
  sanitizeReferencePhotoAttributions,
  currencySymbol,
  formatConsultationStatusLabel,
  formatMaterialAdvanceStatusLabel,
  formatMeasurementStatusLabel,
  formatScopeChangeStatusLabel,
  isFabricApprovalEvidence,
  latestFabricApprovalEvidence,
  materialAdvanceDeclineReasonLabel,
  orderHistorySummary,
  sourcedFabricChangeFeedbackFromUpdates,
  sourcedFabricDecisionFromNote,
  styleAlignmentChangeFeedbackFromUpdates,
  styleAlignmentDecisionFromNote,
  styleAlignmentEventFromNote,
  taxSnapshotNeedsRefresh,
} from '@drape/shared'
import { filterContactInfo, rejectPlaceholder } from '@drape/shared/contact-filter'
import { decodeDisplayText } from '@drape/shared/display-text'
import { Colors, Fonts, FontSize, FontWeight, Spacing, Radius, Shadow } from '@/constants/theme'
import { styles } from '@/features/orders/tailor/TailorOrderStyles'
import { asStringList, normalizeExternalHref, labelShippingPreference, labelFabricApprovalStatus, linkHostLabel, orderStatusGuidance, quotedAmountLabel, formatTimelineDate, displayText, displayNullableText, hasSuccessfulPaymentEvent, isResolvedCheckoutAttempt, timelineStageLabel, timelineDotColor, timelineNoteText, baseAmount, PRODUCTION_NEXT, FLEXIBLE_NEXT_STAGES, PRE_CUTTING_STAGES, SCOPE_CHANGE_STAGES, GARMENT_CONTEXT_LABELS, BODY_SHAPE_LABELS, type StageSubmissionPurpose } from '@/features/orders/tailor/TailorOrderPresentation'
import type { Measurement, MaterialAdvance, MaterialAdvanceStatus, OrderDetail } from '@/features/orders/tailor/TailorOrderTypes'
import { ScopeChangeRequestModal } from '@/features/orders/tailor/ScopeChangeRequestModal'
import { SelectableSettingRow } from '@/features/orders/tailor/SelectableSettingRow'
import { QuoteModal } from '@/features/orders/tailor/TailorQuoteModal'
import { StageUpdateModal } from '@/features/orders/tailor/StageUpdateModal'
import { ConsultationModal } from '@/features/orders/tailor/TailorConsultationModal'
import { CollectionCodeModal } from '@/features/orders/tailor/CollectionCodeModal'
import { BriefDossierCard, BriefRow, SupportDisclosure, dossierMediaItems } from '@/features/orders/tailor/TailorBriefDossierCard'
import { displayStageChoiceLabel, stageChoiceDetail, refundCoverageLabel, stageUpdateNotePlaceholder, stageUpdatePhotoHint, stageUpdatePhotoLabel, stageUpdatePhotoRequiredMessage } from '@/features/orders/tailor/TailorStageCopy'
import { defaultConsultationStart, formatConsultationStart, parseListInput } from '@/features/orders/tailor/TailorOrderFormatting'
import { MeasurementConfirmationRequestModal, FitReadinessModal, StyleAlignmentRequestModal, MaterialIssueModal, MaterialAdvanceRequestModal, MaterialAdvanceReceiptModal, CancellationReviewRequestModal, DeliveryReviewRequestModal } from '@/features/orders/tailor/TailorOrderRequestDialogs'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import { QUOTE_REVISION_REASON_LABELS, type QuoteRevisionReason } from '@drape/shared/order-negotiation'
import type { BriefDossierRow, BriefDossierSection } from '@drape/shared/order-brief-dossier'
import {
  CANCELLATION_REFUND_COMPONENT_LABELS,
  deriveCancellationPolicy,
} from '@drape/shared/cancellation-policy'
import { formatAmount, STATIC_FALLBACK_RATES, type CurrencyCode } from '@/lib/currency'
import { stageColor } from '@/lib/stageColors'
import { isTerminalOrderStage, purgeTerminalOrderClientState } from '@/lib/order-client-state'
import { hapticSuccess } from '@/lib/haptics'
import { MOBILE_FEATURE_FLAGS } from '@/lib/feature-flags'
import {
  isOrderEvidenceVideoUri as isVideoUri,
  StageMediaPreview,
  stageMediaContentType,
  stageMediaExtension,
  stageMediaFromAsset,
  type StageMedia,
  type StageMediaType,
  validateStageMedia,
} from '@/features/orders/tailor/OrderStageMedia'
import {
  ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES,
  MEDIA_LIMITS_BYTES,
  MEDIA_LIMITS_SECONDS,
} from '@drape/shared/media-policy'

const ORDER_EVIDENCE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.orderUpdateVideo
const ORDER_EVIDENCE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.orderUpdateVideo

const QUOTE_NEGOTIATION_UI_ENABLED = MOBILE_FEATURE_FLAGS.quoteNegotiationV1

// ─── Types ────────────────────────────────────────────────────────────────────

type StageUpdate = {
  id: string
  stage: string
  note: string | null
  photoUrl: string | null
  createdAt: string
}

type CustomerReviewSummary = {
  count: number
  averageRating: number | null
  tags: string[]
}


type FabricFundingBalance = {
  currency: CurrencyCode
  fundedAmount: number
  releasedAmount: number
  refundedAmount: number
}

const ORDER_DETAIL_POLL_INTERVAL_MS = 60_000


function firstJoinedRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

async function resolvedStageUpdateMedia(row: { photo_url: string | null; evidence_media?: unknown }) {
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


type OpenTailorQuoteRevision = {
  id: string
  roundNumber: number
  note: string
  reasonCodes: string[]
  targetAmount: number | null
}


// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TailorOrderDetailScreen() {
  const { id, returnTo, historyChain, action, advanceId } = useLocalSearchParams<{
    id: string
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
  const userId = user?.id ?? null

  function openOrderMessages() {
    if (!order) return
    router.navigate({
      pathname: '/(tailor)/messages/[orderId]',
      params: {
        orderId: order.id,
        returnTo: `/(tailor)/orders/${order.id}`,
        historyChain: appendToHistory(historyChain, `/(tailor)/orders/${order.id}`),
      },
    })
  }

  function goBack() {
    goBackOrReturnTo(
      router,
      navigation,
      pickSafeReturnTo(historyChain, returnTo),
      '/(tailor)/orders',
    )
  }

  useContextualBackHandler(goBack)

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [studioVersion, setStudioVersion] = useState<{ version: number; design: unknown; sheet_photo_url: string } | null>(null)
  const [consultationClockMs, setConsultationClockMs] = useState(() => Date.now())
  const loadedOrderIdRef = useRef<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchErrorMessage, setFetchErrorMessage] = useState('')
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const [quoteModalMode, setQuoteModalMode] = useState<'send' | 'revise'>('send')
  const [openQuoteRevision, setOpenQuoteRevision] = useState<OpenTailorQuoteRevision | null>(null)
  const [showRevisionResponseSheet, setShowRevisionResponseSheet] = useState(false)
  const [revisionResponseSaving, setRevisionResponseSaving] = useState(false)
  const initialActionHandledRef = useRef(false)
  const orderScrollRef = useRef<ScrollView>(null)
  const fabricWorkflowYRef = useRef(0)
  const [showStageModal, setShowStageModal] = useState(false)
  const [stageModalTarget, setStageModalTarget] = useState<OrderStage | null>(null)
  const [stageModalPurpose, setStageModalPurpose] = useState<StageSubmissionPurpose>('STAGE_PROGRESS')
  const [showConsultationModal, setShowConsultationModal] = useState(false)
  const [consultationRescheduleRequired, setConsultationRescheduleRequired] = useState(false)
  const [consultationModalAction, setConsultationModalAction] = useState<'request-consultation' | 'approve-consultation'>('request-consultation')
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [dispatchFulfillmentState, setDispatchFulfillmentState] = useState<DispatchFulfillmentPresentation | null>(null)
  const [showMeasurementRequestModal, setShowMeasurementRequestModal] = useState(false)
  const [showFitReadinessModal, setShowFitReadinessModal] = useState(false)
  const [showStyleAlignmentModal, setShowStyleAlignmentModal] = useState(false)
  const [showMaterialIssueModal, setShowMaterialIssueModal] = useState(false)
  const [showMaterialAdvanceModal, setShowMaterialAdvanceModal] = useState(false)
  const [reconcilingMaterialAdvance, setReconcilingMaterialAdvance] = useState<MaterialAdvance | null>(null)
  const [showCancellationReviewModal, setShowCancellationReviewModal] = useState(false)
  const [showDeliveryReviewModal, setShowDeliveryReviewModal] = useState(false)
  const [showScopeChangeModal, setShowScopeChangeModal] = useState(false)
  const [showHandoffSupport, setShowHandoffSupport] = useState(false)
  const [showDossierSheet, setShowDossierSheet] = useState(false)
  const [showMeasurementSheet, setShowMeasurementSheet] = useState(false)
  const [showFlexibleStageSheet, setShowFlexibleStageSheet] = useState(false)
  const [showFabricChangeFeedback, setShowFabricChangeFeedback] = useState(false)
  const [showStyleChangeFeedback, setShowStyleChangeFeedback] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null)
  const [startingCall, setStartingCall] = useState<'audio' | 'video' | null>(null)
  const [confirmingFabricReceived, setConfirmingFabricReceived] = useState(false)
  const [failedReferencePhotos, setFailedReferencePhotos] = useState<string[]>([])
  const [hasCustomerReview, setHasCustomerReview] = useState(false)
  const [customerReviewSummary, setCustomerReviewSummary] = useState<CustomerReviewSummary | null>(null)
  const [handoffIssue, setHandoffIssue] = useState<HandoffIssue | null>(null)
  const [materialAdvances, setMaterialAdvances] = useState<MaterialAdvance[]>([])
  const [fabricFundingBalance, setFabricFundingBalance] = useState<FabricFundingBalance | null>(null)
  const [productionEvidenceMedia, setProductionEvidenceMedia] = useState<string[]>([])
  const [fabricEvidenceMedia, setFabricEvidenceMedia] = useState<string[]>([])
  const [fabricApprovalHistoryMedia, setFabricApprovalHistoryMedia] = useState<string[]>([])
  const [resolvingHandoffIssue, setResolvingHandoffIssue] = useState(false)
  const purgedTerminalOrderRef = useRef<string | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setConsultationClockMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

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

  const openMaterialEvidence = useCallback(async (advance: MaterialAdvance, kind: 'receipt' | 'acquired') => {
    const bucket = kind === 'receipt' ? advance.receiptStorageBucket : advance.acquiredStorageBucket
    const path = kind === 'receipt' ? advance.receiptStoragePath : advance.acquiredStoragePath
    if (!bucket || !path) return
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300)
    if (error || !data?.signedUrl) {
      Alert.alert('Could not open proof', 'The private proof could not be opened. Please try again.')
      return
    }
    openMediaPreview([{ uri: data.signedUrl, label: kind === 'receipt' ? 'Final supplier receipt' : 'Acquired fabric', kind: 'photo' }], 0)
  }, [openMediaPreview])

  const hasActiveMaterialAdvance = materialAdvances.some((advance) =>
    ['REQUESTED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'OPS_REVIEW', 'BLOCKED'].includes(advance.status)
      || (advance.status === 'RELEASED' && !advance.reconciledAt)
      || advance.reconciliationStatus === 'OPS_REVIEW'
  )

  const fetchOrder = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true
    if (!id || !userId) {
      if (!silent) {
        setLoading(false)
        setFetchErrorMessage('')
        setOrder(null)
        setHasCustomerReview(false)
        setCustomerReviewSummary(null)
        setFailedReferencePhotos([])
        setHandoffIssue(null)
        setMaterialAdvances([])
      }
      return
    }
    const shouldReplaceSurface = !silent && loadedOrderIdRef.current !== id
    if (shouldReplaceSurface) {
      setLoading(true)
      setOrder(null)
      setStudioVersion(null)
      setHasCustomerReview(false)
      setCustomerReviewSummary(null)
      setFailedReferencePhotos([])
      setMaterialAdvances([])
      setProductionEvidenceMedia([])
      setFabricEvidenceMedia([])
      setFabricApprovalHistoryMedia([])
    }
    setFetchErrorMessage('')
    try {
      const { data, error } = await supabase
      .from('orders')
      .select(`
        id, reference, order_kind, fulfillment_option, garment_type, garment_description, item_title, item_size, item_quantity, item_subtotal, stage,
        customer_id, tailor_profile_id, quoted_amount, currency, quoted_currency, fulfillment_fee, quoted_completion_date,
        active_quote_id, active_quote_version, negotiation_round_limit, negotiation_rounds_used,
        source_amount, subtotal_amount, tax_amount, tax_rate_bps, tax_region, tax_fallback, shipping_amount, total_amount,
        fulfillment_payment_requested_at, fulfillment_payment_paid_at, fulfillment_payment_provider, fulfillment_payment_intent_id, fulfillment_payment_checkout_url,
        fabric_source, fabric_funding_policy_version, delivery_method, delivery_address, recipient_name, recipient_phone, tracking_number, carrier,
        fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, reference_photos, reference_photo_attributions, fit_note,
        customer_measurements_snapshot, special_note, collection_code, video_call_url,
        occasion, deadline, created_at,
        customer_profiles!customer_id(display_name),
        custom_order_details(garment_type_other, gender_presentation, social_reference_links, style_notes, body_note, fabric_description, fabric_budget_amount, fabric_budget_currency, fabric_sourcing_deadline_days, fabric_sourcing_deadline_at, fabric_approval_status, shipping_preference, delivery_instructions, target_delivery_date),
        order_stage_updates(id, stage, note, photo_url, evidence_media, created_at)
      `)
      .eq('id', id)
      .eq('tailor_id', userId)
      .order('created_at', { ascending: true, referencedTable: 'order_stage_updates' })
      .maybeSingle()

      if (error) throw error

      if (data) {
        const d = data as TailorOrderDetailQueryRow
        const { data: studioRows } = await supabase
          .from('order_studio_design_versions')
          .select('version, design, sheet_photo_url')
          .eq('order_id', d.id)
          .order('version', { ascending: false })
          .limit(1)
        setStudioVersion(studioRows?.[0] ?? null)
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
        const customerProfile = firstJoinedRow(d.customer_profiles)
        const measurementSnapshot =
          d.customer_measurements_snapshot &&
          typeof d.customer_measurements_snapshot === 'object' &&
          !Array.isArray(d.customer_measurements_snapshot)
            ? (d.customer_measurements_snapshot as Record<string, unknown>)
            : null
        const openHandoffIssue = await fetchOpenHandoffIssue(d.id)
        const { data: materialAdvanceRows } = await supabase
          .from('order_material_advances')
          .select('id, title, description, amount, currency, status, release_status, receipt_url, receipt_storage_bucket, receipt_storage_path, acquired_storage_bucket, acquired_storage_path, receipt_note, actual_spent_amount, reconciliation_status, reconciliation_outcome, reconciliation_resolution, customer_refund_amount, unapproved_overage_amount, reconciled_at, customer_response_reason, customer_response_note, customer_approved_at, customer_declined_at, created_at, funding_source, provider_release_status')
          .eq('order_id', d.id)
          .order('created_at', { ascending: false })
        const { data: fabricAllocationRow } = await supabase
          .from('order_fabric_funding_allocations')
          .select('currency,funded_amount,released_amount,refunded_amount')
          .eq('order_id', d.id)
          .maybeSingle()
        setFabricFundingBalance(fabricAllocationRow ? {
          currency: fabricAllocationRow.currency as CurrencyCode,
          fundedAmount: fabricAllocationRow.funded_amount ?? 0,
          releasedAmount: fabricAllocationRow.released_amount ?? 0,
          refundedAmount: fabricAllocationRow.refunded_amount ?? 0,
        } : null)
        const { data: productionEvidenceRows, error: productionEvidenceError } = await supabase
          .from('order_production_evidence')
          .select('stage_key, photo_urls, metadata, created_at')
          .eq('order_id', d.id)
          .order('created_at', { ascending: true })
        if (productionEvidenceError) {
          Sentry.captureException(productionEvidenceError, { extra: { context: 'tailor_order_production_evidence', orderId: d.id } })
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
        const customDetail = firstJoinedRow(d.custom_order_details)
        const { data: openRevisionRow } = QUOTE_NEGOTIATION_UI_ENABLED && d.active_quote_id
          ? await supabase
              .from('quote_revision_requests')
              .select('id, round_number, note, reason_codes, target_amount')
              .eq('order_id', d.id)
              .eq('source_quote_id', d.active_quote_id)
              .eq('status', 'OPEN')
              .maybeSingle()
          : { data: null }
        setOpenQuoteRevision(openRevisionRow ? {
          id: openRevisionRow.id as string,
          roundNumber: Number(openRevisionRow.round_number) || 1,
          note: typeof openRevisionRow.note === 'string' ? openRevisionRow.note : '',
          reasonCodes: Array.isArray(openRevisionRow.reason_codes)
            ? openRevisionRow.reason_codes.filter((item): item is string => typeof item === 'string')
            : [],
          targetAmount: typeof openRevisionRow.target_amount === 'number' ? openRevisionRow.target_amount : null,
        } : null)
        setMaterialAdvances(
          ((materialAdvanceRows ?? []) as Array<{
            id: string
            title: string | null
            description: string | null
            amount: number | null
            currency: string | null
            status: string | null
            release_status: string | null
            receipt_url: string | null
            receipt_storage_bucket: string | null
            receipt_storage_path: string | null
            acquired_storage_bucket: string | null
            acquired_storage_path: string | null
            receipt_note: string | null
            actual_spent_amount: number | null
            reconciliation_status: string | null
            reconciliation_outcome: string | null
            reconciliation_resolution: string | null
            customer_refund_amount: number | null
            unapproved_overage_amount: number | null
            reconciled_at: string | null
            customer_response_reason: string | null
            customer_response_note: string | null
            customer_approved_at: string | null
            customer_declined_at: string | null
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
            receiptUrl: advance.receipt_url ?? null,
            receiptStorageBucket: advance.receipt_storage_bucket ?? null,
            receiptStoragePath: advance.receipt_storage_path ?? null,
            acquiredStorageBucket: advance.acquired_storage_bucket ?? null,
            acquiredStoragePath: advance.acquired_storage_path ?? null,
            receiptNote: displayNullableText(advance.receipt_note),
            actualSpent: advance.actual_spent_amount ?? null,
            reconciliationStatus: advance.reconciliation_status ?? null,
            reconciliationOutcome: advance.reconciliation_outcome ?? null,
            reconciliationResolution: advance.reconciliation_resolution ?? null,
            customerRefundAmount: advance.customer_refund_amount ?? 0,
            unapprovedOverageAmount: advance.unapproved_overage_amount ?? 0,
            reconciledAt: advance.reconciled_at ?? null,
            customerResponseReason: advance.customer_response_reason ?? null,
            customerResponseNote: displayNullableText(advance.customer_response_note),
            customerApprovedAt: advance.customer_approved_at ?? null,
            customerDeclinedAt: advance.customer_declined_at ?? null,
            createdAt: advance.created_at ?? new Date().toISOString(),
            fundingSource: advance.funding_source === 'FUNDED_FABRIC_ALLOWANCE' ? 'FUNDED_FABRIC_ALLOWANCE' : 'LEGACY_SEPARATE_PAYMENT',
            providerReleaseStatus: advance.provider_release_status ?? null,
          }))
        )
        const resolvedStageUpdates = await Promise.all((d.order_stage_updates ?? []).map(async (update) => ({
          id: update.id,
          stage: update.stage,
          note: displayNullableText(update.note),
          photoUrl: await resolvedStageUpdateMedia(update),
          createdAt: update.created_at,
        })))
        setOrder({
          id: d.id, reference: d.reference, garmentType: displayText(d.garment_type, 'Order'),
          orderKind: d.order_kind ?? 'CUSTOM', fulfillmentOption: d.fulfillment_option ?? null,
          itemTitle: displayNullableText(d.item_title), itemSize: displayNullableText(d.item_size), itemQuantity: d.item_quantity ?? 1, itemSubtotal: d.item_subtotal ?? null, fulfillmentFee: d.fulfillment_fee ?? 0,
          garmentDescription: displayNullableText(d.garment_description), stage: d.stage,
          customerId: d.customer_id, tailorProfileId: d.tailor_profile_id ?? null,
          customerName: displayText(customerProfile?.display_name, 'Customer'),
          quotedAmount: d.quoted_amount, quotedCurrency: d.currency ?? d.quoted_currency ?? 'USD', quotedCompletionDate: d.quoted_completion_date,
          activeQuoteId: d.active_quote_id ?? null,
          activeQuoteVersion: d.active_quote_version ?? null,
          negotiationRoundLimit: d.negotiation_round_limit ?? 3,
          negotiationRoundsUsed: d.negotiation_rounds_used ?? 0,
          sourceAmount: d.source_amount ?? null,
          subtotalAmount: d.subtotal_amount ?? d.item_subtotal ?? 0,
          taxAmount: d.tax_amount ?? 0,
          taxRateBps: d.tax_rate_bps ?? 0,
          taxRegion: d.tax_region ?? null,
          taxFallback: d.tax_fallback ?? false,
          shippingAmount: d.shipping_amount ?? d.fulfillment_fee ?? 0,
          totalAmount: d.total_amount ?? d.quoted_amount ?? 0,
          fulfillmentPaymentRequestedAt: d.fulfillment_payment_requested_at ?? null,
          fulfillmentPaymentPaidAt: d.fulfillment_payment_paid_at ?? null,
          fulfillmentPaymentProvider: d.fulfillment_payment_provider ?? null,
          fulfillmentPaymentIntentId: d.fulfillment_payment_intent_id ?? null,
          fulfillmentPaymentCheckoutUrl: d.fulfillment_payment_checkout_url ?? null,
          fabricSource: d.fabric_source ?? '', fabricFundingPolicyVersion: d.fabric_funding_policy_version ?? null, deliveryMethod: d.delivery_method ?? '', deliveryAddress: displayNullableText(d.delivery_address),
          recipientName: displayNullableText(d.recipient_name), recipientPhone: d.recipient_phone ?? null,
          trackingNumber: d.tracking_number ?? null, carrier: d.carrier ?? null,
          fulfillmentProvider: displayNullableText(d.fulfillment_provider),
          fulfillmentReference: displayNullableText(d.fulfillment_reference),
          fulfillmentContactName: displayNullableText(d.fulfillment_contact_name),
          fulfillmentContactPhone: d.fulfillment_contact_phone ?? null,
          referencePhotos: asStringList(d.reference_photos),
          referencePhotoAttributions: sanitizeReferencePhotoAttributions(d.reference_photo_attributions, asStringList(d.reference_photos)),
          fitNote: d.fit_note, measurements: enrichMeasurementSnapshot(measurementSnapshot) as Measurement | null,
          supportMeta,
          customDetail: customDetail
            ? {
                garmentTypeOther: displayNullableText(customDetail.garment_type_other),
                genderPresentation: displayNullableText(customDetail.gender_presentation),
                socialReferenceLinks: asStringList(customDetail.social_reference_links),
                styleNotes: displayNullableText(customDetail.style_notes),
                bodyNote: displayNullableText(customDetail.body_note),
                fabricDescription: displayNullableText(customDetail.fabric_description),
                fabricBudgetAmount: customDetail.fabric_budget_amount ?? null,
                fabricBudgetCurrency: customDetail.fabric_budget_currency ?? null,
                fabricSourcingDeadlineDays: customDetail.fabric_sourcing_deadline_days ?? null,
                fabricSourcingDeadlineAt: customDetail.fabric_sourcing_deadline_at ?? null,
                fabricApprovalStatus: customDetail.fabric_approval_status ?? null,
                shippingPreference: displayNullableText(customDetail.shipping_preference),
                deliveryInstructions: displayNullableText(customDetail.delivery_instructions),
                targetDeliveryDate: customDetail.target_delivery_date ?? null,
              }
            : null,
          collectionCode: d.collection_code, videoCallUrl: d.video_call_url ?? null,
          occasion: displayNullableText(d.occasion), deadline: d.deadline, createdAt: d.created_at,
          stageUpdates: resolvedStageUpdates,
        })
        loadedOrderIdRef.current = d.id
        setHandoffIssue(openHandoffIssue)

        const { count: customerReviewCount } = await supabase
          .from('customer_reviews')
          .select('id', { count: 'exact', head: true })
          .eq('order_id', d.id)

        setHasCustomerReview((customerReviewCount ?? 0) > 0)

        const { data: priorCustomerReviews } = await supabase
          .from('customer_reviews')
          .select('rating, tags')
          .eq('customer_id', d.customer_id)
          .neq('order_id', d.id)
          .order('created_at', { ascending: false })
          .limit(5)

        const reviewRows = Array.isArray(priorCustomerReviews) ? priorCustomerReviews : []
        const numericRatings = reviewRows
          .map((review) => (typeof review.rating === 'number' ? review.rating : null))
          .filter((rating): rating is number => rating !== null)
        const tags = Array.from(
          new Set(
            reviewRows
              .flatMap((review) => (Array.isArray(review.tags) ? review.tags : []))
              .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
              .map((tag) => tag.trim())
          )
        ).slice(0, 3)
        setCustomerReviewSummary({
          count: reviewRows.length,
          averageRating: numericRatings.length
            ? numericRatings.reduce((sum, rating) => sum + rating, 0) / numericRatings.length
            : null,
          tags,
        })
      } else {
        if (shouldReplaceSurface) {
          setHandoffIssue(null)
          setOrder(null)
          setHasCustomerReview(false)
          setCustomerReviewSummary(null)
          setMaterialAdvances([])
        }
      }
    } catch (error) {
      if (silent) {
        Sentry.captureException(error, { extra: { context: 'tailor_order_realtime_refresh', orderId: id } })
        return
      }
      if (!shouldReplaceSurface && loadedOrderIdRef.current === id) {
        Sentry.captureException(error, {
          extra: { context: 'tailor_order_background_refresh', orderId: id },
        })
        return
      }
      setFetchErrorMessage(
        isLikelyConnectivityIssue(error)
          ? 'Connection is weak. We could not load this order yet. Retry when the signal improves, or reopen it from Orders later.'
          : 'We could not load this order right now. Retry, or reopen it from your Orders list.'
      )
      setHandoffIssue(null)
      setOrder(null)
      setHasCustomerReview(false)
      setCustomerReviewSummary(null)
      setMaterialAdvances([])
    }
    if (shouldReplaceSurface) setLoading(false)
  }, [id, setOrder, userId])

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchOrder()
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchOrder])

  useFocusEffect(
    useCallback(() => {
      void fetchOrder()
    }, [fetchOrder]),
  )

  useFocusEffect(useCallback(() => {
    if (!id || !userId) return
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
      .channel(`tailor-order-detail:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, scheduleSilentRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'custom_order_details', filter: `order_id=eq.${id}` }, scheduleSilentRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_stage_updates', filter: `order_id=eq.${id}` }, scheduleSilentRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_stage_updates', filter: `order_id=eq.${id}` }, scheduleSilentRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_quotes', filter: `order_id=eq.${id}` }, scheduleSilentRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_revision_requests', filter: `order_id=eq.${id}` }, scheduleSilentRefresh)
      .subscribe()

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      stopPolling()
      appStateSubscription.remove()
      void supabase.removeChannel(channel)
    }
  }, [fetchOrder, id, userId]))

  useEffect(() => {
    if (!order || !isTerminalOrderStage(order.stage)) return
    const purgeKey = `${order.id}:${order.stage}`
    if (purgedTerminalOrderRef.current === purgeKey) return
    purgedTerminalOrderRef.current = purgeKey
    void purgeTerminalOrderClientState({
      orderId: order.id,
      customerId: order.customerId,
    })
  }, [order])

  useEffect(() => {
    if (initialActionHandledRef.current || !order || !action) return
    if (action === 'SEND_QUOTE') {
      initialActionHandledRef.current = true
      setQuoteModalMode('send')
      setShowQuoteModal(true)
      return
    }
    if (action === 'REVISE_QUOTE' && openQuoteRevision && order.activeQuoteId && order.activeQuoteVersion) {
      initialActionHandledRef.current = true
      setQuoteModalMode('revise')
      setShowQuoteModal(true)
      return
    }
    if (
      (action === 'KEEP_CURRENT_QUOTE' || action === 'DECLINE_AFTER_REVISION') &&
      openQuoteRevision &&
      order.activeQuoteId &&
      order.activeQuoteVersion
    ) {
      initialActionHandledRef.current = true
      setShowRevisionResponseSheet(true)
    }
  }, [action, openQuoteRevision, order])

  const pickupCredentialActive = dispatchFulfillmentState?.pickupCredentialActive
    ?? (order?.stage === 'READY_FOR_COLLECTION' && order.deliveryMethod === 'LOCAL_COLLECTION')

  useEffect(() => {
    if (!pickupCredentialActive && showCodeModal) setShowCodeModal(false)
  }, [pickupCredentialActive, showCodeModal])

  async function respondToQuoteRevision(response: 'keep-current-quote' | 'decline-after-revision') {
    if (
      !order?.activeQuoteId ||
      !order.activeQuoteVersion ||
      !openQuoteRevision ||
      revisionResponseSaving
    ) return
    setRevisionResponseSaving(true)
    const { error } = await invokeFunction('tailor-order-action', {
      body: {
        orderId: order.id,
        action: response,
        quoteId: order.activeQuoteId,
        expectedQuoteVersion: order.activeQuoteVersion,
        revisionRequestId: openQuoteRevision.id,
      },
    })
    setRevisionResponseSaving(false)
    if (error) {
      Alert.alert(
        'Response not saved',
        await readFunctionErrorMessage(error, 'Refresh the order and try this response again.'),
      )
      return
    }
    setShowRevisionResponseSheet(false)
    await fetchOrder()
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.stateWrap}>
          <View style={styles.stateCard}>
            <Text style={styles.stateEyebrow}>Order detail</Text>
            <ActivityIndicator color={Colors.needleGreenDark} size="large" />
            <Text style={styles.stateTitle}>Loading this order...</Text>
            <Text style={styles.stateHint}>
              We’re pulling together the brief, measurements, quote context, and current production state.
            </Text>
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
              style={styles.retryBtn}
              onPress={() => { setLoading(true); fetchOrder() }}
            >
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(tailor)/orders')}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/(tailor)/clients')}>
              <Text style={styles.backLink}>Open clients</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.backLink}>← Back</Text>
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
            <Text style={styles.stateHint}>Open Orders and try again.</Text>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(tailor)/orders')}
            >
              <Text style={styles.secondaryBtnText}>Open orders</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack}>
              <Text style={styles.backLink}>← Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  const isBeforeConfirmation = [
    'PENDING_QUOTE',
    'CONSULTATION',
    'QUOTE_SENT',
    'PAYMENT_PENDING',
    'PAYMENT_FAILED',
  ].includes(order.stage)
  const nextProductionStage =
    order.orderKind === 'READY_MADE'
      ? undefined
      : PRODUCTION_NEXT[order.stage]
  const focusedMaterialAdvance = advanceId
    ? materialAdvances.find((advance) => advance.id === advanceId) ?? null
    : null
  const focusedMaterialCopy = focusedMaterialAdvance
    ? materialReconciliationCopy({
        outcome: focusedMaterialAdvance.reconciliationOutcome,
        resolution: focusedMaterialAdvance.reconciliationResolution,
        customerRefundAmount: focusedMaterialAdvance.customerRefundAmount,
        unapprovedOverageAmount: focusedMaterialAdvance.unapprovedOverageAmount,
        actorRole: 'TAILOR',
      })
    : null
  const flexibleNextStages =
    order.orderKind === 'READY_MADE'
      ? (order.stage === 'CONFIRMED' ? ['FINISHING'] as OrderStage[] : undefined)
      : FLEXIBLE_NEXT_STAGES[order.stage]
  const isFlexibleStage = !!flexibleNextStages
  const visibleReferencePhotos = order.referencePhotos.filter((url) => !failedReferencePhotos.includes(url))
  const styleReferenceLinks =
    order.customDetail?.socialReferenceLinks.length
      ? order.customDetail.socialReferenceLinks
      : asStringList(order.supportMeta.styleReferenceLinks)
  const styleAttributes = asStringList(order.supportMeta.styleAttributes)
  const styleNotes = order.customDetail?.styleNotes?.trim() || order.supportMeta.styleNotes?.trim() || null
  const bodyNote = order.customDetail?.bodyNote?.trim() || order.supportMeta.bodyNote?.trim() || order.fitNote?.trim() || null
  const garmentOther = order.customDetail?.garmentTypeOther?.trim() || order.supportMeta.customOrder?.garmentTypeOther?.trim() || null
  const genderPresentation = order.customDetail?.genderPresentation?.trim() || order.supportMeta.customOrder?.genderPresentation?.trim() || null
  const targetDeliveryDate = order.customDetail?.targetDeliveryDate ?? order.supportMeta.customOrder?.targetDeliveryDate ?? order.deadline
  const fabricDescription =
    order.customDetail?.fabricDescription?.trim()
    || order.supportMeta.fabricSourcing?.description?.trim()
    || null
  const fabricBudgetAmount =
    typeof order.customDetail?.fabricBudgetAmount === 'number'
      ? order.customDetail.fabricBudgetAmount
      : typeof order.supportMeta.fabricSourcing?.budgetAmount === 'number'
        ? order.supportMeta.fabricSourcing.budgetAmount
        : null
  const fabricBudgetCurrency =
    order.customDetail?.fabricBudgetCurrency
    || order.supportMeta.fabricSourcing?.budgetCurrency
    || order.quotedCurrency
  const fabricSourcingDeadlineDays =
    order.customDetail?.fabricSourcingDeadlineDays
    ?? order.supportMeta.fabricSourcing?.deadlineBusinessDays
    ?? null
  const fabricApprovalStatus = labelFabricApprovalStatus(order.customDetail?.fabricApprovalStatus)
  const fabricChangeFeedback = sourcedFabricChangeFeedbackFromUpdates(order.stageUpdates)
  const shippingPreference = labelShippingPreference(order.customDetail?.shippingPreference ?? order.supportMeta.customOrder?.shippingPreference)
  const deliveryInstructions = order.customDetail?.deliveryInstructions?.trim() || order.supportMeta.deliveryInstructions?.trim() || null
  const fulfillmentStagePresentation = deriveFulfillmentAwareOrderStagePresentation({
    orderStage: order.stage,
    effectiveMethod: dispatchFulfillmentState?.effectiveMethod ?? order.deliveryMethod,
  })
  const displayedOrderStage = (fulfillmentStagePresentation.stage ?? order.stage) as OrderStage
  const displayedOrderStageLabel = fulfillmentStagePresentation.label
    ?? tailorOrderStageLabel(order.stage, order.orderKind)
  const statusGuidance = fulfillmentStagePresentation.label
    ? dispatchFulfillmentState?.effectiveMethod === 'SHIPPING' || order.deliveryMethod === 'SHIPPING'
      ? 'Shipping is being arranged for this order. No collection code is needed.'
      : 'Drapeon Dispatch is arranging delivery for this order. No collection code is needed.'
    : orderStatusGuidance(order.stage, order.orderKind)
  const measurementSource = order.measurements?.measurementSource
  const fitConfidence = order.measurements?.fitConfidence
  const measurementConfirmationNeeded = order.measurements?.needsConfirmation === true
  const wearerLabel = wearerLabelFromOrder(order.supportMeta, order.measurements)
  const measurementAge = resolveMeasurementAgeMeta(order.supportMeta, order.measurements)
  const measurementAgeText = measurementAgeLabel(measurementAge)
  const measurementConfirmationFields = getMeasurementConfirmationFields(order.measurements)
  const styleAlignment = order.supportMeta.styleAlignment
  const styleChangeFeedback = styleAlignmentChangeFeedbackFromUpdates(order.stageUpdates)
  const referralTrust = order.supportMeta.referralTrust ?? null
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
  const consultationPaymentRequired =
    order.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    consultationMeta.paymentTiming === 'BEFORE_CALL_STARTS'
  const consultationPaymentPaid =
    order.stage === 'CONSULTATION' &&
    !!consultationMeta?.feeAmount &&
    !!consultationMeta.paidAt
  const customerRequestedConsultation =
    order.stage === 'CONSULTATION' &&
    consultationMeta?.requestedBy === 'CUSTOMER' &&
    consultationMeta.status === 'REQUESTED'
  const fitProfileReviewNeeded = fitProfileNeedsTailorReview(order.supportMeta)
  const fabricHandoffMode = order.supportMeta.fabricHandoffMode ?? null
  const fabricHandoffLabel =
    order.supportMeta.fabricHandoffLabel ??
    (fabricHandoffMode ? FABRIC_HANDOFF_LABELS[fabricHandoffMode] : null)
  const briefDossier = buildBriefDossier(
    {
      studioVersion,
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
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      fulfillmentProvider: order.fulfillmentProvider,
      fulfillmentReference: order.fulfillmentReference,
      fulfillmentContactName: order.fulfillmentContactName,
      fulfillmentContactPhone: order.fulfillmentContactPhone,
      collectionCode: order.collectionCode,
      referencePhotos: visibleReferencePhotos,
      referencePhotoAttributions: sanitizeReferencePhotoAttributions(order.referencePhotoAttributions, visibleReferencePhotos),
      proofMediaUrls: order.stageUpdates.map((update) => update.photoUrl).filter((url): url is string => !!url),
      supportMeta: order.supportMeta as unknown as Record<string, unknown>,
      customDetail: order.customDetail,
      measurementSnapshot: order.measurements as Record<string, unknown> | null,
      measurementSourceLabel: measurementSource ? MEASUREMENT_SOURCE_LABELS[measurementSource] ?? String(measurementSource) : null,
      fitConfidenceLabel: fitConfidence ? FIT_CONFIDENCE_LABELS[fitConfidence] ?? String(fitConfidence) : null,
      measurementAgeLabel: measurementAgeText,
      wearerLabel,
    },
    {
      money: (amount, currency) => amount == null ? 'Quote pending' : formatAmount(amount, (currency ?? order.quotedCurrency) as CurrencyCode, (currency ?? order.quotedCurrency) as CurrencyCode, STATIC_FALLBACK_RATES),
    },
  )
  const referenceMediaItems = dossierMediaItems('Reference photo', visibleReferencePhotos)
  const materialIssue = order.supportMeta.materialIssue ?? null
  const materialIssueOpen = hasOpenMaterialIssue(order.supportMeta)
  const materialIssueNeedsCustomerDecision = materialIssue?.status === 'OPEN'
  const materialIssueCancellationRequested = materialIssue?.status === 'CUSTOMER_REQUESTED_CANCEL'
  const handoffHelpAvailable = ['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH', 'OUT_FOR_DELIVERY', 'SHIPPED', 'DELIVERED', 'COLLECTED', 'IN_DISPUTE'].includes(order.stage)
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
    (cancellationReview?.reason ? CANCELLATION_REVIEW_REASON_LABELS[cancellationReview.reason] : null)
  const cancellationPolicy = deriveCancellationPolicy({
    orderKind: order.orderKind,
    stage: order.stage,
    deliveryMethod: order.deliveryMethod,
    consultationFee: consultationMeta?.feeAmount ?? null,
    consultationPaidAt: consultationMeta?.paidAt ?? null,
    consultationFeeCreditable: consultationMeta?.feeCreditable ?? null,
    fulfillmentFee: order.fulfillmentFee,
    fulfillmentPaymentRequestedAt: order.fulfillmentPaymentRequestedAt,
    fulfillmentPaymentPaidAt: order.fulfillmentPaymentPaidAt,
    dispatchBookedAt: dispatchRecord?.bookedAt ?? null,
    premiumDispatch: dispatchRecord?.premiumException ?? null,
  })
  const canRequestCancellationReview =
    !cancellationReviewOpen &&
    cancellationPolicy.tailorCanRequestReview
  const showCancellationPolicyCard =
    cancellationReviewOpen ||
    (order.orderKind === 'CUSTOM'
      ? ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'DESIGNING', 'SOURCING', 'CUTTING', 'SEWING', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH'].includes(order.stage)
      : ['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'FINISHING', 'READY_FOR_DRAPE_DISPATCH'].includes(order.stage))
  const deliveryReview = order.supportMeta.deliveryReview ?? null
  const deliveryReviewOpen = hasOpenDeliveryReview(order.supportMeta)
  const deliveryReasonLabel =
    deliveryReview?.reasonLabel ??
    (deliveryReview?.reason ? DELIVERY_REVIEW_REASON_LABELS[deliveryReview.reason] : null)
  const scopeChange = order.supportMeta.scopeChange ?? null
  const scopeChangeOpen = hasOpenScopeChange(order.supportMeta)
  const canRequestScopeChange =
    order.orderKind === 'CUSTOM' &&
    !isBeforeConfirmation &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen &&
    SCOPE_CHANGE_STAGES.includes(order.stage)
  const canRespondScopeChange = scopeChangeOpen && scopeChange?.requestedBy === 'CUSTOMER'
  const canCancelScopeChange = scopeChangeOpen && scopeChange?.requestedBy === 'TAILOR'
  const scopeChangeTypeLabel =
    scopeChange?.typeLabel ??
    (scopeChange?.type ? SCOPE_CHANGE_TYPE_LABELS[scopeChange.type] : null)
  const scopeChangeStatusLabel =
    scopeChange?.status ? formatScopeChangeStatusLabel(scopeChange.status) : null
  const initialPaymentLikelyPaid = ![
    'PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'DECLINED', 'EXPIRED',
  ].includes(order.stage)
  const canRequestDeliveryReview =
    initialPaymentLikelyPaid &&
    !deliveryReviewOpen &&
    order.stage !== 'IN_DISPUTE' &&
    order.stage !== 'COMPLETE'
  const waitingOnTailorSourcing = materialIssue?.status === 'CUSTOMER_RESPONDED' && materialIssue?.response === 'ASK_TAILOR_TO_SOURCE'
  const usesFabricFundingV2 = order.fabricFundingPolicyVersion?.trim() === FABRIC_FUNDING_POLICY_V2_VERSION
  const tailorSourcedFabricNeedsApproval =
    order.orderKind === 'CUSTOM' &&
    order.fabricSource === 'TAILOR_SOURCES' &&
    !usesFabricFundingV2 &&
    order.customDetail?.fabricApprovalStatus !== 'APPROVED'
  const fundedFabricAdvance = materialAdvances.find((advance) => advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE') ?? null
  const fundedFabricReadyForCutting = materialAdvances.some((advance) =>
    advance.fundingSource === 'FUNDED_FABRIC_ALLOWANCE' &&
    advance.releaseStatus === 'RELEASED' &&
    advance.providerReleaseStatus === 'SUCCEEDED' &&
    advance.acquiredStorageBucket === 'commercial-evidence' &&
    !!advance.acquiredStoragePath &&
    ['EXACT', 'RESOLVED'].includes(advance.reconciliationStatus ?? '')
  )
  const fundedFabricCuttingBlocked =
    order.orderKind === 'CUSTOM' &&
    order.fabricSource === 'TAILOR_SOURCES' &&
    order.fabricFundingPolicyVersion === 'fabric-funding-2026-08-01-v1' &&
    !fundedFabricReadyForCutting
  const cuttingBlockerMessage = measurementConfirmationNeeded
    ? 'The customer still needs to confirm measurements before cutting can start.'
    : fitProfileReviewNeeded
      ? 'Review the fit notes or request measurement confirmation before cutting starts.'
      : materialIssueOpen
        ? 'There is an open material issue that needs a customer decision first.'
        : order.fabricSource === 'CUSTOMER_SUPPLIES' &&
            !order.supportMeta.fabricReceivedAt &&
            !waitingOnTailorSourcing
          ? 'Confirm that the customer fabric has been received before cutting starts.'
          : tailorSourcedFabricNeedsApproval
            ? 'Upload sourced fabric and wait for the customer to approve it before cutting starts.'
            : fundedFabricCuttingBlocked
              ? fundedFabricAdvance?.status === 'RELEASED'
                ? 'Add the final supplier receipt and acquired-fabric proof, then finish reconciliation before cutting starts.'
                : fundedFabricAdvance
                  ? 'The fabric release must be approved and completed before cutting starts.'
                  : 'Request the supported fabric cost from the protected allowance before cutting starts.'
            : styleAlignment?.requiredBeforeCutting === true &&
                styleAlignment.status !== 'NOT_REQUIRED' &&
                styleAlignment.status !== 'APPROVED'
              ? 'Get customer approval on your style interpretation before cutting starts.'
            : null
  const canConfirmFabricReceived =
    order.fabricSource === 'CUSTOMER_SUPPLIES' &&
    PRE_CUTTING_STAGES.includes(order.stage) &&
    (!order.supportMeta.fabricReceivedAt || materialIssue?.response === 'REPLACE_FABRIC')
  const cuttingBlockedLocally = !!cuttingBlockerMessage
  const showTailorFabricActionCard =
    !usesFabricFundingV2 &&
    canSubmitTailorFabricApproval({
      orderKind: order.orderKind,
      fabricSource: order.fabricSource,
      stage: order.stage,
    }) &&
    order.customDetail?.fabricApprovalStatus !== 'APPROVED'
  const showTailorFabricApprovedAcknowledgement =
    order.orderKind === 'CUSTOM' &&
    order.fabricSource === 'TAILOR_SOURCES' &&
    !usesFabricFundingV2 &&
    PRE_CUTTING_STAGES.includes(order.stage) &&
    order.customDetail?.fabricApprovalStatus === 'APPROVED'
  const showTailorStyleDecisionCard =
    order.orderKind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.includes(order.stage) &&
    styleAlignment?.requiredBeforeCutting === true &&
    (styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL' || styleAlignment.status === 'CHANGES_REQUESTED')
  const showTailorStyleApprovedAcknowledgement =
    order.orderKind === 'CUSTOM' &&
    styleAlignment?.requiredBeforeCutting === true &&
    styleAlignment.status === 'APPROVED'
  const fabricEvidenceUrls = Array.from(new Set([
    ...fabricEvidenceMedia,
  ]))
  const fabricEvidenceItems = fabricEvidenceUrls.map((uri, index) => ({
    uri,
    label: `Sourced fabric proof ${index + 1}`,
    kind: isVideoUri(uri) ? ('video' as const) : ('photo' as const),
    bucket: isVideoUri(uri) ? undefined : ('order-photos' as const),
  }))

  const quotedHeadlineAmount = baseAmount(order)
  const conversationCtaLabel = isTerminalOrderStage(order.stage)
    ? 'Open order conversation'
    : `Open order chat · ${order.customerName.split(' ')[0]}`

  async function confirmFabricReceived() {
    const currentOrderId = order?.id
    if (!currentOrderId) return
    if (confirmingFabricReceived) return
    Alert.alert(
      'Confirm fabric received',
      'Only confirm this once the customer fabric is actually in your hands and ready for the next step.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            if (confirmingFabricReceived) return
            setConfirmingFabricReceived(true)
            let photoUrl: string | null = null
            try {
              const picked = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8,
              })
              if (picked.canceled || !picked.assets[0]) {
                setConfirmingFabricReceived(false)
                return
              }
              const cleanUri = await stripExif(picked.assets[0].uri)
              const filename = `fabric-receipts/${user?.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
              photoUrl = await uploadPublicStorageImage({
                bucket: 'order-photos',
                path: filename,
                uri: cleanUri,
                contentType: 'image/jpeg',
                maxBytes: 10 * 1024 * 1024,
              })
            } catch (uploadError) {
              setConfirmingFabricReceived(false)
              const message = isLikelyConnectivityIssue(uploadError)
                ? 'Connection looks weak. The fabric receipt photo could not upload yet.'
                : 'The fabric receipt photo could not upload. Please try again.'
              Alert.alert('Photo needed', message)
              return
            }
            const { error } = await invokeFunction('tailor-order-action', {
              body: { orderId: currentOrderId, action: 'confirm-fabric-received', photoUrl },
            })
            setConfirmingFabricReceived(false)
            if (error) {
              const message = isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not confirm fabric receipt yet. Retry when the signal improves.'
                : await readFunctionErrorMessage(error, 'Could not confirm fabric receipt right now. Please try again.')
              Alert.alert('Update unavailable', message)
              return
            }
            await fetchOrder()
          },
        },
      ]
    )
  }

  async function openStageModal(target: OrderStage, purpose: StageSubmissionPurpose = 'STAGE_PROGRESS') {
    if (!order) return
    if (target === 'CUTTING' && usesFabricFundingV2) {
      const { data, error } = await invokeFunction<{ ok?: boolean; blockers?: Array<{ code?: string; message?: string; recovery_action?: string; recoveryAction?: string }> }>(
        'fabric-workflow-action',
        { body: { action: 'cutting-blockers', orderId: order.id }, timeoutMs: 20_000 },
      )
      if (error || !data?.ok) {
        Alert.alert(
          'Cutting check unavailable',
          isLikelyConnectivityIssue(error)
            ? 'Connection looks weak. No stage was changed. Try the Cutting check again when the signal improves.'
            : await readFunctionErrorMessage(error, 'Drapeon could not verify the Cutting gates. No stage was changed.'),
        )
        return
      }
      const blocker = data.blockers?.[0]
      if (blocker?.message) {
        Alert.alert('Cutting is blocked', blocker.message, [{
          text: 'Review fabric step',
          onPress: () => orderScrollRef.current?.scrollTo({
            y: Math.max(0, fabricWorkflowYRef.current - Spacing.md),
            animated: true,
          }),
        }])
        return
      }
    }
    if (target === 'CUTTING' && cuttingBlockerMessage) {
      const recoveryAction = fundedFabricCuttingBlocked
        ? fundedFabricAdvance?.status === 'RELEASED'
          ? {
              text: 'Add final proof',
              onPress: () => setReconcilingMaterialAdvance(fundedFabricAdvance),
            }
          : !fundedFabricAdvance
            ? {
                text: 'Request fabric release',
                onPress: () => setShowMaterialAdvanceModal(true),
              }
            : null
        : null
      Alert.alert(
        'Cutting is blocked',
        cuttingBlockerMessage,
        recoveryAction ? [{ text: 'Not now', style: 'cancel' }, recoveryAction] : [{ text: 'OK' }],
      )
      return
    }
    setStageModalPurpose(purpose)
    setStageModalTarget(target)
    setShowStageModal(true)
  }

  function respondToScopeChange(decision: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    if (!order) return
    const actionLabel =
      decision === 'ACCEPTED' ? 'Accept change' : decision === 'DECLINED' ? 'Decline change' : 'Cancel proposal'
    const message =
      decision === 'ACCEPTED'
        ? 'This records your approval in Drapeon. If this changes price, deadline, fit, or fabric, keep the next step formal before continuing.'
        : decision === 'DECLINED'
          ? 'This records that you cannot accept the requested change.'
          : 'This closes your proposed change without changing the order scope.'
    Alert.alert(actionLabel, message, [
      { text: 'Not now', style: 'cancel' },
      {
        text: actionLabel,
        onPress: async () => {
          const { error } = await invokeFunction('tailor-order-action', {
            body: {
              orderId: order.id,
              action: 'respond-scope-change',
              scopeChangeDecision: decision,
            },
          })
          if (error) {
            Alert.alert(
              'Change unavailable',
              isLikelyConnectivityIssue(error)
                ? 'Connection looks weak. We could not update this change yet.'
                : await readFunctionErrorMessage(error, 'Could not update this change request right now.'),
            )
            return
          }
          void fetchOrder()
        },
      },
    ])
  }

  async function startCall(callType: 'audio' | 'video') {
    if (!order) return
    if (startingCall) return
    setStartingCall(callType)
    try {
      router.push({
        pathname: '/call-join',
        params: {
          orderId: order.id,
          callKind: 'consultation',
          callType,
          historyChain: appendToHistory(historyChain, `/(tailor)/orders/${order.id}`),
        },
      })
    } finally {
      setStartingCall(null)
    }
  }

  function confirmDeclineOrder(title = 'Decline order', message = 'Are you sure you want to decline this order?') {
    if (!order) return
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          if (!order) return
          const { error } = await invokeFunction('tailor-order-action', {
            body: { orderId: order.id, action: 'decline-order' },
          })
          if (error) {
            const message = isLikelyConnectivityIssue(error)
              ? 'Connection looks weak. We could not decline this order yet. Retry when the signal improves.'
              : await readFunctionErrorMessage(error, 'Could not decline this order right now. Please try again in a moment.')
            Alert.alert('Could not decline order', message)
            return
          }
          await purgeTerminalOrderClientState({
            orderId: order.id,
            customerId: order.customerId,
          })
          router.replace('/(tailor)/orders')
        },
      },
    ])
  }

  function openQuoteActionMenu() {
    if (!order) return
    Alert.alert(
      'Order actions',
      'Choose one clear next step for this request.',
      [
        {
          text: 'Request consultation',
          onPress: openConsultationRequestPreflight,
        },
        {
          text: 'Decline order',
          style: 'destructive',
          onPress: () => confirmDeclineOrder(),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  function openConsultationRequestPreflight() {
    Alert.alert(
      'Confirm the time first?',
      'A quick message can prevent rescheduling. You can still continue now if you already agreed on a time.',
      [
        { text: 'Open chat', onPress: openOrderMessages },
        { text: 'Choose time', onPress: () => { setConsultationModalAction('request-consultation'); setShowConsultationModal(true) } },
        { text: 'Not now', style: 'cancel' },
      ],
    )
  }

  async function declineConsultationRequest() {
    if (!order) return
    const { error } = await invokeFunction('tailor-order-action', {
      body: { orderId: order.id, action: 'decline-consultation-request' },
    })
    if (error) {
      const message = isLikelyConnectivityIssue(error)
        ? 'Connection looks weak. We could not decline the consultation yet. Retry when the signal improves.'
        : await readFunctionErrorMessage(error, 'Could not decline this consultation right now.')
      Alert.alert('Consultation unavailable', message)
      return
    }
    fetchOrder()
  }

  function openCustomerConsultationMenu() {
    Alert.alert(
      'Consultation options',
      'Use this only if the requested time or consultation is not right for this order.',
      [
        {
          text: 'Decline consultation',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Decline consultation?',
              'The order returns to quote review so you can still send a quote or decline the full order.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Decline consultation',
                  style: 'destructive',
                  onPress: () => { void declineConsultationRequest() },
                },
              ],
            )
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  function openConsultationCallMenu() {
    if (!order) return
    if (consultationPaymentRequired && !consultationPaymentPaid) {
      Alert.alert(
        'Payment still needed',
        'The customer needs to pay the consultation fee before the call can begin.',
      )
      return
    }
    if (startingCall) return
    if (!consultationCallAvailable) {
      Alert.alert(
        consultationCallExpired ? 'Call window ended' : 'Consultation scheduled',
        consultationCallExpired
          ? 'Message the customer to agree on another time before opening a new call.'
          : `${formatCallCountdown(consultationCallLifecycle.msUntilOpen)}. The call becomes available five minutes before the scheduled time.`,
      )
      return
    }
    const scheduledCallType = consultationMeta?.callType === 'AUDIO' ? 'audio' : 'video'
    const title = order.videoCallUrl ? 'Rejoin consultation' : 'Start consultation'
    const message = order.videoCallUrl
      ? 'Open the current Drapeon consultation call.'
      : `Open the scheduled ${scheduledCallType} call. Drapeon keeps phone numbers private.`
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: scheduledCallType === 'audio' ? 'Open audio call' : 'Open video call', onPress: () => { void startCall(scheduledCallType) } },
    ])
  }

  function openConsultationNextMenu() {
    Alert.alert(
      'After consultation',
      'Choose the next step once you have enough information to proceed.',
      [
        { text: 'Send quote', onPress: () => { setQuoteModalMode('send'); setShowQuoteModal(true) } },
        {
          text: 'Decline order',
          style: 'destructive',
          onPress: () => confirmDeclineOrder('Decline order', 'Are you sure you want to decline this order after consultation?'),
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  function openFlexibleStageMenu() {
    if (!order || !flexibleNextStages?.length) return
    if (flexibleNextStages.length === 1) {
      openStageModal(flexibleNextStages[0])
      return
    }
    setShowFlexibleStageSheet(true)
  }

  async function markHandoffIssueResolved() {
    if (!handoffIssue || resolvingHandoffIssue) return
    setResolvingHandoffIssue(true)
    const result = await resolveHandoffIssue(handoffIssue.id, 'Resolved from tailor order screen.')
    setResolvingHandoffIssue(false)
    if (result.error) {
      Alert.alert('Could not close help thread', result.error)
      return
    }
    await fetchOrder()
  }

  async function openCustomerReview() {
    if (!order) return
    const { count, error } = await supabase
      .from('customer_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', order.id)

    if (error) {
      Sentry.captureException(error, {
        extra: { context: 'open_customer_review_preflight', orderId: order.id },
      })
      Alert.alert('Review unavailable', 'We could not check this review yet. Reopen the order and try again.')
      return
    }

    if ((count ?? 0) > 0) {
      setHasCustomerReview(true)
      Alert.alert(
        'Review already saved',
        'Drapeon keeps one internal customer review per order. You can review this customer again after a future order.',
      )
      return
    }

    router.push({
      pathname: '/(tailor)/clients/review/[orderId]',
      params: {
        orderId: order.id,
        returnTo: '/(tailor)/orders',
        historyChain: appendToHistory(historyChain, `/(tailor)/orders/${order.id}`),
      },
    })
  }

  const successfulPaymentExists = hasSuccessfulPaymentEvent(order.stageUpdates)
  const latestTimelineUpdate = [...order.stageUpdates].reverse()[0]
  const fabricApprovalHistoryMediaSet = new Set(fabricApprovalHistoryMedia)
  const fabricApprovalUpdateIds = new Set(
    order.stageUpdates
      .filter((update) => !!update.photoUrl && fabricApprovalHistoryMediaSet.has(update.photoUrl))
      .map((update) => update.id),
  )
  const tailorHistoryUpdateLabelRaw = (update: StageUpdate) => fabricApprovalUpdateIds.has(update.id)
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
        : timelineStageLabel(update, order.orderKind, successfulPaymentExists)
  const tailorHistoryUpdateLabel = (update: StageUpdate, isLatest = false) =>
    deriveFulfillmentAwareHistoryLabel({
      eventStage: update.stage,
      effectiveMethod: dispatchFulfillmentState?.effectiveMethod ?? order.deliveryMethod,
      defaultLabel: tailorHistoryUpdateLabelRaw(update),
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.back} onPress={goBack}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        ref={orderScrollRef}
        style={styles.scroll}
        {...capsuleNavScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 48, 72) }}
      >
        <View style={styles.content}>

          {/* Header */}
          <View>
            <Text style={styles.heading}>{order.garmentType}</Text>
            <Text style={styles.subheading}>{order.customerName}  ·  #{order.reference}</Text>
            {order.orderKind === 'READY_MADE' ? (
              <View style={styles.orderTypePill}>
                <Text style={styles.orderTypePillText}>Ready-made order</Text>
              </View>
            ) : null}
            <View style={styles.stageRow}>
              <DrapeStatusChip
                value={displayedOrderStage}
                label={displayedOrderStageLabel}
                domain="order"
                testID="tailor-order-stage"
              />
              {quotedHeadlineAmount != null && (
                <Text style={styles.amount}>
                  {formatAmount(
                    quotedHeadlineAmount,
                    order.quotedCurrency as CurrencyCode,
                    order.quotedCurrency as CurrencyCode,
                    STATIC_FALLBACK_RATES
                  )} {quotedAmountLabel(order.stage, order.orderKind, false)}
                </Text>
              )}
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={conversationCtaLabel}
              style={styles.messageAction}
              onPress={openOrderMessages}
            >
              <Feather name="message-circle" size={17} color={Colors.needleGreenDark} />
              <Text style={styles.messageActionText}>{conversationCtaLabel}</Text>
              <Feather name="chevron-right" size={17} color={Colors.midGrey} />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }}>
              <CommercialReceiptCard orderId={order.id} actorRole="TAILOR" />
              <SettlementProgressCard orderId={order.id} actorRole="TAILOR" />
            </View>
            {!isBeforeConfirmation ? (
              <DrapeonDispatchCard
                orderId={order.id}
                orderStage={order.stage}
                actorRole="TAILOR"
                onFulfillmentStateChange={setDispatchFulfillmentState}
                onOrderStateChange={() => fetchOrder({ silent: true })}
              />
            ) : null}
          </View>

          {!isBeforeConfirmation ? (
            <View onLayout={(event) => { fabricWorkflowYRef.current = event.nativeEvent.layout.y }}>
              <FabricWorkflowCard orderId={order.id} policyVersion={order.fabricFundingPolicyVersion} />
            </View>
          ) : null}

          {focusedMaterialAdvance ? (
            <View
              accessibilityRole="alert"
              style={[
                styles.supportCard,
                focusedMaterialAdvance.status === 'DECLINED'
                  ? styles.supportCardWarning
                  : styles.supportCardSuccess,
              ]}
            >
              <Text style={styles.supportCardTitle}>
                {focusedMaterialCopy?.title ?? (focusedMaterialAdvance.status === 'DECLINED'
                  ? 'Customer declined material request'
                  : 'Customer approved material request')}
              </Text>
              <Text style={styles.supportBodyText}>{focusedMaterialAdvance.title}</Text>
              {focusedMaterialCopy ? (
                <Text style={styles.supportHint}>{focusedMaterialCopy.body}</Text>
              ) : focusedMaterialAdvance.status === 'DECLINED' ? (
                <Text style={styles.supportHint}>
                  Reason: {materialAdvanceDeclineReasonLabel(focusedMaterialAdvance.customerResponseReason) ?? 'Not specified'}
                </Text>
              ) : (
                <Text style={styles.supportHint}>
                  Customer approval is recorded. Payment and Drapeon release review remain separate steps.
                </Text>
              )}
              {focusedMaterialAdvance.customerResponseNote ? (
                <Text style={styles.supportBodyText}>{focusedMaterialAdvance.customerResponseNote}</Text>
              ) : null}
            </View>
          ) : null}

          {showTailorFabricActionCard ? (
            <View style={[styles.supportCard, styles.supportCardWarning]}>
              <View style={styles.disclosureHeader}>
                <View style={styles.disclosureCopy}>
                  <Text style={styles.supportCardTitle}>
                    {order.customDetail?.fabricApprovalStatus === 'CHANGES_REQUESTED'
                      ? 'Customer requested fabric changes'
                      : order.customDetail?.fabricApprovalStatus === 'PENDING_CUSTOMER_APPROVAL' && fabricEvidenceItems.length > 0
                        ? 'Fabric awaiting customer approval'
                        : 'Fabric sourcing needs action'}
                  </Text>
                  <Text style={styles.supportHint}>
                    {order.customDetail?.fabricApprovalStatus === 'PENDING_CUSTOMER_APPROVAL' && fabricEvidenceItems.length === 0
                      ? 'Fabric proof still needs uploading'
                      : fabricApprovalStatus ?? 'Upload sourced fabric before cutting'}
                  </Text>
                  {order.customDetail?.fabricApprovalStatus === 'CHANGES_REQUESTED' && fabricChangeFeedback ? (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="View the customer's requested fabric changes"
                      style={styles.fabricChangeFeedbackLink}
                      onPress={() => setShowFabricChangeFeedback(true)}
                    >
                      <Text style={styles.fabricChangeFeedbackLinkText}>View changes</Text>
                      <Feather name="chevron-right" size={14} color={Colors.needleGreenDark} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
              {fabricDescription ? (
                <Text style={styles.supportBodyText}>{fabricDescription}</Text>
              ) : null}
              <View style={styles.supportMetaList}>
                {fabricBudgetAmount != null ? (
                  <BriefRow
                    label="Fabric budget"
                    value={formatAmount(fabricBudgetAmount, fabricBudgetCurrency as CurrencyCode, fabricBudgetCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                  />
                ) : null}
                {fabricSourcingDeadlineDays ? (
                  <BriefRow label="Sourcing update due" value={`${fabricSourcingDeadlineDays} business days`} />
                ) : null}
              </View>
              {fabricEvidenceItems.length > 0 ? (
                <DrapeMediaMosaic
                  items={fabricEvidenceItems.map((item, index) => ({
                    id: `fabric:${index}:${item.uri}`,
                    uri: item.uri,
                    kind: item.kind,
                    label: item.label,
                    bucket: item.bucket,
                  }))}
                  compact
                  contentFit="contain"
                  onPressItem={(_, index) => openMediaPreview(fabricEvidenceItems, index)}
                  testID="tailor-sourced-fabric-proof"
                />
              ) : null}
              <Text style={styles.supportHint}>
                {order.customDetail?.fabricApprovalStatus === 'PENDING_CUSTOMER_APPROVAL'
                  ? 'Your proof is with the customer. You can replace it if the color, weave, or framing is unclear.'
                  : 'Upload the fabric in natural light and show its color and weave clearly before cutting.'}
              </Text>
              <Button
                label={
                  order.customDetail?.fabricApprovalStatus === 'PENDING_CUSTOMER_APPROVAL'
                    ? (fabricEvidenceItems.length > 0 ? 'Replace fabric proof' : 'Upload fabric proof')
                    : order.customDetail?.fabricApprovalStatus === 'CHANGES_REQUESTED'
                      ? 'Upload replacement fabric'
                      : 'Upload sourced fabric'
                }
                onPress={() => openStageModal('SOURCING', 'FABRIC_APPROVAL')}
              />
              {order.stage === 'SOURCING' ? (
                <Button
                  label="Add sourcing update"
                  variant="secondary"
                  onPress={() => openStageModal('SOURCING', 'STAGE_PROGRESS')}
                />
              ) : null}
            </View>
          ) : null}

          {showTailorFabricApprovedAcknowledgement ? (
            <View
              style={styles.fabricDecisionSuccess}
              accessibilityRole="summary"
              accessibilityLabel="Fabric approved. The customer approved the selected fabric."
            >
              <View style={styles.fabricDecisionSuccessIcon}>
                <Feather name="check" size={17} color={Colors.textInverse} />
              </View>
              <View style={styles.fabricDecisionSuccessCopy}>
                <Text style={styles.fabricDecisionSuccessTitle}>Fabric approved</Text>
                <Text style={styles.fabricDecisionSuccessBody}>
                  The customer approved the selected fabric. Continue once the remaining pre-cutting checks are clear.
                </Text>
              </View>
            </View>
          ) : null}

          {showTailorStyleDecisionCard ? (
            <View style={[styles.supportCard, styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>
                {styleAlignment?.status === 'CHANGES_REQUESTED'
                  ? 'Customer requested style clarification'
                  : 'Style plan awaiting customer approval'}
              </Text>
              <Text style={styles.supportBodyText} numberOfLines={3}>
                {styleAlignment?.tailorInterpretation ?? 'Explain the planned interpretation before cutting.'}
              </Text>
              {styleAlignment?.proposalPhotoUrl ? (
                <Button
                  label="View proposed design image"
                  variant="secondary"
                  onPress={() => setMediaPreview({ items: [{ uri: styleAlignment.proposalPhotoUrl!, label: 'Style proposal', kind: 'photo' }], index: 0 })}
                />
              ) : null}
              {styleAlignment?.status === 'CHANGES_REQUESTED' && styleChangeFeedback ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="View the customer's requested style clarification"
                  style={styles.fabricChangeFeedbackLink}
                  onPress={() => setShowStyleChangeFeedback(true)}
                >
                  <Text style={styles.fabricChangeFeedbackLinkText}>View changes</Text>
                  <Feather name="chevron-right" size={14} color={Colors.needleGreenDark} />
                </TouchableOpacity>
              ) : null}
              <Button
                label={styleAlignment?.status === 'CHANGES_REQUESTED' ? 'Send updated style plan' : 'Update style plan'}
                variant={styleAlignment?.status === 'CHANGES_REQUESTED' ? undefined : 'secondary'}
                onPress={() => setShowStyleAlignmentModal(true)}
              />
            </View>
          ) : null}

          {showTailorStyleApprovedAcknowledgement ? (
            <View style={styles.fabricDecisionSuccess} accessibilityRole="summary">
              <View style={styles.fabricDecisionSuccessIcon}>
                <Feather name="check" size={17} color={Colors.textInverse} />
              </View>
              <View style={styles.fabricDecisionSuccessCopy}>
                <Text style={styles.fabricDecisionSuccessTitle}>Style plan approved</Text>
                <Text style={styles.fabricDecisionSuccessBody}>
                  The customer approved your interpretation. Continue once the remaining pre-cutting checks are clear.
                </Text>
                {styleAlignment?.tailorInterpretation ? (
                  <Text style={styles.fabricDecisionSuccessBody}>{styleAlignment.tailorInterpretation}</Text>
                ) : null}
              </View>
              {styleAlignment?.proposalPhotoUrl ? (
                <Button
                  label="View approved sketch or look sheet"
                  variant="secondary"
                  onPress={() => setMediaPreview({ items: [{ uri: styleAlignment.proposalPhotoUrl!, label: 'Approved style plan', kind: 'photo' }], index: 0 })}
                />
              ) : null}
            </View>
          ) : null}

          <SupportDisclosure
            title="Customer context"
            summary={
              customerReviewSummary && customerReviewSummary.count > 0
                ? `${customerReviewSummary.count} past ${customerReviewSummary.count === 1 ? 'review' : 'reviews'}${
                    customerReviewSummary.averageRating
                      ? ` · ${customerReviewSummary.averageRating.toFixed(1)}/5`
                      : ''
                  }`
                : referralTrust?.visibleToTailor
                  ? 'Referral and customer history'
                  : 'Profile and order history'
            }
            defaultExpanded={false}
          >
            {referralTrust?.visibleToTailor ? (
              <View style={styles.referralTrustCard}>
                <Feather name="user-check" size={16} color={Colors.needleGreenDark} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.referralTrustTitle}>
                    Referred through Drapeon
                  </Text>
                  <Text style={styles.referralTrustText}>
                    {referralTrust.referrerName
                      ? `${referralTrust.referrerName} referred this customer`
                      : 'This customer was referred by a Drapeon user'}
                    {typeof referralTrust.completedOrderCount === 'number'
                      ? ` · ${referralTrust.completedOrderCount} completed ${referralTrust.completedOrderCount === 1 ? 'order' : 'orders'}`
                      : ''}
                    . Treat it as context, not a shortcut around brief review.
                  </Text>
                </View>
              </View>
            ) : null}
            <Text style={styles.supportHint}>
              {customerReviewSummary && customerReviewSummary.count > 0
                ? 'Review the internal notes before taking on extra risk.'
                : 'No previous internal reviews. Keep decisions in Drapeon so future context stays useful.'}
            </Text>
            {customerReviewSummary?.tags.length ? (
              <Text style={styles.supportHint}>Notes seen before: {customerReviewSummary.tags.join(', ')}</Text>
            ) : null}
            <Button
              label="Open customer profile"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/(tailor)/clients/[clientId]',
                  params: {
                    clientId: order.customerId,
                    historyChain: appendToHistory(historyChain, `/(tailor)/orders/${order.id}`),
                  },
                })
              }
            />
          </SupportDisclosure>

          {/* PENDING_QUOTE — show brief + quote/consultation CTAs */}
          {(order.stage === 'PENDING_QUOTE' || consultationQuotePreparationReady) && (
            <View style={styles.alertCard}>
              {order.orderKind === 'READY_MADE' ? (
                <>
                  <Text style={styles.alertTitle}>New item inquiry</Text>
                  <Text style={styles.alertSub}>
                    This customer has a question before buying. Open messages to reply about fit, stock, pickup, delivery, or shipping.
                  </Text>
                  <Button
                    label="Open messages"
                    onPress={() =>
                      router.push({
                        pathname: '/(tailor)/messages/[orderId]',
                        params: {
                          orderId: order.id,
                          returnTo: `/(tailor)/orders/${order.id}`,
                          historyChain: appendToHistory(historyChain, `/(tailor)/orders/${order.id}`),
                        },
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <Text style={styles.alertTitle}>
                    {consultationQuotePreparationReady ? 'Consultation finished. Your quote is needed' : 'New order. Your quote is needed'}
                  </Text>
                  <Text style={styles.alertSub}>
                    {consultationQuotePreparationReady
                      ? 'Send the quote when ready. Attendance and fee settlement continue separately in the background.'
                      : 'Review the order details below and send your quote. You can also request a consultation first.'}
                  </Text>
                  <Button
                    label="Send quote"
                    onPress={() => { setQuoteModalMode('send'); setShowQuoteModal(true) }}
                    testID="tailor-send-quote-btn"
                  />
                  <TouchableOpacity style={styles.compactActionMenuButton} onPress={openQuoteActionMenu}>
                    <Text style={styles.compactActionMenuText}>Consultation or decline</Text>
                    <Feather name="chevron-down" size={16} color={Colors.needleGreenDark} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {QUOTE_NEGOTIATION_UI_ENABLED && order.stage === 'QUOTE_SENT' && openQuoteRevision ? (
            <DrapeInlineActionCard
              eyebrow={`Revision ${openQuoteRevision.roundNumber} of ${order.negotiationRoundLimit}`}
              title="Customer requested quote changes"
              body={openQuoteRevision.note}
              icon="edit-3"
            >
              <View style={styles.quoteRevisionReasonRow}>
                {openQuoteRevision.reasonCodes.map((reason) => (
                  <DrapeStatusChip
                    key={reason}
                    label={QUOTE_REVISION_REASON_LABELS[reason as QuoteRevisionReason] ?? 'Other'}
                    tone="warning"
                  />
                ))}
              </View>
              <DrapeCapsuleButton
                label="Revise quote"
                onPress={() => { setQuoteModalMode('revise'); setShowQuoteModal(true) }}
                testID="tailor-revise-quote-btn"
              />
              <DrapeCapsuleButton
                label="Other responses"
                tone="secondary"
                onPress={() => setShowRevisionResponseSheet(true)}
              />
            </DrapeInlineActionCard>
          ) : null}

          {order.stage === 'QUOTE_SENT'
            && !openQuoteRevision
            && taxSnapshotNeedsRefresh(order) ? (
              <DrapeInlineActionCard
                eyebrow="Quote cannot be paid"
                title="Refresh Ghana tax"
                body="The tailoring and fabric amounts are saved, but this quote uses an older tax snapshot. Send a revised quote to apply the current VAT, NHIL, and GETFund rates."
                icon="alert-circle"
              >
                <DrapeCapsuleButton
                  label="Refresh quote"
                  onPress={() => { setQuoteModalMode('revise'); setShowQuoteModal(true) }}
                />
              </DrapeInlineActionCard>
            ) : null}

          {/* CONSULTATION — tailor awaiting consultation, then sends quote */}
          {order.stage === 'CONSULTATION' && !consultationRescheduleRequired && !consultationCallExpired && (
            <View style={[styles.alertCard, styles.consultationCard]}>
              <Text style={styles.alertTitle}>
                {customerRequestedConsultation
                  ? 'Consultation requested'
                  : consultationCallAvailable
                    ? 'Consultation call available'
                    : consultationCallExpired
                      ? 'Consultation window ended'
                      : 'Consultation scheduled'}
              </Text>
              <Text style={styles.alertSub}>
                {customerRequestedConsultation
                  ? 'The customer asked to speak before you quote.'
                  : consultationPaymentRequired && !consultationPaymentPaid
                  ? 'Waiting for the customer to pay.'
                  : 'Consultation scheduled. Send a quote afterward.'}
              </Text>
              {consultationMeta?.proposedStartAt && customerRequestedConsultation ? (
                <Text style={styles.supportHint}>Requested time: {formatConsultationStart(consultationMeta.proposedStartAt, consultationMeta.timezone)}</Text>
              ) : consultationMeta?.scheduledStartAt ? (
                <Text style={styles.supportHint}>Scheduled: {formatConsultationStart(consultationMeta.scheduledStartAt, consultationMeta.timezone)}</Text>
              ) : null}
              {customerRequestedConsultation && consultationMeta?.requestExpiresAt ? (
                <Text style={styles.supportHint}>Respond by {formatConsultationStart(consultationMeta.requestExpiresAt, consultationMeta.timezone)}</Text>
              ) : null}
              {consultationPaymentRequired ? (
                <Text style={styles.supportHint}>
                  {consultationPaymentPaid
                    ? 'Consultation fee paid. You can start the consultation call at the scheduled time.'
                    : 'The customer still needs to pay the consultation fee before the consultation can begin.'}
                </Text>
              ) : null}
              {customerRequestedConsultation ? (
                <>
                  <Button
                    label="Approve and schedule"
                    onPress={() => {
                      setConsultationModalAction('approve-consultation')
                      setShowConsultationModal(true)
                    }}
                  />
                  <TouchableOpacity style={styles.compactActionMenuButton} onPress={openCustomerConsultationMenu}>
                    <Text style={styles.compactActionMenuText}>Other consultation options</Text>
                    <Feather name="chevron-down" size={16} color={Colors.needleGreenDark} />
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {consultationCallAvailable ? (
                    <Button
                      label={`Join ${consultationMeta?.callType === 'AUDIO' ? 'audio' : 'video'} call now`}
                      onPress={openConsultationCallMenu}
                      loading={!!startingCall}
                      disabled={!!startingCall || (consultationPaymentRequired && !consultationPaymentPaid)}
                    />
                  ) : consultationCallLifecycle.status === 'upcoming' ? (
                    <Button
                      label={formatCallCountdown(consultationCallLifecycle.msUntilOpen)}
                      variant="secondary"
                      onPress={() => {}}
                      disabled
                    />
                  ) : (
                    <Button
                      label="Message customer about timing"
                      variant="secondary"
                      onPress={openOrderMessages}
                    />
                  )}
                  <TouchableOpacity style={styles.compactActionMenuButton} onPress={openConsultationNextMenu}>
                    <Text style={styles.compactActionMenuText}>Quote or decline</Text>
                    <Feather name="chevron-down" size={16} color={Colors.needleGreenDark} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {consultationMeta?.scheduledStartAt ? (
            <ConsultationAttendancePanel orderId={order.id} actorRole="TAILOR" />
          ) : null}
          {consultationMeta?.scheduledStartAt ? (
            <ConsultationReschedulePanel
              orderId={order.id}
              actorRole="TAILOR"
              actorId={userId}
              counterpartName={order.customerName?.split(' ')[0]}
              onOpenChat={openOrderMessages}
              onOpenCall={() => openConsultationCallMenu()}
              onUpdated={() => { void fetchOrder({ silent: true }) }}
              onRescheduleRequiredChange={setConsultationRescheduleRequired}
            />
          ) : null}
          {consultationMeta?.scheduledStartAt && !consultationRescheduleRequired && !consultationCallExpired ? (
            <ConsultationLifecyclePanel orderId={order.id} actorRole="TAILOR" onUpdated={() => { void fetchOrder({ silent: true }) }} />
          ) : null}
          <TaxDecisionSummaryCard orderId={order.id} />

          {order.orderKind === 'CUSTOM' && (consultationMeta || quoteBreakdown || bulkOrder) ? (
            <SupportDisclosure
              title="Commercial setup"
              summary={[
                consultationMeta ? 'Consultation' : '',
                quoteBreakdown ? 'Quote breakdown' : '',
                bulkOrder?.enabled ? 'Bulk handling' : '',
              ].filter(Boolean).join(' · ')}
              defaultExpanded={false}
            >
              {consultationMeta ? (
                <View style={styles.disclosureSection}>
                  <Text style={styles.supportCardTitle}>Consultation policy</Text>
                  <View style={styles.supportMetaList}>
                    <BriefRow label="Status" value={formatConsultationStatusLabel(consultationMeta.status)} />
                    <BriefRow
                      label="Fee"
                      value={
                        consultationMeta.feeAmount && consultationMeta.feeCurrency
                          ? formatAmount(
                              consultationMeta.feeAmount,
                              consultationMeta.feeCurrency as CurrencyCode,
                              consultationMeta.feeCurrency as CurrencyCode,
                              STATIC_FALLBACK_RATES,
                            )
                          : 'Free'
                      }
                    />
                    {consultationMeta.feeAmount ? (
                      <BriefRow label="Fee treatment" value={consultationMeta.feeCreditable ? 'Credits toward the final order' : 'Separate consultation fee'} />
                    ) : null}
                    {consultationMeta.scheduledStartAt ? (
                      <BriefRow label="Scheduled for" value={formatConsultationStart(consultationMeta.scheduledStartAt, consultationMeta.timezone)} />
                    ) : consultationMeta.proposedStartAt ? (
                      <BriefRow label="Requested time" value={formatConsultationStart(consultationMeta.proposedStartAt, consultationMeta.timezone)} />
                    ) : null}
                    {consultationMeta.paymentTiming ? (
                      <BriefRow label="Payment timing" value={CONSULTATION_PAYMENT_TIMING_LABELS[consultationMeta.paymentTiming]} />
                    ) : null}
                    {consultationMeta.reschedulePolicy ? (
                      <BriefRow label="Rescheduling" value={CONSULTATION_RESCHEDULE_POLICY_LABELS[consultationMeta.reschedulePolicy]} />
                    ) : null}
                    {consultationMeta.noShowPolicy ? (
                      <BriefRow label="No-show" value={CONSULTATION_NO_SHOW_POLICY_LABELS[consultationMeta.noShowPolicy]} />
                    ) : null}
                    {consultationMeta.status === 'REQUESTED' && consultationMeta.requestExpiresAt ? (
                      <BriefRow label="Respond by" value={formatConsultationStart(consultationMeta.requestExpiresAt, consultationMeta.timezone)} />
                    ) : consultationMeta.expiryPolicy ? (
                      <BriefRow label="Booking validity" value={CONSULTATION_EXPIRY_POLICY_LABELS[consultationMeta.expiryPolicy]} />
                    ) : null}
                    {consultationPaymentRequired ? (
                      <BriefRow label="Payment status" value={consultationPaymentPaid ? 'Paid and ready to schedule' : 'Waiting for customer payment'} />
                    ) : null}
                    <BriefRow label="Reminder" value={consultationMeta.reminderEnabled === false ? 'No reminder planned' : 'Reminder enabled'} />
                  </View>
                  {consultationMeta.requestNote ? <Text style={styles.supportHint}>{consultationMeta.requestNote}</Text> : null}
                </View>
              ) : null}

              {quoteBreakdown ? (
                <View
                  style={
                    consultationMeta
                      ? [styles.disclosureSection, styles.disclosureSectionBordered]
                      : styles.disclosureSection
                  }
                >
                  <Text style={styles.supportCardTitle}>Quote breakdown</Text>
                  <View style={styles.supportMetaList}>
                    {typeof quoteBreakdown.laborAmount === 'number' ? (
                      <BriefRow
                        label="Labour"
                        value={formatAmount(quoteBreakdown.laborAmount, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                      />
                    ) : null}
                    {typeof quoteBreakdown.sourcingAmount === 'number' ? (
                      <BriefRow
                        label="Sourcing"
                        value={formatAmount(quoteBreakdown.sourcingAmount, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                      />
                    ) : null}
                    {typeof quoteBreakdown.rushAmount === 'number' ? (
                      <BriefRow
                        label="Rush fee"
                        value={formatAmount(quoteBreakdown.rushAmount, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                      />
                    ) : null}
                    {typeof quoteBreakdown.consultationCreditAmount === 'number' && quoteBreakdown.consultationCreditAmount > 0 ? (
                      <BriefRow
                        label="Consultation fee credit"
                        value={`-${formatAmount(quoteBreakdown.consultationCreditAmount, order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}`}
                      />
                    ) : null}
                  </View>
                  {quoteBreakdown.summary ? <Text style={styles.supportBodyText}>{quoteBreakdown.summary}</Text> : null}
                  {quoteBreakdown.included && quoteBreakdown.included.length > 0 ? (
                    <Text style={styles.supportHint}>Included: {quoteBreakdown.included.join(', ')}</Text>
                  ) : null}
                  {quoteBreakdown.excluded && quoteBreakdown.excluded.length > 0 ? (
                    <Text style={styles.supportHint}>Not included: {quoteBreakdown.excluded.join(', ')}</Text>
                  ) : null}
                </View>
              ) : null}

              {bulkOrder?.enabled ? (
                <View
                  style={
                    consultationMeta || quoteBreakdown
                      ? [styles.disclosureSection, styles.disclosureSectionBordered]
                      : styles.disclosureSection
                  }
                >
                  <Text style={styles.supportCardTitle}>Bulk order handling</Text>
                  <View style={styles.supportMetaList}>
                    <BriefRow label="Mode" value="Ops-managed linked custom order" />
                    {bulkOrder.recipientCount ? <BriefRow label="Recipients" value={`${bulkOrder.recipientCount}`} /> : null}
                    {bulkOrder.label ? <BriefRow label="Group label" value={bulkOrder.label} /> : null}
                    {bulkOrder.memberNames && bulkOrder.memberNames.length > 0 ? (
                      <BriefRow label="Members" value={bulkOrder.memberNames.join(', ')} />
                    ) : null}
                    <BriefRow
                      label="Measurement privacy"
                      value={bulkOrder.measurementPrivacy === 'TAILOR_ONLY' ? 'Tailor only' : 'Tailor-private by default'}
                    />
                    {bulkOrder.memberMeasurementPolicy ? (
                      <BriefRow label="Measurement rule" value={bulkOrder.memberMeasurementPolicy} />
                    ) : null}
                    <BriefRow
                      label="Payer model"
                      value={bulkOrder.payerModel === 'SINGLE_PAYER' ? 'One payer covers the full group order' : 'Single payer'}
                    />
                    <BriefRow
                      label="Status policy"
                      value={bulkOrder.statusPolicy === 'OPS_MANAGED_LINKED_CHILDREN' ? 'Ops manages linked recipient timelines' : 'Linked custom order'}
                    />
                    <BriefRow label="Dye-lot consistency" value={bulkOrder.dyeLotConsistencyRequired ? 'Required' : 'Not flagged'} />
                  </View>
                  <Text style={styles.supportHint}>
                    Keep recipient-level measurements and any consistency notes inside Drapeon so ops can help manage the group cleanly.
                  </Text>
                  {bulkOrder.notes ? <Text style={styles.supportHint}>{bulkOrder.notes}</Text> : null}
                </View>
              ) : null}
            </SupportDisclosure>
          ) : null}

          {/* Flexible stages: CONFIRMED / DESIGNING / SOURCING — tailor picks next stage */}
          {isFlexibleStage && flexibleNextStages && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>
                {order.orderKind === 'READY_MADE' ? 'Prepare this order' : 'Update production stage'}
              </Text>
              <Text style={styles.stageCardSub}>
                Currently: <Text style={{ color: Colors.needleGreenDark, fontWeight: FontWeight.semibold }}>{tailorOrderStageLabel(order.stage, order.orderKind)}</Text>
              </Text>
              <Text style={styles.stageCardHint}>
                {order.orderKind === 'READY_MADE'
                  ? 'Ready-made orders skip tailoring production stages. Move this into preparation, then ship it or mark it ready for collection.'
                  : 'Choose which stage to move to next. Tailors often run design and sourcing in parallel.'}
              </Text>
              <Button
                label={flexibleNextStages.length === 1 ? displayStageChoiceLabel(flexibleNextStages[0], order.orderKind) : 'Choose next stage'}
                onPress={openFlexibleStageMenu}
              />
              {flexibleNextStages.length > 1 ? (
                <Text style={styles.stageCardHint}>
                  Available next steps: {flexibleNextStages.map((target) => displayStageChoiceLabel(target, order.orderKind)).join(' · ')}
                </Text>
              ) : null}
            </View>
          )}

          {/* Linear stages: CUTTING / SEWING — single next stage */}
          {!isFlexibleStage && (order.stage === 'CUTTING' || order.stage === 'SEWING') && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>Update production stage</Text>
              <Text style={styles.stageCardSub}>
                Currently: <Text style={{ color: Colors.needleGreenDark, fontWeight: FontWeight.semibold }}>{tailorOrderStageLabel(order.stage, order.orderKind)}</Text>
              </Text>
              <Button
                label={`Advance to ${nextProductionStage ? STAGE_LABELS[nextProductionStage] : '...'}`}
                onPress={() => openStageModal(nextProductionStage!)}
              />
            </View>
          )}

          {order.stage === 'FINISHING' && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>{order.orderKind === 'READY_MADE' ? 'Preparing order' : 'Almost done'}</Text>
              <Text style={styles.stageCardSub}>
                {order.deliveryMethod === 'LOCAL_COLLECTION'
                  ? (order.orderKind === 'READY_MADE'
                      ? 'Mark this order ready for collection once it is packed and checked.'
                      : 'Mark as finished and ready for collection.')
                  : (order.orderKind === 'READY_MADE'
                      ? `Keep packing and checking this order. When it is ready, hand it to Drapeon for dispatch.`
                      : `Mark this order ready for Drapeon dispatch once it is packed and checked.`)}
              </Text>
              {order.deliveryMethod !== 'LOCAL_COLLECTION' ? (
                <Text style={styles.stageCardHint}>
                  Drapeon manages dispatch after this step; finish packing, quality-check the order, and hand it over cleanly.
                </Text>
              ) : null}
              {order.deliveryMethod === 'LOCAL_COLLECTION' ? (
                <Button
                  label="Mark ready for collection"
                  onPress={() => openStageModal('READY_FOR_COLLECTION')}
                />
              ) : (
                <Button
                  label="Mark ready for Drapeon dispatch"
                  onPress={() => openStageModal('READY_FOR_DRAPE_DISPATCH')}
                />
              )}
            </View>
          )}

          {/* READY_FOR_COLLECTION — code entry */}
          {pickupCredentialActive && (
            <View style={[styles.stageCard, { borderColor: Colors.needleGreen, borderWidth: 1.5 }]}>
              <Text style={styles.stageCardTitle}>Awaiting customer collection</Text>
              <Text style={styles.stageCardSub}>
                Ask the customer to show their 4-digit code, then enter it below to confirm collection and close the handoff in Drapeon.
              </Text>
              <Button label="Enter collection code" onPress={() => setShowCodeModal(true)} />
            </View>
          )}

          {statusGuidance && order.stage !== 'FINISHING' && (
            <View style={styles.stageCard}>
              <Text style={styles.stageCardTitle}>{displayedOrderStageLabel}</Text>
              <Text style={styles.stageCardSub}>{statusGuidance}</Text>
            </View>
          )}

          <SupportDisclosure
            title="Order history"
            summary={orderHistorySummary({
              updateCount: order.stageUpdates.length,
              lastUpdatedLabel: latestTimelineUpdate
                ? formatTimelineDate(latestTimelineUpdate.createdAt)
                : null,
              latestEventLabel: latestTimelineUpdate
                ? tailorHistoryUpdateLabel(latestTimelineUpdate, true)
                : 'No evidence yet',
            })}
            defaultExpanded={false}
          >
            <Text style={styles.supportHint}>
              Production milestones and evidence shared with the customer and Drapeon support. Tap any photo or video to view it full screen.
            </Text>
            <View style={styles.timeline}>
              {order.stageUpdates.length > 0 ? order.stageUpdates.map((update) => (
                <View key={update.id} style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: timelineDotColor(update, successfulPaymentExists) }]} />
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineStage}>
                      {tailorHistoryUpdateLabel(update)}
                    </Text>
                    {timelineNoteText(update, successfulPaymentExists) ? (
                      <Text style={styles.timelineNote}>{timelineNoteText(update, successfulPaymentExists)}</Text>
                    ) : null}
                    {update.photoUrl ? (() => {
                      const mediaIndex = timelineMediaItems.findIndex((item) => item.uri === update.photoUrl)
                      return (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${tailorHistoryUpdateLabel(update)} evidence`}
                          accessibilityHint="Opens the order evidence gallery full screen"
                          activeOpacity={0.88}
                          onPress={() => openMediaPreview(timelineMediaItems, Math.max(0, mediaIndex))}
                        >
                          <StageMediaPreview
                            uri={update.photoUrl}
                            style={styles.timelinePhoto}
                            surface="tailor_order_timeline_photo"
                          />
                        </TouchableOpacity>
                      )
                    })() : null}
                    <Text style={styles.timelineDate}>{formatTimelineDate(update.createdAt)}</Text>
                  </View>
                </View>
              )) : (
                <View style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: Colors.lightGrey }]} />
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineStage}>No evidence yet</Text>
                    <Text style={styles.timelineNote}>
                      Add photos when updating production stages so the final handoff has a clear evidence trail.
                    </Text>
                  </View>
                </View>
              )}
            </View>
            {timelineMosaicItems.length > 0 ? (
              <View style={{ gap: Spacing.sm }}>
                <Text style={styles.supportCardTitle}>All production evidence</Text>
                <DrapeMediaMosaic
                  items={timelineMosaicItems}
                  compact
                  onPressItem={(_, index) => openMediaPreview(timelineMediaItems, index)}
                  testID="tailor-order-history-media"
                />
              </View>
            ) : null}
          </SupportDisclosure>

          <ExtensionRequestCard
            orderId={order.id}
            currency={order.quotedCurrency}
            currentDeadline={order.quotedCompletionDate ?? order.deadline}
            allowRequest={
              initialPaymentLikelyPaid &&
              !['DELIVERED', 'COLLECTED', 'COMPLETE', 'CANCELLED', 'DECLINED', 'EXPIRED'].includes(order.stage)
            }
            onChanged={fetchOrder}
          />
          {order.stage !== 'COMPLETE' ? <CommercialAdjustmentCard orderId={order.id} actorRole="TAILOR" onChanged={fetchOrder} /> : null}
          <OpsRefundStatusCard orderId={order.id} actorRole="TAILOR" />
          {order.stage !== 'COMPLETE' ? <ReturnResolutionCard orderId={order.id} actorRole="TAILOR" currency={order.quotedCurrency} onChanged={fetchOrder} /> : null}
          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) ? <OrderTipCard orderId={order.id} actorRole="TAILOR" currency={order.quotedCurrency} onChanged={fetchOrder} /> : null}

          {showCancellationPolicyCard && cancellationReviewOpen && (
            <SupportDisclosure
              title="Cancellation and refund review"
              summary={cancellationReviewOpen ? 'Review open' : 'Policy and support options'}
              defaultExpanded={cancellationReviewOpen}
            >
              {cancellationReviewOpen ? (
                <>
                  <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                    <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>Review open</Text>
                  </View>
                  <Text style={styles.supportHint}>
                    Drapeon is reviewing whether this order should be cancelled before handoff. Keep all updates inside the order timeline.
                  </Text>
                  {cancellationReasonLabel ? (
                    <Text style={styles.supportBodyText}>Reason: {cancellationReasonLabel}</Text>
                  ) : null}
                  {cancellationReview?.note ? (
                    <Text style={styles.supportHint}>{cancellationReview.note}</Text>
                  ) : null}
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}</Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}</Text>
                  ) : null}
                </>
              ) : canRequestCancellationReview ? (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.tailorMessage}</Text>
                  {cancellationPolicy.refundableNow.length > 0 ? (
                    <Text style={styles.supportHint}>Likely refundable now: {refundCoverageLabel(cancellationPolicy.refundableNow)}</Text>
                  ) : null}
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}</Text>
                  ) : null}
                  <Button
                    label="Request cancellation review"
                    variant="secondary"
                    onPress={() => setShowCancellationReviewModal(true)}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>{cancellationPolicy.tailorMessage}</Text>
                  {cancellationPolicy.conditionalRefunds.length > 0 ? (
                    <Text style={styles.supportHint}>Case-by-case: {refundCoverageLabel(cancellationPolicy.conditionalRefunds)}</Text>
                  ) : null}
                </>
              )}
            </SupportDisclosure>
          )}

          {deliveryReviewOpen && (
            <SupportDisclosure
              title="Shipping & delivery help"
              summary={deliveryReviewOpen ? 'Review open' : 'Report a Drapeon fulfillment problem'}
              defaultExpanded={deliveryReviewOpen}
            >
              {deliveryReviewOpen ? (
                <>
                  <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                    <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>Review open</Text>
                  </View>
                  <Text style={styles.supportHint}>
                    Drapeon is reviewing this fulfillment issue. High-risk custody or damage reports pause the order; routine follow-up stays open without blocking progress.
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
                    Available after payment, including after completion. Report missed Drapeon collection, custody mismatch, handoff damage, or a parcel returned to you.
                  </Text>
                  <Button
                    label="Get shipping or delivery help"
                    variant="secondary"
                    onPress={() => setShowDeliveryReviewModal(true)}
                  />
                </>
              )}
            </SupportDisclosure>
          )}

          {(scopeChangeOpen || canRequestScopeChange) && (
            <View style={[styles.supportCard, scopeChangeOpen && styles.supportCardWarning]}>
              <Text style={styles.supportCardTitle}>
                {scopeChangeOpen ? 'Change request open' : 'Need to change the order?'}
              </Text>
              {scopeChangeOpen ? (
                <>
                  <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                    <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
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
                  {typeof scopeChange?.priceImpactMinor === 'number' && scopeChange.priceImpactMinor !== 0 ? (
                    <Text style={styles.supportHint}>
                      Price impact: {formatAmount(Math.abs(scopeChange.priceImpactMinor), order.quotedCurrency as CurrencyCode, order.quotedCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                    </Text>
                  ) : null}
                  {scopeChange?.deadlineImpact ? (
                    <Text style={styles.supportHint}>Deadline: {scopeChange.deadlineImpact}</Text>
                  ) : null}
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
                      label="Cancel proposal"
                      variant="ghost"
                      onPress={() => respondToScopeChange('CANCELLED')}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.supportHint}>
                    Use this for measurement amendments, style/reference alignment, fabric changes, added work, pause/restart, or rework. It keeps approval, price, and deadline impact inside Drapeon.
                  </Text>
                  <Button
                    label="Propose change"
                    variant="secondary"
                    onPress={() => setShowScopeChangeModal(true)}
                  />
                </>
              )}
            </View>
          )}

          {!isBeforeConfirmation && (measurementSource || fitConfidence || order.fabricSource === 'CUSTOMER_SUPPLIES' || fabricDescription || fabricApprovalStatus || materialIssue || (order.orderKind === 'CUSTOM' && PRE_CUTTING_STAGES.includes(order.stage))) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pre-cutting checks</Text>
              {cuttingBlockedLocally && order.orderKind === 'CUSTOM' && ['CONFIRMED', 'DESIGNING', 'SOURCING'].includes(order.stage) ? (
                <View style={styles.supportWarningCard}>
                  <Text style={styles.supportWarningTitle}>Cutting still has a blocker</Text>
                  <Text style={styles.supportWarningText}>{cuttingBlockerMessage ?? ''}</Text>
                  {fundedFabricCuttingBlocked && !fundedFabricAdvance ? (
                    <Button label="Request fabric release" variant="secondary" onPress={() => setShowMaterialAdvanceModal(true)} />
                  ) : fundedFabricCuttingBlocked && fundedFabricAdvance?.status === 'RELEASED' ? (
                    <Button label="Add final supplier proof" variant="secondary" onPress={() => setReconcilingMaterialAdvance(fundedFabricAdvance)} />
                  ) : null}
                </View>
              ) : null}

              {order.orderKind === 'CUSTOM' && PRE_CUTTING_STAGES.includes(order.stage) ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Fit protection checklist</Text>
                  <Text style={styles.supportHint}>
                    Before cutting, confirm the customer understands the fit direction, key measurements,
                    fabric choice, and deadline. Keep proof media and consultation notes in Drapeon so aftercare
                    has a clear record if the finished garment needs a remedy.
                  </Text>
                  <View style={styles.supportMetaList}>
                    <BriefRow label="Fit" value="Confirm silhouette, ease, and sensitive measurements" />
                    <BriefRow label="Material" value="Do not cut until fabric is approved or supplied" />
                    {styleAlignment?.requiredBeforeCutting ? (
                      <BriefRow
                        label="Style"
                        value={
                          styleAlignment.status === 'APPROVED'
                            ? 'Customer approved your interpretation before cutting'
                            : styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL'
                              ? 'Waiting on customer approval before cutting'
                              : styleAlignment.status === 'CHANGES_REQUESTED'
                                ? 'Customer asked for clarification before cutting'
                                : 'Confirm what can and cannot be matched from the references'
                        }
                      />
                    ) : null}
                    <BriefRow label="Proof" value="Use fresh stage photos or video for each production move" />
                  </View>
                  {styleAlignment?.requiredBeforeCutting &&
                  styleAlignment.status !== 'APPROVED' &&
                  styleAlignment.status !== 'NOT_REQUIRED' &&
                  !showTailorStyleDecisionCard ? (
                    <Button
                      label={
                        styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL'
                          ? 'Update style approval request'
                          : 'Request style approval'
                      }
                      variant="secondary"
                      onPress={() => setShowStyleAlignmentModal(true)}
                    />
                  ) : null}
                </View>
              ) : null}

              {(wearerLabel || measurementSource || fitConfidence || measurementAgeText || measurementConfirmationNeeded) && (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Measurement readiness</Text>
                  <View style={styles.supportMetaList}>
                    {wearerLabel ? <BriefRow label="Wearer" value={wearerLabel} /> : null}
                    {measurementSource ? (
                      <BriefRow
                        label="Source"
                        value={MEASUREMENT_SOURCE_LABELS[measurementSource] ?? String(measurementSource)}
                      />
                    ) : null}
                    {fitConfidence ? (
                      <BriefRow
                        label="Fit confidence"
                        value={FIT_CONFIDENCE_LABELS[fitConfidence] ?? String(fitConfidence)}
                      />
                    ) : null}
                    {measurementAgeText ? (
                      <BriefRow label="Last updated" value={measurementAgeText} />
                    ) : null}
                  </View>
                  {measurementAge?.stale ? (
                    <Text style={styles.supportWarningText}>
                      These measurements are over {STALE_MEASUREMENT_MONTHS} months old. Confirm
                      the customer still wants to use them before cutting.
                    </Text>
                  ) : null}
                  {measurementConfirmationNeeded ? (
                    <>
                      <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                        <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
                          Customer confirmation pending
                        </Text>
                      </View>
                      {order.measurements?.confirmationReason ? (
                        <Text style={styles.supportBodyText}>{order.measurements.confirmationReason}</Text>
                      ) : null}
                      {measurementConfirmationFields.length > 0 ? (
                        <View style={styles.measurementConfirmFieldWrap}>
                          {measurementConfirmationFields.map((field) => (
                            <View key={field} style={styles.measurementConfirmFieldChip}>
                              <Text style={styles.measurementConfirmFieldText}>{labelMeasurementField(field)}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </>
                  ) : PRE_CUTTING_STAGES.includes(order.stage) ? (
                    <>
                      <Text style={styles.supportHint}>
                        If anything looks off, ask the customer to confirm before you move into cutting.
                      </Text>
                      <Button
                        label="Request measurement confirmation"
                        variant="secondary"
                        onPress={() => setShowMeasurementRequestModal(true)}
                      />
                    </>
                  ) : null}
                </View>
              )}

              {fitProfile ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Fit notes</Text>
                  <View style={styles.supportMetaList}>
                    {fitProfile.status ? (
                      <BriefRow label="Status" value={formatMeasurementStatusLabel(fitProfile.status)} />
                    ) : null}
                    {fitProfile.fitIntent ? (
                      <BriefRow label="Fit direction" value={FIT_INTENT_LABELS[fitProfile.fitIntent]} />
                    ) : null}
                    {fitProfile.fabricStretch ? (
                      <BriefRow label="Stretch" value={FABRIC_STRETCH_LABELS[fitProfile.fabricStretch]} />
                    ) : null}
                    {fitProfile.wearDaySupport ? (
                      <BriefRow label="Support" value={WEAR_DAY_SUPPORT_LABELS[fitProfile.wearDaySupport]} />
                    ) : null}
                    {fitProfile.coveragePreference ? (
                      <BriefRow label="Coverage" value={COVERAGE_PREFERENCE_LABELS[fitProfile.coveragePreference]} />
                    ) : null}
                    {typeof fitProfile.heelHeightCm === 'number' ? (
                      <BriefRow label="Heel height" value={`${fitProfile.heelHeightCm} cm`} />
                    ) : null}
                  </View>
                  {fitProfile.styleEaseNotes ? <Text style={styles.supportHint}>{fitProfile.styleEaseNotes}</Text> : null}
                  {fitProfile.postureNote ? <Text style={styles.supportHint}>Posture: {fitProfile.postureNote}</Text> : null}
                  {fitProfile.asymmetryNote ? <Text style={styles.supportHint}>Asymmetry: {fitProfile.asymmetryNote}</Text> : null}
                  {fitProfile.tailorMeasurementOverrideReason ? (
                    <Text style={styles.supportHint}>Tailor review note: {fitProfile.tailorMeasurementOverrideReason}</Text>
                  ) : null}
                  {fitProfileReviewNeeded ? (
                    <>
                      <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                        <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
                          Tailor review required before cutting
                        </Text>
                      </View>
                      <Button
                        label="Confirm fit readiness"
                        variant="secondary"
                        onPress={() => setShowFitReadinessModal(true)}
                      />
                    </>
                  ) : fitProfile.tailorMeasurementOverride ? (
                    <View style={[styles.supportBadge, styles.supportBadgeSuccess]}>
                      <Text style={[styles.supportBadgeText, styles.supportBadgeTextSuccess]}>
                        Fit notes reviewed
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {!usesFabricFundingV2 && (order.fabricSource === 'CUSTOMER_SUPPLIES' || fabricHandoffLabel || fabricPolicy || materialIssue || fabricDescription || fabricApprovalStatus) && (
                <>
                {!showTailorFabricActionCard ? <SupportDisclosure
                  title={order.fabricSource === 'TAILOR_SOURCES' ? 'Fabric sourcing' : 'Fabric handoff'}
                  summary={
                    order.supportMeta.fabricReceivedAt
                      ? 'Received and recorded'
                      : fabricApprovalStatus ?? fabricHandoffLabel ?? 'Source and handoff details'
                  }
                  defaultExpanded={
                    canConfirmFabricReceived ||
                    waitingOnTailorSourcing ||
                    order.customDetail?.fabricApprovalStatus === 'PENDING_TAILOR_UPLOAD' ||
                    order.customDetail?.fabricApprovalStatus === 'CHANGES_REQUESTED'
                  }
                >
                  <View style={styles.supportMetaList}>
                    <BriefRow
                      label="Fabric source"
                      value={order.fabricSource === 'CUSTOMER_SUPPLIES' ? 'Customer supplies' : 'Tailor sources'}
                    />
                    {fabricHandoffLabel ? <BriefRow label="Handoff plan" value={fabricHandoffLabel} /> : null}
                    {fabricDescription ? <BriefRow label="Customer wants" value={fabricDescription} /> : null}
                    {fabricBudgetAmount != null ? (
                      <BriefRow
                        label="Fabric budget"
                        value={formatAmount(fabricBudgetAmount, fabricBudgetCurrency as CurrencyCode, fabricBudgetCurrency as CurrencyCode, STATIC_FALLBACK_RATES)}
                      />
                    ) : null}
                    {fabricSourcingDeadlineDays ? (
                      <BriefRow label="Sourcing update due" value={`${fabricSourcingDeadlineDays} business days`} />
                    ) : null}
                    {fabricApprovalStatus ? <BriefRow label="Approval status" value={fabricApprovalStatus} /> : null}
                    {order.supportMeta.fabricReceivedAt ? (
                      <BriefRow
                        label="Received"
                        value={new Date(order.supportMeta.fabricReceivedAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      />
                    ) : null}
                  </View>
                  {order.supportMeta.fabricReceivedNote ? (
                    <Text style={styles.supportHint}>{order.supportMeta.fabricReceivedNote}</Text>
                  ) : null}
                  {!order.supportMeta.fabricReceivedAt && order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                    <Text style={styles.supportHint}>
                      Ask the customer to keep dropoff photos, courier tracking, or receipt proof in this order thread before you confirm fabric receipt.
                    </Text>
                  ) : null}
                  {order.fabricSource === 'TAILOR_SOURCES' &&
                  order.customDetail?.fabricApprovalStatus !== 'APPROVED' ? (
                    <Text style={styles.supportHint}>
                      {canSubmitTailorFabricApproval({ orderKind: order.orderKind, fabricSource: order.fabricSource, stage: order.stage })
                        ? "Submit the exact fabric for the customer's approval before cutting. Use natural light and show the weave and texture clearly."
                        : 'Review this fabric request while pricing the quote. Fabric proof unlocks only after the quote is accepted and payment is confirmed.'}
                    </Text>
                  ) : null}
                  {order.fabricSource === 'TAILOR_SOURCES' &&
                  canSubmitTailorFabricApproval({ orderKind: order.orderKind, fabricSource: order.fabricSource, stage: order.stage }) &&
                  (order.customDetail?.fabricApprovalStatus === 'PENDING_TAILOR_UPLOAD' ||
                    order.customDetail?.fabricApprovalStatus === 'CHANGES_REQUESTED') ? (
                    <Button
                      label={
                        order.customDetail.fabricApprovalStatus === 'CHANGES_REQUESTED'
                          ? 'Upload replacement fabric'
                          : 'Upload sourced fabric'
                      }
                      onPress={() => openStageModal('SOURCING', 'FABRIC_APPROVAL')}
                    />
                  ) : null}
                  {waitingOnTailorSourcing ? (
                    <View style={[styles.supportBadge, styles.supportBadgeSuccess]}>
                      <Text style={[styles.supportBadgeText, styles.supportBadgeTextSuccess]}>
                        Customer approved tailor sourcing
                      </Text>
                    </View>
                  ) : null}
                  {canConfirmFabricReceived ? (
                    <Button
                      label="Confirm fabric received"
                      variant="secondary"
                      onPress={confirmFabricReceived}
                      loading={confirmingFabricReceived}
                      disabled={confirmingFabricReceived}
                    />
                  ) : null}
                </SupportDisclosure> : null}
                {fabricPolicy ? (
                  <SupportDisclosure
                    title="Fabric rules and exceptions"
                    summary="Preparation, rejection, late fabric, replacements, and disputes"
                    defaultExpanded={false}
                  >
                    {fabricPolicy.rejectionReasons && fabricPolicy.rejectionReasons.length > 0 ? (
                      <Text style={styles.supportHint}>
                        Reject before cutting only for: {fabricPolicy.rejectionReasons.join(' · ')}
                      </Text>
                    ) : null}
                    {fabricPolicy.prepRequirements && fabricPolicy.prepRequirements.length > 0 ? (
                      <Text style={styles.supportHint}>
                        Preparation: {fabricPolicy.prepRequirements.join(' · ')}
                      </Text>
                    ) : null}
                    {fabricPolicy.lateFabricRule ? (
                      <Text style={styles.supportHint}>If fabric is late: {fabricPolicy.lateFabricRule}</Text>
                    ) : null}
                    {fabricPolicy.missingFabricRule ? (
                      <Text style={styles.supportHint}>If fabric never arrives: {fabricPolicy.missingFabricRule}</Text>
                    ) : null}
                    {fabricPolicy.replacementRule ? (
                      <Text style={styles.supportHint}>Replacement: {fabricPolicy.replacementRule}</Text>
                    ) : null}
                    {fabricPolicy.disagreementRule ? (
                      <Text style={styles.supportHint}>If suitability is disputed: {fabricPolicy.disagreementRule}</Text>
                    ) : null}
                  </SupportDisclosure>
                ) : null}
                </>
              )}

              {order.orderKind === 'CUSTOM' && materialIssue ? (
                <View style={[styles.supportCard, materialIssueOpen && styles.supportCardWarning]}>
                  <Text style={styles.supportCardTitle}>Material issue</Text>
                  {materialIssueReasonLabel ? <BriefRow label="Issue" value={materialIssueReasonLabel} /> : null}
                  {materialIssue.note ? <Text style={styles.supportBodyText}>{materialIssue.note}</Text> : null}
                  {materialIssueNeedsCustomerDecision ? (
                    <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                      <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
                        Waiting on the customer
                      </Text>
                    </View>
                  ) : materialIssueCancellationRequested ? (
                    <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                      <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
                        Customer requested cancellation review
                      </Text>
                    </View>
                  ) : materialIssueResponseLabel ? (
                    <BriefRow label="Customer response" value={materialIssueResponseLabel} />
                  ) : null}
                  {materialIssue.responseNote ? <Text style={styles.supportHint}>{materialIssue.responseNote}</Text> : null}
                  {PRE_CUTTING_STAGES.includes(order.stage) && !materialIssueOpen ? (
                    <Button
                      label="Open material issue"
                      variant="secondary"
                      onPress={() => setShowMaterialIssueModal(true)}
                    />
                  ) : null}
                </View>
              ) : order.orderKind === 'CUSTOM' && PRE_CUTTING_STAGES.includes(order.stage) && order.fabricSource === 'CUSTOMER_SUPPLIES' ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>Material issue</Text>
                  <Text style={styles.supportHint}>
                    If the customer fabric is unsuitable before cutting, open a material issue instead of moving the order forward blindly.
                  </Text>
                  <Button
                    label="Open material issue"
                    variant="secondary"
                    onPress={() => setShowMaterialIssueModal(true)}
                  />
                </View>
              ) : null}

              {order.orderKind === 'CUSTOM' && !usesFabricFundingV2 ? (
                <View style={styles.supportCard}>
                  <Text style={styles.supportCardTitle}>
                    {order.fabricFundingPolicyVersion === 'fabric-funding-2026-08-01-v1' ? 'Fabric allowance' : 'Material advance'}
                  </Text>
                  <Text style={styles.supportHint}>
                    {order.fabricFundingPolicyVersion === 'fabric-funding-2026-08-01-v1'
                      ? `Request the exact supported cost from the allowance already paid at checkout. Customer approval does not charge them again.${fabricFundingBalance ? ` ${formatAmount(Math.max(fabricFundingBalance.fundedAmount - fabricFundingBalance.releasedAmount - fabricFundingBalance.refundedAmount, 0), fabricFundingBalance.currency, fabricFundingBalance.currency, STATIC_FALLBACK_RATES)} remains protected.` : ''}`
                      : 'Use this only when the customer needs to approve and pay for a specific fabric, embroidery, lining, or order material. Drapeon never releases the main order funds early.'}
                  </Text>
                  {materialAdvances.length > 0 ? (
                    <View style={styles.supportMetaList}>
                      {materialAdvances.map((advance) => {
                        const amountLabel = formatAmount(
                          advance.amount,
                          advance.currency,
                          advance.currency,
                          STATIC_FALLBACK_RATES
                        )
                        const receiptNeeded = advance.status === 'RELEASED' && !advance.reconciledAt
                        const reconciliationCopy = materialReconciliationCopy({
                          outcome: advance.reconciliationOutcome,
                          resolution: advance.reconciliationResolution,
                          customerRefundAmount: advance.customerRefundAmount,
                          unapprovedOverageAmount: advance.unapprovedOverageAmount,
                          actorRole: 'TAILOR',
                        })
                        return (
                          <View key={advance.id} style={styles.advanceRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.advanceTitle}>{advance.title}</Text>
                              <Text style={styles.supportHint}>
                                {amountLabel} · {formatMaterialAdvanceStatusLabel(advance.status, 'tailor')}
                              </Text>
                              {advance.description ? (
                                <Text style={styles.supportBodyText}>{advance.description}</Text>
                              ) : null}
                              {advance.status === 'DECLINED' ? (
                                <View style={[styles.supportBadge, styles.supportBadgeWarning]}>
                                  <Text style={[styles.supportBadgeText, styles.supportBadgeTextWarning]}>
                                    Customer declined · {materialAdvanceDeclineReasonLabel(advance.customerResponseReason) ?? 'Reason not specified'}
                                  </Text>
                                </View>
                              ) : null}
                              {advance.customerResponseNote ? (
                                <Text style={styles.supportHint}>{advance.customerResponseNote}</Text>
                              ) : null}
                              {advance.receiptUrl ? (
                                <Text style={styles.supportHint}>
                                  Receipt reconciled{advance.actualSpent != null ? ` · ${formatAmount(advance.actualSpent, advance.currency, advance.currency, STATIC_FALLBACK_RATES)} spent` : ''}.
                                </Text>
                              ) : null}
                              {reconciliationCopy ? (
                                <View style={[styles.supportBadge, reconciliationCopy.tone === 'success' ? styles.supportBadgeSuccess : styles.supportBadgeWarning]}>
                                  <Text style={styles.supportBadgeText}>{reconciliationCopy.title}</Text>
                                  <Text style={styles.supportHint}>{reconciliationCopy.body}</Text>
                                  {advance.customerRefundAmount > 0 ? <Text style={styles.supportBadgeText}>Customer refund: {formatAmount(advance.customerRefundAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                                  {advance.unapprovedOverageAmount > 0 ? <Text style={styles.supportBadgeText}>You absorb: {formatAmount(advance.unapprovedOverageAmount, advance.currency, advance.currency, STATIC_FALLBACK_RATES)}</Text> : null}
                                </View>
                              ) : null}
                              {advance.receiptStoragePath || advance.acquiredStoragePath ? (
                                <View style={styles.advanceEvidenceActions}>
                                  {advance.receiptStoragePath ? <Button label="View receipt" variant="secondary" onPress={() => { void openMaterialEvidence(advance, 'receipt') }} /> : null}
                                  {advance.acquiredStoragePath ? <Button label="View acquired fabric" variant="secondary" onPress={() => { void openMaterialEvidence(advance, 'acquired') }} /> : null}
                                </View>
                              ) : null}
                            </View>
                            {receiptNeeded ? (
                              <Button
                                label="Receipt"
                                variant="secondary"
                                onPress={() => setReconcilingMaterialAdvance(advance)}
                              />
                            ) : null}
                          </View>
                        )
                      })}
                    </View>
                  ) : null}
                  {!hasActiveMaterialAdvance ? (
                    <Button
                      label={order.fabricFundingPolicyVersion === 'fabric-funding-2026-08-01-v1' ? 'Request fabric release' : 'Request material advance'}
                      variant="secondary"
                      onPress={() => setShowMaterialAdvanceModal(true)}
                    />
                  ) : (
                    <Text style={styles.supportHint}>
                      Finish or resolve the open material advance before requesting another one.
                    </Text>
                  )}
                </View>
              ) : null}
            </View>
          )}

          {hasMeasurementContent(order.measurements) ? (
            <View style={styles.section}>
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>Measurement profile</Text>
          <Text style={styles.supportHint}>Fit context, flags, and garment-specific values.</Text>
                <Button
                  label="Review measurements"
                  variant="secondary"
                  onPress={() => setShowMeasurementSheet(true)}
                />
              </View>
            </View>
          ) : null}

          {/* Brief details */}
          <View style={styles.section}>
            <View style={styles.supportCard}>
              <Text style={styles.supportCardTitle}>{briefDossier.title}</Text>
        <Text style={styles.supportHint}>
          {briefDossier.sections.length === 0
            ? 'No dossier details yet.'
            : studioVersion
              ? `Sketch Room design · version ${studioVersion.version} · current sheet and directions inside.`
              : `${briefDossier.sections.length} ${briefDossier.sections.length === 1 ? 'section' : 'sections'} · Style, fabric, fulfillment, and proof.`}
        </Text>
              <Button
                label="Open brief dossier"
                variant="secondary"
                onPress={() => setShowDossierSheet(true)}
              />
              {studioVersion && ['PENDING_QUOTE', 'CONSULTATION', 'QUOTE_SENT', 'PAYMENT_PENDING', 'CONFIRMED', 'DESIGNING', 'SOURCING'].includes(order.stage ?? '') ? (
                <Button
                  label={`Work from customer Sketch Room design · version ${studioVersion.version}`}
                  variant="secondary"
                  onPress={() => resetTo(router, { pathname: '/studio', params: { returnTo: `/(tailor)/orders/${order.id}`, orderReference: order.id } } as never)}
                />
              ) : null}
            </View>

            {handoffHelpAvailable ? (
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>{handoffHelpCardTitle('TAILOR', order.deliveryMethod)}</Text>
                <Text style={styles.supportHint}>{handoffHelpCardBody('TAILOR', order.deliveryMethod)}</Text>
                {handoffIssue ? (
                  <View style={styles.handoffIssueCard}>
                    <View style={styles.handoffIssueHeader}>
                      <Text style={styles.handoffIssueTitle}>{handoffIssueLabel(handoffIssue.issueType)}</Text>
                      <View
                        style={[
                          styles.handoffStatusPill,
                          handoffIssue.status === 'ESCALATED' && styles.handoffStatusPillEscalated,
                        ]}
                      >
                        <Text style={styles.handoffStatusText}>{handoffIssueStatusLabel(handoffIssue.status)}</Text>
                      </View>
                    </View>
                    {handoffIssue.description ? <Text style={styles.supportHint}>{handoffIssue.description}</Text> : null}
                    <Text style={styles.supportHint}>
                      {handoffIssue.status === 'ESCALATED'
                        ? 'Drapeon support has been flagged for follow-up. Keep all updates in this order thread.'
                        : 'This handoff help thread is open inside Drapeon. Keep all updates here so the timeline stays clear.'}
                    </Text>
                    <Button
                      label="Mark help resolved"
                      variant="secondary"
                      onPress={() => { void markHandoffIssueResolved() }}
                      loading={resolvingHandoffIssue}
                      disabled={resolvingHandoffIssue}
                    />
                  </View>
                ) : null}
                <View style={{ gap: Spacing.md }}>
                  <Button
                    label="Message customer"
                    variant="secondary"
                    onPress={openOrderMessages}
                  />
                  <Button
                    label={handoffIssue ? 'Log another help issue' : 'Log handoff help'}
                    variant="secondary"
                    onPress={() => setShowHandoffSupport(true)}
                  />
                </View>
              </View>
            ) : null}
          </View>

          {(!deliveryReviewOpen && canRequestDeliveryReview) ||
          (!cancellationReviewOpen && showCancellationPolicyCard) ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Help &amp; order options</Text>
              {!deliveryReviewOpen && canRequestDeliveryReview ? (
                <SupportDisclosure
                  title="Shipping & delivery help"
                  summary="Drapeon collection, custody, damage, or returned-parcel support"
                  defaultExpanded={false}
                >
                  <Text style={styles.supportHint}>
                    Available after payment, including after completion. Report a missed Drapeon
                    collection, custody mismatch, handoff damage, or a parcel returned to you.
                  </Text>
                  <Button
                    label="Get shipping or delivery help"
                    variant="secondary"
                    onPress={() => setShowDeliveryReviewModal(true)}
                  />
                </SupportDisclosure>
              ) : null}
              {!cancellationReviewOpen && showCancellationPolicyCard ? (
                <SupportDisclosure
                  title="Cancellation and refund review"
                  summary="Policy and reviewed cancellation options"
                  defaultExpanded={false}
                >
                  <Text style={styles.supportHint}>{cancellationPolicy.tailorMessage}</Text>
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
                  {canRequestCancellationReview ? (
                    <Button
                      label="Request cancellation review"
                      variant="secondary"
                      onPress={() => setShowCancellationReviewModal(true)}
                    />
                  ) : null}
                </SupportDisclosure>
              ) : null}
            </View>
          ) : null}

          {/* Reference photos */}
          {visibleReferencePhotos.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reference photos</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: Spacing.md }}>
                  {referenceMediaItems.map((item, index, items) => (
                    <TouchableOpacity
                      key={item.uri}
                      onPress={() => openMediaPreview(items, index)}
                      activeOpacity={0.9}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Open ${item.label}`}
                    >
                      <RemoteImage
                        uri={item.uri}
                        bucket="order-photos"
                        style={styles.refPhoto}
                        contentFit="contain"
                        transition={120}
                        surface="tailor_order_reference_photo"
                        onLoadError={() => {
                          setFailedReferencePhotos((prev) => prev.includes(item.uri) ? prev : [...prev, item.uri])
                        }}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

        {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Aftercare</Text>
            <SupportDisclosure
              title="Post-handoff expectations"
              summary="Fit, finish, alteration, and remedy guidance"
              defaultExpanded={false}
            >
              <Text style={styles.supportBodyText}>
                Keep fit, finish, alteration, remake, and workmanship follow-up inside Drapeon. Answer clear issues
                quickly and keep remedies tied to the order timeline so support can help when needed.
              </Text>
            </SupportDisclosure>
          </View>
        )}

          {['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Next step</Text>
              <View style={styles.supportCard}>
                <Text style={styles.supportCardTitle}>
                  {hasCustomerReview ? 'Customer review saved' : 'Review this customer'}
                </Text>
                <Text style={styles.supportHint}>
                  {hasCustomerReview
                    ? 'Your internal customer review is already saved. You can head back to Orders or keep this record for future reference.'
                    : 'Leave an internal customer review so future work has better context. This stays inside Drapeon and is not public.'}
                </Text>
                {!hasCustomerReview ? (
                  <Button
                    label="Review customer"
                    onPress={() => { void openCustomerReview() }}
                  />
                ) : null}
                <Button
                  label="Back to orders"
                  variant="secondary"
                  onPress={() => router.replace('/(tailor)/orders')}
                />
              </View>
            </View>
          )}

        </View>
      </ScrollView>

      <HandoffSupportModal
        visible={showHandoffSupport}
        orderId={order.id}
        role="TAILOR"
        deliveryMethod={order.deliveryMethod}
        onClose={() => setShowHandoffSupport(false)}
        onSubmitted={() => {
          setShowHandoffSupport(false)
          void fetchOrder()
        }}
      />

      <BottomSheetScaffold
        visible={showDossierSheet}
      testID="tailor-dossier-sheet"
      title={briefDossier.title}
      subtitle="Open only the section you need."
        onDismiss={() => setShowDossierSheet(false)}
        scrollable
      >
        <View style={styles.sheetSectionStack}>
          {briefDossier.sections.map((section) => (
          <BriefDossierCard
            key={section.id}
            section={section}
            onOpenLink={openDossierLink}
            onOpenMedia={openMediaPreview}
          defaultExpanded={section.id === 'summary' || (Boolean(studioVersion) && section.id === 'style_refs')}
          />
          ))}
        </View>
      </BottomSheetScaffold>

      <DrapeMediaViewer
        items={mediaPreview?.items ?? []}
        activeIndex={mediaPreview?.index ?? null}
        onDismiss={() => setMediaPreview(null)}
        testID="order-dossier-media-viewer"
      />

      <BottomSheetScaffold
        visible={showMeasurementSheet}
      testID="tailor-measurement-sheet"
      title="Measurement profile"
      subtitle="Fit context and production-ready measurements."
        onDismiss={() => setShowMeasurementSheet(false)}
        scrollable
      >
        {hasMeasurementContent(order.measurements) ? (
          <View style={styles.sheetSectionStack}>
            <BodyProfileCard measurements={order.measurements} />
            <MeasurementsSection measurements={order.measurements} />
            {measurementConfirmationNeeded ? (
              <Button
                label="Request measurement confirmation"
                variant="secondary"
                onPress={() => {
                  setShowMeasurementSheet(false)
                  setShowMeasurementRequestModal(true)
                }}
              />
            ) : null}
            {fitProfileReviewNeeded ? (
              <Button
                label="Confirm fit and cutting readiness"
                variant="secondary"
                onPress={() => {
                  setShowMeasurementSheet(false)
                  setShowFitReadinessModal(true)
                }}
              />
            ) : null}
          </View>
        ) : (
          <Text style={styles.supportHint}>No measurement profile is attached to this order yet.</Text>
        )}
      </BottomSheetScaffold>

      <BottomSheetScaffold
        visible={showFlexibleStageSheet}
        title="Choose next stage"
        subtitle={order.orderKind === 'READY_MADE'
          ? 'Move this item through its real handoff state.'
          : 'Design, fabric, and production can move in a flexible order. Pick the true next step.'}
        onDismiss={() => setShowFlexibleStageSheet(false)}
        scrollable
        snapPoints={['68%']}
      >
        <View style={styles.stageChoiceList}>
          {flexibleNextStages?.map((target) => (
            <SelectableSettingRow
              key={target}
              label={displayStageChoiceLabel(target, order.orderKind)}
              detail={stageChoiceDetail(target, order.orderKind)}
              active={false}
              onPress={() => {
                setShowFlexibleStageSheet(false)
                void openStageModal(target)
              }}
            />
          ))}
        </View>
      </BottomSheetScaffold>

      {/* Quote modal */}
      {showQuoteModal ? (
        <QuoteModal
          key={`quote-${order.id}-${quoteModalMode}-${order.activeQuoteVersion ?? 0}`}
          visible
          orderId={order.id}
          mode={quoteModalMode}
          quoteId={order.activeQuoteId}
          expectedQuoteVersion={order.activeQuoteVersion}
          revisionRequestId={openQuoteRevision?.id ?? null}
          initialAmount={quoteModalMode === 'revise' ? baseAmount(order) : null}
          initialTailoringAmount={quoteModalMode === 'revise' ? order.supportMeta.quoteBreakdown?.tailoringAmount ?? null : null}
          initialFabricAllowanceAmount={quoteModalMode === 'revise' ? order.supportMeta.quoteBreakdown?.fabricAllowanceAmount ?? null : null}
          initialFabricCoverage={quoteModalMode === 'revise' ? order.supportMeta.quoteBreakdown?.fabricAllowanceCoverage ?? [] : []}
          initialFabricAssumptions={quoteModalMode === 'revise' ? order.supportMeta.quoteBreakdown?.fabricSourcingAssumptions ?? '' : ''}
          initialCompletionDate={quoteModalMode === 'revise' ? order.quotedCompletionDate : null}
          defaultCurrency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
          deliveryMethod={order.deliveryMethod}
          fabricSource={order.fabricSource}
          fabricFundingPolicyVersion={order.fabricFundingPolicyVersion}
          customerDeadline={order.deadline}
          onClose={() => setShowQuoteModal(false)}
          onSent={() => { setShowQuoteModal(false); fetchOrder() }}
        />
      ) : null}

      <DrapeSheet
        visible={showFabricChangeFeedback}
        title="Requested fabric changes"
        subtitle="Customer feedback"
        onDismiss={() => setShowFabricChangeFeedback(false)}
        scrollable
        snapPoints={['44%']}
        enableDynamicSizing={false}
      >
        <View style={styles.fabricChangeFeedbackSheet}>
          <Text style={styles.fabricChangeFeedbackBody}>
            {decodeDisplayText(fabricChangeFeedback?.feedback ?? '')}
          </Text>
        </View>
      </DrapeSheet>

      <DrapeSheet
        visible={showStyleChangeFeedback}
        title="Requested style clarification"
        subtitle="Customer feedback"
        onDismiss={() => setShowStyleChangeFeedback(false)}
        scrollable
        snapPoints={['44%']}
        enableDynamicSizing={false}
      >
        <View style={styles.fabricChangeFeedbackSheet}>
          <Text style={styles.fabricChangeFeedbackBody}>
            {decodeDisplayText(styleChangeFeedback?.feedback ?? '')}
          </Text>
        </View>
      </DrapeSheet>

      <DrapeSheet
        visible={showRevisionResponseSheet}
        title="Respond to quote changes"
        subtitle={openQuoteRevision
          ? `Revision ${openQuoteRevision.roundNumber} of ${order.negotiationRoundLimit}`
          : undefined}
        onDismiss={() => setShowRevisionResponseSheet(false)}
        scrollable
        snapPoints={['48%']}
        enableDynamicSizing={false}
        primaryAction={{
          label: 'Keep current quote',
          loading: revisionResponseSaving,
          disabled: revisionResponseSaving,
          onPress: () => { void respondToQuoteRevision('keep-current-quote') },
          tone: 'primary',
        }}
        destructiveAction={{
          label: 'Decline order',
          disabled: revisionResponseSaving,
          onPress: () => { void respondToQuoteRevision('decline-after-revision') },
          tone: 'destructive',
        }}
      >
        <View style={styles.stageChoiceList}>
          <Text style={styles.supportHint}>
            Keep the current quote only when its price, scope, and date still cover the requested changes. The customer will receive a formal event either way.
          </Text>
        </View>
      </DrapeSheet>

      {/* Stage update modal */}
      {showStageModal && stageModalTarget ? (
        <StageUpdateModal
          key={`stage-${order.id}-${stageModalTarget}-${stageModalPurpose}`}
          visible
          order={order}
          targetStage={stageModalTarget}
          submissionPurpose={stageModalPurpose}
          onClose={() => setShowStageModal(false)}
          onUpdated={async (updatedStage) => {
            setShowStageModal(false)
            await fetchOrder()
            if (stageModalPurpose === 'STAGE_PROGRESS' && updatedStage === 'FINISHING' && order.deliveryMethod !== 'LOCAL_COLLECTION') {
              Alert.alert(
                'Preparing order',
                'Keep packing and checking this order. When it is truly ready, come back here and mark it ready for Drapeon dispatch.',
              )
            } else if (stageModalPurpose === 'FABRIC_APPROVAL') {
              Alert.alert('Fabric sent', 'The customer can now review the exact fabric. You will be notified when they approve it or request changes.')
            } else if (stageModalPurpose === 'STAGE_PROGRESS') {
              Alert.alert('Update posted', 'The production update is now visible in the order history.')
            } else {
              Alert.alert('Stage updated', `This order is now ${tailorOrderStageLabel(updatedStage, order.orderKind).toLowerCase()}.`)
            }
          }}
        />
      ) : null}

      {/* Consultation modal */}
      {showConsultationModal ? (
        <ConsultationModal
          key={`consultation-${order.id}-${consultationModalAction}`}
          visible
          orderId={order.id}
          tailorProfileId={order.tailorProfileId}
          action={consultationModalAction}
          defaultCurrency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
          initialCallType={consultationMeta?.callType ?? null}
          onClose={() => setShowConsultationModal(false)}
          onSent={() => { setShowConsultationModal(false); fetchOrder() }}
        />
      ) : null}

      {showMeasurementRequestModal ? (
        <MeasurementConfirmationRequestModal
          key={`measurements-${order.id}`}
          visible
          orderId={order.id}
          measurements={order.measurements}
          onClose={() => setShowMeasurementRequestModal(false)}
          onSent={() => {
            setShowMeasurementRequestModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showFitReadinessModal ? (
        <FitReadinessModal
          key={`fit-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowFitReadinessModal(false)}
          onSent={() => {
            setShowFitReadinessModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showStyleAlignmentModal ? (
        <StyleAlignmentRequestModal
          key={`style-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowStyleAlignmentModal(false)}
          onSent={() => {
            setShowStyleAlignmentModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showMaterialIssueModal ? (
        <MaterialIssueModal
          key={`material-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowMaterialIssueModal(false)}
          onSent={() => {
            setShowMaterialIssueModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showMaterialAdvanceModal ? (
        <MaterialAdvanceRequestModal
          key={`material-advance-${order.id}`}
          visible
          orderId={order.id}
          currency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
          fundedFabric={order.fabricFundingPolicyVersion === 'fabric-funding-2026-08-01-v1'}
          remainingAmount={fabricFundingBalance ? Math.max(fabricFundingBalance.fundedAmount - fabricFundingBalance.releasedAmount - fabricFundingBalance.refundedAmount, 0) : null}
          onClose={() => setShowMaterialAdvanceModal(false)}
          onSent={() => {
            setShowMaterialAdvanceModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {reconcilingMaterialAdvance ? (
        <MaterialAdvanceReceiptModal
          key={`material-receipt-${reconcilingMaterialAdvance.id}`}
          visible
          orderId={order.id}
          advance={reconcilingMaterialAdvance}
          onClose={() => setReconcilingMaterialAdvance(null)}
          onSaved={() => {
            setReconcilingMaterialAdvance(null)
            void fetchOrder()
          }}
        />
      ) : null}

      {showCancellationReviewModal ? (
        <CancellationReviewRequestModal
          key={`cancel-review-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowCancellationReviewModal(false)}
          onSent={() => {
            setShowCancellationReviewModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showDeliveryReviewModal ? (
        <DeliveryReviewRequestModal
          key={`delivery-review-${order.id}`}
          visible
          orderId={order.id}
          onClose={() => setShowDeliveryReviewModal(false)}
          onSent={() => {
            setShowDeliveryReviewModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {showScopeChangeModal ? (
        <ScopeChangeRequestModal
          key={`scope-change-${order.id}`}
          visible
          orderId={order.id}
          currency={(order.quotedCurrency as CurrencyCode) ?? 'USD'}
          onClose={() => setShowScopeChangeModal(false)}
          onSent={() => {
            setShowScopeChangeModal(false)
            void fetchOrder()
          }}
        />
      ) : null}

      {/* Collection code modal */}
      {showCodeModal && pickupCredentialActive ? (
        <CollectionCodeModal
          key={`code-${order.id}-${order.collectionCode ?? ''}`}
          visible
          orderId={order.id}
          onClose={() => setShowCodeModal(false)}
          onConfirmed={async () => {
            setShowCodeModal(false)
            await fetchOrder()
            Alert.alert(
              'Collection confirmed',
              hasCustomerReview
                ? 'Pickup is complete. The customer can finish the order in Drapeon now.'
                : 'Pickup is complete. You can review this customer next or head back to Orders.',
              hasCustomerReview
                ? [
                    { text: 'Stay here', style: 'cancel' },
                    { text: 'Back to orders', onPress: () => router.replace('/(tailor)/orders') },
                  ]
                : [
                    { text: 'Back to orders', style: 'cancel', onPress: () => router.replace('/(tailor)/orders') },
                    { text: 'Review customer', onPress: () => { void openCustomerReview() } },
                  ],
            )
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}

// ─── Body Profile Card ────────────────────────────────────────────────────────

function BodyProfileCard({ measurements: m }: { measurements: Measurement }) {
  const bodyShapes = asStringList(m.bodyShape)
  const fitFlags = asStringList(m.fitFlags)

  return (
    <View style={styles.bodyCard}>
      <Text style={styles.bodyCardTitle}>Body profile</Text>
      <View style={styles.bodyCardRow}>
        {m.garmentContext && (
          <BodyRow label="Cut context" value={GARMENT_CONTEXT_LABELS[m.garmentContext] ?? m.garmentContext} />
        )}
        {bodyShapes.length > 0 && (
          <BodyRow
            label="Shape"
            value={bodyShapes.map((shape) => BODY_SHAPE_LABELS[shape] ?? shape).join(', ')}
          />
        )}
      </View>
      {fitFlags.length > 0 && (
        <View style={styles.fitFlagsRow}>
          {fitFlags.map((f) => (
            <View key={f} style={styles.fitFlagBadge}>
              <Text style={styles.fitFlagText}>{labelFitContextFlag(f)}</Text>
            </View>
          ))}
        </View>
      )}
      {m.bodyNote && (
        <View style={styles.bodyNote}>
          <Text style={styles.bodyNoteText}>"{m.bodyNote}"</Text>
        </View>
      )}
    </View>
  )
}

function BodyRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', flex: 1 }}>
      <Text style={{ fontSize: FontSize.xs, color: Colors.midGrey }}>{label}</Text>
      <Text style={{ fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.ink }}>{decodeDisplayText(value)}</Text>
    </View>
  )
}

// ─── Measurements Section ─────────────────────────────────────────────────────

function MeasurementsSection({ measurements: m }: { measurements: Measurement }) {
  const additionalRows = getAdditionalMeasurementRows(m)
  const rows = [
    { label: 'Chest', value: m.chest }, { label: 'Waist', value: m.waist },
    { label: 'Hips', value: m.hips }, { label: 'Shoulders', value: m.shoulderWidth },
    { label: 'Inseam', value: m.inseam }, { label: 'Sleeve', value: m.sleeveLength },
    { label: 'Neck', value: m.neckCircumference }, { label: 'Height', value: m.height },
    { label: 'Back length', value: m.backLength }, { label: 'Outseam', value: m.outseam },
    { label: 'Thigh', value: m.thighCircumference }, { label: 'Knee', value: m.kneeCircumference },
    { label: 'Torso', value: m.torsoLength },
  ]
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Measurements {m.fitStyle && <Text style={styles.fitStyleTag}>· {m.fitStyle} fit</Text>}</Text>
      <View style={styles.measureGrid}>
        {rows.map(({ label, value }) => (
          <View key={label} style={styles.measureItem}>
            <Text style={styles.measureLabel}>{label}</Text>
            <Text style={[styles.measureValue, !value && { color: Colors.lightGrey }]}>
              {value ? `${value} ${m.unit}` : 'Not added'}
            </Text>
          </View>
        ))}
      </View>
      {additionalRows.length > 0 ? (
        <View style={styles.additionalMeasureBlock}>
          <Text style={styles.additionalMeasureTitle}>Garment-specific measurements</Text>
          <View style={styles.measureGrid}>
            {additionalRows.map(({ label, value }) => (
              <View key={label} style={styles.measureItem}>
                <Text style={styles.measureLabel}>{label}</Text>
                <Text style={styles.measureValue}>{String(value)} {m.unit}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function hasMeasurementContent(measurements: Measurement | null): measurements is Measurement {
  if (!measurements) return false

  const numericFields = [
    measurements.chest,
    measurements.waist,
    measurements.hips,
    measurements.shoulderWidth,
    measurements.inseam,
    measurements.sleeveLength,
    measurements.neckCircumference,
    measurements.height,
    measurements.backLength,
    measurements.outseam,
    measurements.thighCircumference,
    measurements.kneeCircumference,
    measurements.torsoLength,
  ]

  if (numericFields.some((value) => typeof value === 'number' && Number.isFinite(value))) return true
  if (typeof measurements.fitStyle === 'string' && measurements.fitStyle.trim().length > 0) return true
  if (typeof measurements.garmentContext === 'string' && measurements.garmentContext.trim().length > 0) return true
  if (asStringList(measurements.bodyShape).length > 0) return true
  if (asStringList(measurements.fitFlags).length > 0) return true
  if (typeof measurements.bodyNote === 'string' && measurements.bodyNote.trim().length > 0) return true
  if (getAdditionalMeasurementRows(measurements).length > 0) return true

  return false
}
