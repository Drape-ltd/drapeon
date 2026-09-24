'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCheck, ChevronRight, X } from 'lucide-react'
import { MoneyInput } from '../../../components/money-input'
import { friendlyActionError } from '@drape/shared/action-errors'
import { deriveCancellationPolicy, latestFabricApprovalEvidence, sourcedFabricChangeFeedbackFromUpdates, styleAlignmentChangeFeedbackFromUpdates, normalizeAccountCurrency, formatMoney, parseDateValue, QUOTE_ORDER_REVIEW_COPY, QUOTE_ORDER_REVIEW_VERSION, TAILOR_QUOTE_DRAFT_VERSION, canSubmitTailorFabricApproval, formatMoneyInputValue, isMeaningfulTailorQuoteDraft, parseMoneyInputToMinorUnits, taxSnapshotNeedsRefresh, AccountCurrencyCode, TailorQuoteDraftFields, isCompletedOrderStage } from '@drape/shared'
import { recommendedSchedulingStartDate } from '@drape/shared/call-scheduling-policy'
import { ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES, MEDIA_LIMITS_BYTES, MEDIA_LIMITS_SECONDS, MEDIA_CACHE_CONTROL_SECONDS, isVideoMediaUrl } from '@drape/shared/media-policy'
import { canTransition, OrderStage } from '@drape/shared/order-machine'
import { createClient } from '../../../lib/supabase'
import { safeUserText } from '../../../lib/safe-display'
import type { AccountOrder, OrderActorData, OrderDetailRenderData, ProductionEvidence, StageUpdate } from '../shared/account-data-contracts'
import { invokeAccountFunction, stringList } from '../shared/account-data-queries'
import { ActionNotice, DisclosurePanel, MediaViewerOverlay, MutedVideo, activeQuoteForOrder, assertNoContactLeak, cleanLabel, dateToDatetimeLocal, extensionBackedMediaContentType, formatDateTime, isVideoContentType, parseMinorUnits, prepareOperationalMediaFile, safeMediaUrl, supportMetaWithConsultationBooking } from '../messages/account-messages-surface'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'
import { FABRIC_FUNDING_POLICY_V2_VERSION, CUSTOMER_CONCERN_REASONS, CUSTOMER_CONCERN_REASON_LABELS, FINANCIAL_CASE_REQUESTED_OUTCOMES, FINANCIAL_CASE_REQUESTED_OUTCOME_LABELS, evidencePromptsForConcern, CustomerConcernReason, FinancialCaseRequestedOutcome } from '@drape/shared'
import { isTerminalOrder } from '../shared/account-data-queries'
import { Surface } from '../../../components/ui/surface'

const PRE_CUTTING_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
])

const SCOPE_CHANGE_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
])

export const SCOPE_CHANGE_TYPE_OPTIONS = [
  { value: 'MEASUREMENT_AMENDMENT', label: 'Measurement amendment' },
  { value: 'STYLE_OR_REFERENCE', label: 'Style or reference' },
  { value: 'FABRIC_OR_MATERIAL', label: 'Fabric or material' },
  { value: 'ADD_OR_REMOVE_ITEM', label: 'Add or remove item' },
  { value: 'DEADLINE_OR_EVENT', label: 'Deadline or event' },
  { value: 'PAUSE_OR_RESTART', label: 'Pause or restart' },
  { value: 'REWORK_OR_ALTERATION', label: 'Rework or alteration' },
  { value: 'OTHER', label: 'Other' },
] as const

const SCOPE_CHANGE_IMPACT_OPTIONS = [
  { value: 'PRICE', label: 'Price' },
  { value: 'DEADLINE', label: 'Deadline' },
  { value: 'FIT', label: 'Fit' },
  { value: 'FABRIC', label: 'Fabric' },
  { value: 'STYLE', label: 'Style' },
  { value: 'FULFILLMENT', label: 'Fulfillment' },
] as const

const MATERIAL_ISSUE_REASON_OPTIONS = [
  { value: 'POOR_FABRIC_QUALITY', label: 'Poor fabric quality' },
  { value: 'INSUFFICIENT_YARDAGE', label: 'Insufficient yardage' },
  { value: 'FABRIC_NOT_RECEIVED', label: 'Fabric not received' },
  { value: 'WRONG_FABRIC_TYPE', label: 'Wrong fabric type' },
  { value: 'FABRIC_DAMAGED', label: 'Fabric damaged' },
  { value: 'FABRIC_MISMATCH', label: 'Fabric mismatch' },
] as const

const TAILOR_CANCELLATION_REASON_OPTIONS = [
  { value: 'ITEM_UNAVAILABLE', label: 'Item unavailable' },
  { value: 'ITEM_DAMAGED_BEFORE_DISPATCH', label: 'Item damaged before dispatch' },
  { value: 'TAILOR_CANNOT_FULFIL', label: 'Tailor cannot fulfil' },
  { value: 'DISPATCH_DELAY', label: 'Dispatch delay' },
  { value: 'OTHER', label: 'Other' },
] as const

const TAILOR_DELIVERY_REASON_OPTIONS = [
  { value: 'DRAPEON_COLLECTION_MISSED', label: 'Drapeon collection was missed' },
  { value: 'CUSTODY_SCAN_MISMATCH', label: 'Custody acknowledgement is missing or wrong' },
  { value: 'PARCEL_RETURNED_TO_TAILOR', label: 'Parcel was returned to me' },
  { value: 'HANDOFF_DAMAGE', label: 'Damage was found during handoff' },
  { value: 'OTHER', label: 'Other' },
] as const

function measurementSnapshotForOrder(order: AccountOrder) {
  const snapshot = order.customer_measurements_snapshot
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null
}

function dateTimeLocalInputValue(value: string | null | undefined) {
  const date = parseDateValue(value)
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function stageUpdatesFor(orderId: string, updates: StageUpdate[]) {
  return updates.filter((update) => update.order_id === orderId)
}

export function productionEvidenceFor(orderId: string, evidence: ProductionEvidence[]) {
  return evidence.filter((item) => item.order_id === orderId)
}

function mediaFingerprint(file: File) {
  return [file.name, file.type, file.size, file.lastModified]
    .join(':')
    .replace(/\s+/g, '-')
    .slice(0, 240)
}

export function minorUnitsInput(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return (value / 100).toFixed(2).replace(/\.00$/, '')
}

const ORDER_STAGE_VALUES: OrderStage[] = [
  'DRAFT',
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'EXPIRED',
  'IN_DISPUTE',
  'REFUNDED',
  'CANCELLED',
]

const ORDER_STAGE_SET = new Set<OrderStage>(ORDER_STAGE_VALUES)

const CUSTOM_TAILOR_STAGE_TARGETS: OrderStage[] = [
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_COLLECTION',
  'READY_FOR_DRAPE_DISPATCH',
]

export function asOrderStage(value: string | null | undefined): OrderStage | null {
  if (!value || !ORDER_STAGE_SET.has(value as OrderStage)) return null
  return value as OrderStage
}

export function filterFulfillmentStage(order: AccountOrder, stage: OrderStage) {
  if (stage === 'READY_FOR_COLLECTION') return order.delivery_method === 'LOCAL_COLLECTION'
  if (stage === 'READY_FOR_DRAPE_DISPATCH') return order.delivery_method !== 'LOCAL_COLLECTION'
  return true
}

export function nextStageOptions(order: AccountOrder): OrderStage[] {
  const currentStage = asOrderStage(order.stage)
  if (!currentStage) return []

  if (order.order_kind === 'READY_MADE') {
    if (currentStage === 'CONFIRMED') return ['FINISHING']
    if (currentStage === 'FINISHING') {
      return (['READY_FOR_COLLECTION', 'READY_FOR_DRAPE_DISPATCH'] as OrderStage[])
        .filter((stage) => canTransition(currentStage, stage, 'TAILOR'))
        .filter((stage) => filterFulfillmentStage(order, stage))
    }
    return []
  }

  return CUSTOM_TAILOR_STAGE_TARGETS.filter((stage) =>
    canTransition(currentStage, stage, 'TAILOR')
  ).filter((stage) => filterFulfillmentStage(order, stage))
}

export function isTailorOrder(order: AccountOrder, data: OrderActorData) {
  return Boolean(
    data.tailorProfile &&
    (order.tailor_profile_id === data.tailorProfile.id || order.tailor_id === data.userId)
  )
}

const ORDER_EVIDENCE_VIDEO_MAX_BYTES = MEDIA_LIMITS_BYTES.orderUpdateVideo

const ORDER_EVIDENCE_VIDEO_MAX_SECONDS = MEDIA_LIMITS_SECONDS.orderUpdateVideo

const ORDER_EVIDENCE_CONTENT_TYPES = new Set<string>(ALLOWED_ORDER_EVIDENCE_CONTENT_TYPES)

export function prepareOrderEvidenceFile(file: File) {
  return prepareOperationalMediaFile(file, {
    allowedContentTypes: ORDER_EVIDENCE_CONTENT_TYPES,
    videoMaxBytes: ORDER_EVIDENCE_VIDEO_MAX_BYTES,
    videoMaxSeconds: ORDER_EVIDENCE_VIDEO_MAX_SECONDS,
  })
}

export async function uploadPublicFile(bucket: string, pathPrefix: string, file: File) {
  const uploaded = await uploadPublicFileWithLocation(bucket, pathPrefix, file)
  return uploaded.publicUrl
}

export async function uploadPublicFileWithLocation(bucket: string, pathPrefix: string, file: File) {
  const supabase = createClient()
  const ext =
    file.name
      .split('.')
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'jpg'
  const filePath = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(filePath, file, {
    contentType: file.type || 'application/octet-stream',
    cacheControl: MEDIA_CACHE_CONTROL_SECONDS.publicImmutable,
    upsert: false,
  })
  if (error) throw new Error('The media could not upload. Try a smaller file.')
  return {
    publicUrl: supabase.storage.from(bucket).getPublicUrl(filePath).data.publicUrl,
    bucket,
    path: filePath,
  }
}

export function PhotoTile({ src, label }: { src: string | null; label: string }) {
  const [expanded, setExpanded] = useState(false)
  const safeSrc = safeMediaUrl(src)
  if (!safeSrc) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-[8px] bg-needle/10 text-sm font-semibold text-needle">
        {label}
      </div>
    )
  }
  if (isVideoMediaUrl(safeSrc)) {
    return (
      <>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="block w-full overflow-hidden rounded-[8px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
          aria-label={`Open ${label} full screen`}
        >
          <MutedVideo
            src={safeSrc}
            className="pointer-events-none aspect-[4/3] w-full bg-ink object-cover"
            ariaLabel={label}
            showMuteToggle={false}
          />
        </button>
        {expanded ? (
          <MediaViewerOverlay
            src={safeSrc}
            label={label}
            video
            onClose={() => setExpanded(false)}
          />
        ) : null}
      </>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="relative block aspect-[4/3] w-full overflow-hidden rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
        aria-label={`Open ${label} full screen`}
      >
        <Image
          src={safeSrc}
          alt={label}
          fill
          sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 90vw"
          className="object-cover"
          unoptimized
        />
      </button>
      {expanded ? (
        <MediaViewerOverlay src={safeSrc} label={label} onClose={() => setExpanded(false)} />
      ) : null}
    </>
  )
}

function LocalEvidencePreview({
  file,
  index,
  onRemove,
  onReplace,
}: {
  file: File
  index: number
  onRemove: () => void
  onReplace: (file: File) => void
}) {
  const [previewUrl] = useState(() => URL.createObjectURL(file))
  const [expanded, setExpanded] = useState(false)
  const video = isVideoContentType(
    extensionBackedMediaContentType(file, ORDER_EVIDENCE_CONTENT_TYPES)
  )

  useEffect(() => {
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  return (
    <div className="overflow-hidden rounded-[8px] border border-ink/10 bg-bone/55">
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-ink/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle"
        aria-label={`Preview proof item ${index + 1}`}
      >
        {previewUrl ? (
          video ? (
            <video src={previewUrl} muted playsInline className="h-full w-full object-cover" />
          ) : (
            <img
              src={previewUrl}
              alt={`Proof item ${index + 1}`}
              className="h-full w-full object-cover"
            />
          )
        ) : null}
      </button>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-xs text-ink/55">{file.name}</span>
        <div className="flex shrink-0 items-center gap-3">
          <label className="cursor-pointer text-xs font-semibold text-needle">
            Replace
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              className="sr-only"
              onChange={(event) => {
                const replacement = event.target.files?.[0]
                if (replacement) onReplace(replacement)
                event.currentTarget.value = ''
              }}
            />
          </label>
          <button type="button" onClick={onRemove} className="text-xs font-semibold text-rust-700">
            Remove
          </button>
        </div>
      </div>
      {expanded && previewUrl ? (
        <MediaViewerOverlay
          src={previewUrl}
          label={`Proof item ${index + 1}`}
          video={video}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </div>
  )
}

export function TailorOrderActions({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: OrderDetailRenderData
  onRefresh: () => void
}) {
  const booking = data.consultationBooking
  const supportMeta = supportMetaWithConsultationBooking(order.special_note, booking)
  const consultationMeta = supportMeta.consultation
  const proposedConsultationStart =
    consultationMeta?.proposedStartAt ?? consultationMeta?.scheduledStartAt ?? null
  const currentQuote = activeQuoteForOrder(data.quotes, order.id)
  const quoteTaxNeedsRefresh = taxSnapshotNeedsRefresh({
    taxRegion: order.tax_region,
    taxRateBps: order.tax_rate_bps,
    taxFallback: order.tax_fallback,
  })
  const [quoteAmount, setQuoteAmount] = useState(() => minorUnitsInput(order.subtotal_amount))
  const [quoteTailoringAmount, setQuoteTailoringAmount] = useState(() =>
    minorUnitsInput(supportMeta.quoteBreakdown?.tailoringAmount)
  )
  const [quoteFabricAllowanceAmount, setQuoteFabricAllowanceAmount] = useState(() =>
    minorUnitsInput(supportMeta.quoteBreakdown?.fabricAllowanceAmount)
  )
  const [quoteFabricCoverage, setQuoteFabricCoverage] = useState<string[]>(
    () =>
      supportMeta.quoteBreakdown?.fabricAllowanceCoverage ??
      (order.fabric_source === 'TAILOR_SOURCES' ? ['FABRIC'] : [])
  )
  const [quoteFabricAssumptions, setQuoteFabricAssumptions] = useState(
    () => supportMeta.quoteBreakdown?.fabricSourcingAssumptions ?? ''
  )
  const [quoteCurrency, setQuoteCurrency] = useState(
    order.currency ?? data.tailorProfile?.currency ?? 'USD'
  )
  const [completionDate, setCompletionDate] = useState(
    () => order.quoted_completion_date?.slice(0, 10) ?? ''
  )
  const [quoteNote, setQuoteNote] = useState('')
  const [quoteOrderReviewed, setQuoteOrderReviewed] = useState(false)
  const [quoteDraftLoaded, setQuoteDraftLoaded] = useState(false)
  const [quoteDraftStatus, setQuoteDraftStatus] = useState('')
  const [consultationStart, setConsultationStart] = useState(() =>
    dateTimeLocalInputValue(proposedConsultationStart)
  )
  const [consultationStartSuggestion, setConsultationStartSuggestion] = useState<{
    value: string
    label: string
  } | null>(null)
  const publishedConsultationCallType = data.tailorProfile?.consultation_call_type ?? 'VIDEO'
  const [consultationCallType, setConsultationCallType] = useState<'AUDIO' | 'VIDEO'>(
    consultationMeta?.callType === 'AUDIO' || publishedConsultationCallType === 'AUDIO'
      ? 'AUDIO'
      : 'VIDEO'
  )
  const [consultationNote, setConsultationNote] = useState('')
  const [targetStage, setTargetStage] = useState(nextStageOptions(order)[0] ?? '')
  const [stageNote, setStageNote] = useState('')
  const [stageTrackingNumber, setStageTrackingNumber] = useState('')
  const [stageFulfillmentProvider, setStageFulfillmentProvider] = useState('')
  const [stageFulfillmentReference, setStageFulfillmentReference] = useState('')
  const [stageFulfillmentContactName, setStageFulfillmentContactName] = useState('')
  const [stageFulfillmentContactPhone, setStageFulfillmentContactPhone] = useState('')
  const [stageMediaFiles, setStageMediaFiles] = useState<File[]>([])
  const [fabricApprovalMode, setFabricApprovalMode] = useState(false)
  const [showFabricChangeFeedback, setShowFabricChangeFeedback] = useState(false)
  const [showStyleChangeFeedback, setShowStyleChangeFeedback] = useState(false)
  const [measurementNote, setMeasurementNote] = useState('')
  const [measurementFields, setMeasurementFields] = useState('')
  const [fitReadinessNote, setFitReadinessNote] = useState('')
  const [styleAlignmentNote, setStyleAlignmentNote] = useState('')
  const [fabricReceiptNote, setFabricReceiptNote] = useState('')
  const [fabricReceiptFile, setFabricReceiptFile] = useState<File | null>(null)
  const [materialIssueReason, setMaterialIssueReason] =
    useState<(typeof MATERIAL_ISSUE_REASON_OPTIONS)[number]['value']>('POOR_FABRIC_QUALITY')
  const [materialIssueNote, setMaterialIssueNote] = useState('')
  const [scopeChangeType, setScopeChangeType] =
    useState<(typeof SCOPE_CHANGE_TYPE_OPTIONS)[number]['value']>('STYLE_OR_REFERENCE')
  const [scopeChangeSummary, setScopeChangeSummary] = useState('')
  const [scopeChangeImpacts, setScopeChangeImpacts] = useState<string[]>([])
  const [scopePriceImpact, setScopePriceImpact] = useState('')
  const [scopeDeadlineImpact, setScopeDeadlineImpact] = useState('')
  const [tailorScopeChangeResponseNote, setTailorScopeChangeResponseNote] = useState('')
  const [declineNote, setDeclineNote] = useState('')
  const [declineArmed, setDeclineArmed] = useState(false)
  const [pickupCode, setPickupCode] = useState('')
  const [tailorCancellationReason, setTailorCancellationReason] =
    useState<(typeof TAILOR_CANCELLATION_REASON_OPTIONS)[number]['value']>('TAILOR_CANNOT_FULFIL')
  const [tailorCancellationNote, setTailorCancellationNote] = useState('')
  const [tailorDeliveryReason, setTailorDeliveryReason] = useState<
    (typeof TAILOR_DELIVERY_REASON_OPTIONS)[number]['value']
  >('DRAPEON_COLLECTION_MISSED')
  const [tailorDeliveryNote, setTailorDeliveryNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!showFabricChangeFeedback && !showStyleChangeFeedback) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowFabricChangeFeedback(false)
        setShowStyleChangeFeedback(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showFabricChangeFeedback, showStyleChangeFeedback])

  const isTailor = isTailorOrder(order, data)
  const stage = order.stage ?? ''
  const currentOrderStage = asOrderStage(order.stage)
  const measurementSnapshot = measurementSnapshotForOrder(order)
  const tailorFabricNeedsAction =
    canSubmitTailorFabricApproval({
      orderKind: order.order_kind,
      fabricSource: order.fabric_source,
      stage,
    }) && data.customOrderDetail?.fabric_approval_status !== 'APPROVED'
  const tailorFabricApproved =
    order.order_kind === 'CUSTOM' &&
    order.fabric_source === 'TAILOR_SOURCES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    data.customOrderDetail?.fabric_approval_status === 'APPROVED'
  const latestTailorFabricEvidence = latestFabricApprovalEvidence(
    productionEvidenceFor(order.id, data.productionEvidence)
  )
  const tailorFabricProofUrls = Array.from(
    new Set(stringList(latestTailorFabricEvidence?.photo_urls))
  )
  const fabricChangeFeedback = sourcedFabricChangeFeedbackFromUpdates(
    stageUpdatesFor(order.id, data.stageUpdates)
  )
  const styleChangeFeedback = styleAlignmentChangeFeedbackFromUpdates(
    stageUpdatesFor(order.id, data.stageUpdates)
  )
  const showTailorStyleDecision =
    order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.requiredBeforeCutting === true &&
    (supportMeta.styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL' ||
      supportMeta.styleAlignment.status === 'CHANGES_REQUESTED')
  const showTailorStyleApproved =
    order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.requiredBeforeCutting === true &&
    supportMeta.styleAlignment.status === 'APPROVED'
  const baseStageOptions = nextStageOptions(order)
  const stageOptions =
    stage === 'SOURCING' ? Array.from(new Set(['SOURCING', ...baseStageOptions])) : baseStageOptions
  const selectedTargetStage = fabricApprovalMode
    ? 'SOURCING'
    : (stageOptions.find((stage) => stage === targetStage) ?? stageOptions[0] ?? '')
  const selectedTargetNeedsDispatchMeta = selectedTargetStage === 'READY_FOR_DRAPE_DISPATCH'
  const lockedQuoteCurrency =
    normalizeAccountCurrency(order.currency ?? order.quoted_currency) ?? quoteCurrency
  const fundedFabricQuote = order.fabric_funding_policy_version === 'fabric-funding-2026-08-01-v1'
  const tailorSourcesFabric = order.fabric_source === 'TAILOR_SOURCES'
  const consultationRequestedByCustomer =
    order.stage === 'CONSULTATION' &&
    consultationMeta?.requestedBy === 'CUSTOMER' &&
    consultationMeta.status === 'REQUESTED'
  const tailorCanScheduleConsultation =
    order.order_kind !== 'READY_MADE' &&
    (order.stage === 'PENDING_QUOTE' || consultationRequestedByCustomer)
  const proposedConsultationLabel = formatDateTime(
    proposedConsultationStart,
    consultationMeta?.timezone
  )
  const cancellationPolicy = currentOrderStage
    ? deriveCancellationPolicy({
        orderKind: order.order_kind === 'READY_MADE' ? 'READY_MADE' : 'CUSTOM',
        stage: currentOrderStage,
        deliveryMethod: order.delivery_method,
        consultationFee: order.consultation_fee,
        consultationPaidAt: consultationMeta?.paidAt ?? null,
        consultationFeeCreditable: consultationMeta?.feeCreditable ?? null,
        fulfillmentFee: order.fulfillment_fee,
        fulfillmentPaymentRequestedAt: order.fulfillment_payment_requested_at ?? null,
        fulfillmentPaymentPaidAt: order.fulfillment_payment_paid_at ?? null,
        dispatchBookedAt: supportMeta.dispatchRecord?.bookedAt ?? null,
        premiumDispatch: supportMeta.dispatchRecord?.premiumException ?? null,
      })
    : null
  const cancellationReviewOpen = supportMeta.cancellationReview?.status === 'OPEN'
  const deliveryReviewOpen = supportMeta.deliveryReview?.status === 'OPEN'
  const materialIssueOpen = supportMeta.materialIssue?.status === 'OPEN'
  const scopeChangeOpen = supportMeta.scopeChange?.status === 'OPEN'
  const canRequestMeasurementConfirmation =
    PRE_CUTTING_STAGES.has(stage) &&
    !!measurementSnapshot &&
    Object.keys(measurementSnapshot).length > 0
  const canConfirmFitReadiness =
    PRE_CUTTING_STAGES.has(stage) && supportMeta.fitProfile?.requiresTailorReview === true
  const canRequestStyleAlignment =
    order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.requiredBeforeCutting === true &&
    supportMeta.styleAlignment.status !== 'APPROVED' &&
    supportMeta.styleAlignment.status !== 'NOT_REQUIRED'
  const canConfirmFabricReceived =
    order.fabric_source === 'CUSTOMER_SUPPLIES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    (!supportMeta.fabricReceivedAt || supportMeta.materialIssue?.response === 'REPLACE_FABRIC')
  const canOpenMaterialIssue =
    order.order_kind === 'CUSTOM' &&
    order.fabric_source === 'CUSTOMER_SUPPLIES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    !materialIssueOpen
  const canRequestScopeChange =
    order.order_kind === 'CUSTOM' &&
    SCOPE_CHANGE_STAGES.has(stage) &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen
  const canRespondScopeChange =
    scopeChangeOpen && supportMeta.scopeChange?.requestedBy === 'CUSTOMER'
  const canCancelScopeChange = scopeChangeOpen && supportMeta.scopeChange?.requestedBy === 'TAILOR'
  const canDeclineOrder = cancellationPolicy?.tailorCanDecline === true
  const canRequestCancellationReview =
    cancellationPolicy?.tailorCanRequestReview === true && !cancellationReviewOpen
  const initialPaymentLikelyPaid = ![
    'PENDING_QUOTE',
    'CONSULTATION',
    'QUOTE_SENT',
    'PAYMENT_PENDING',
    'PAYMENT_FAILED',
    'DECLINED',
    'EXPIRED',
  ].includes(stage)
  const canRequestDeliveryReview =
    initialPaymentLikelyPaid &&
    !deliveryReviewOpen &&
    stage !== 'IN_DISPUTE' &&
    !isCompletedOrderStage(stage)
  const canConfirmCollection =
    stage === 'READY_FOR_COLLECTION' && order.delivery_method === 'LOCAL_COLLECTION'
  const quoteDraftFields = useMemo<TailorQuoteDraftFields>(
    () => ({
      amount: quoteAmount,
      tailoringAmount: quoteTailoringAmount,
      fabricAllowanceAmount: quoteFabricAllowanceAmount,
      fabricCoverage: quoteFabricCoverage,
      fabricAssumptions: quoteFabricAssumptions,
      completionDate,
      laborAmount: '',
      sourcingAmount: '',
      rushAmount: '',
      includedText: '',
      excludedText: '',
      breakdownSummary: '',
      note: quoteNote,
      currency: lockedQuoteCurrency as AccountCurrencyCode,
    }),
    [
      completionDate,
      lockedQuoteCurrency,
      quoteAmount,
      quoteFabricAllowanceAmount,
      quoteFabricAssumptions,
      quoteFabricCoverage,
      quoteNote,
      quoteTailoringAmount,
    ]
  )
  const quoteSubmitBlockedReason = !quoteOrderReviewed
    ? 'Confirm that you reviewed the order before sending.'
    : (!fundedFabricQuote && !quoteAmount) || (fundedFabricQuote && !quoteTailoringAmount)
      ? 'Add the required quote amount before sending.'
      : fundedFabricQuote &&
          tailorSourcesFabric &&
          (!quoteFabricAllowanceAmount ||
            quoteFabricCoverage.length === 0 ||
            quoteFabricAssumptions.trim().length < 8)
        ? 'Complete the fabric allowance details before sending.'
        : !completionDate
          ? 'Choose an estimated completion date before sending.'
          : null

  const persistQuoteDraft = useCallback(async () => {
    if (!isMeaningfulTailorQuoteDraft(quoteDraftFields)) return true
    setQuoteDraftStatus('Saving quote...')
    try {
      await invokeAccountFunction('tailor-quote-draft-action', {
        action: 'save',
        orderId: order.id,
        version: TAILOR_QUOTE_DRAFT_VERSION,
        mode: 'send',
        fields: quoteDraftFields,
      })
      setQuoteDraftStatus('Draft saved')
      return true
    } catch {
      setQuoteDraftStatus('Draft not synced')
      return false
    }
  }, [order.id, quoteDraftFields])

  useEffect(() => {
    if (!isTailor || !['PENDING_QUOTE', 'CONSULTATION'].includes(stage)) return
    let active = true
    void invokeAccountFunction<{
      draft?: { version?: string; mode?: string; fields?: Partial<TailorQuoteDraftFields> } | null
    }>('tailor-quote-draft-action', {
      action: 'load',
      orderId: order.id,
    })
      .then((result) => {
        if (!active) return
        const fields =
          result.draft?.version === TAILOR_QUOTE_DRAFT_VERSION && result.draft.mode === 'send'
            ? result.draft.fields
            : null
        if (fields) {
          setQuoteAmount(formatMoneyInputValue(fields.amount ?? ''))
          setQuoteTailoringAmount(formatMoneyInputValue(fields.tailoringAmount ?? ''))
          setQuoteFabricAllowanceAmount(formatMoneyInputValue(fields.fabricAllowanceAmount ?? ''))
          setQuoteFabricCoverage(Array.isArray(fields.fabricCoverage) ? fields.fabricCoverage : [])
          setQuoteFabricAssumptions(fields.fabricAssumptions ?? '')
          setCompletionDate(fields.completionDate ?? '')
          setQuoteNote(fields.note ?? '')
          setQuoteOrderReviewed(false)
          setQuoteDraftStatus('Draft restored')
        } else {
          setQuoteDraftStatus('')
        }
        setQuoteDraftLoaded(true)
      })
      .catch(() => {
        if (!active) return
        setQuoteDraftStatus('Draft sync unavailable')
        setQuoteDraftLoaded(true)
      })
    return () => {
      active = false
    }
  }, [isTailor, order.id, stage])

  useEffect(() => {
    if (
      !isTailor ||
      !quoteDraftLoaded ||
      !['PENDING_QUOTE', 'CONSULTATION'].includes(stage) ||
      !isMeaningfulTailorQuoteDraft(quoteDraftFields)
    )
      return
    const timer = window.setTimeout(() => {
      setQuoteDraftStatus('Unsaved changes')
      void persistQuoteDraft()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [
    isTailor,
    persistQuoteDraft,
    quoteDraftFields,
    quoteDraftLoaded,
    stage,
  ])

  if (!isTailor) return null

  async function addStageMedia(files: FileList | null) {
    if (!files?.length) return
    const nextFiles = Array.from(files)
    try {
      await Promise.all(nextFiles.map(prepareOrderEvidenceFile))
    } catch (mediaError) {
      setError(friendlyActionError(mediaError, 'Choose photos or MP4/MOV videos up to 60 seconds.'))
      return
    }
    setStageMediaFiles((current) => {
      const combined = [...current, ...nextFiles]
      if (combined.length > 6) {
        setError('Attach up to 6 proof items for a stage update.')
      }
      return combined.slice(0, 6)
    })
  }

  async function replaceStageMedia(index: number, file: File) {
    try {
      await prepareOrderEvidenceFile(file)
      setStageMediaFiles((current) =>
        current.map((item, itemIndex) => (itemIndex === index ? file : item))
      )
      setError(null)
    } catch (mediaError) {
      setError(friendlyActionError(mediaError, 'Choose a photo or MP4/MOV video up to 60 seconds.'))
    }
  }

  async function sendQuote() {
    const tailoringAmount = parseMoneyInputToMinorUnits(quoteTailoringAmount)
    const fabricAllowanceAmount = tailorSourcesFabric
      ? parseMoneyInputToMinorUnits(quoteFabricAllowanceAmount)
      : 0
    const amount = fundedFabricQuote
      ? (tailoringAmount ?? 0) + (fabricAllowanceAmount ?? 0)
      : parseMoneyInputToMinorUnits(quoteAmount)
    const completionDateValue = completionDate ? new Date(`${completionDate}T12:00:00.000Z`) : null
    const dateIso =
      completionDateValue && !Number.isNaN(completionDateValue.getTime())
        ? completionDateValue.toISOString()
        : null
    const leak = assertNoContactLeak(quoteNote, "Quote notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!amount || !dateIso || (fundedFabricQuote && !tailoringAmount)) {
      setError('Add the tailoring amount and completion date.')
      return
    }
    if (
      fundedFabricQuote &&
      tailorSourcesFabric &&
      (!fabricAllowanceAmount ||
        quoteFabricCoverage.length === 0 ||
        quoteFabricAssumptions.trim().length < 8)
    ) {
      setError('Add the fabric allowance, what it covers, and clear sourcing assumptions.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    if (!quoteOrderReviewed) {
      setError(
        'Review the complete order details and confirm that review before sending this quote.'
      )
      return
    }
    const customerDeadline = order.deadline ? new Date(order.deadline) : null
    if (
      customerDeadline &&
      completionDateValue &&
      completionDateValue.getTime() > customerDeadline.getTime()
    ) {
      setError(
        `This quote date goes past the customer deadline of ${customerDeadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Choose an earlier date.`
      )
      return
    }
    setBusy('quote')
    try {
      await invokeAccountFunction('tailor-order-action', {
        action: quoteTaxNeedsRefresh ? 'revise-quote' : 'send-quote',
        orderId: order.id,
        ...(quoteTaxNeedsRefresh && currentQuote
          ? {
              quoteId: currentQuote.id,
              expectedQuoteVersion: currentQuote.version,
              changeKind: 'TAILOR_CORRECTION',
            }
          : {}),
        amount,
        currency: lockedQuoteCurrency,
        completionDate: dateIso,
        ...(fundedFabricQuote
          ? {
              fabricAllocation: {
                tailoringAmount,
                fabricAllowanceAmount,
                coverage: quoteFabricCoverage,
                sourcingAssumptions: tailorSourcesFabric ? quoteFabricAssumptions.trim() : '',
              },
            }
          : {}),
        orderReview: {
          acknowledged: true,
          version: QUOTE_ORDER_REVIEW_VERSION,
        },
        note: quoteNote.trim() || undefined,
      })
      setSuccess(
        quoteTaxNeedsRefresh
          ? 'Quote refreshed with the current tax breakdown. The customer was notified.'
          : 'Quote sent. The customer was notified, and scheduled order calls are now available in this chat.'
      )
      setQuoteOrderReviewed(false)
      await invokeAccountFunction('tailor-quote-draft-action', {
        action: 'delete',
        orderId: order.id,
      }).catch(() => null)
      onRefresh()
    } catch (quoteError) {
      setError(
        friendlyActionError(
          quoteError,
          'Quote could not be sent. Check the order state and try again.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  async function saveConsultation(action: 'request-consultation' | 'approve-consultation') {
    const scheduledAt = consultationStart ? new Date(consultationStart) : null
    const leak = assertNoContactLeak(
      consultationNote,
      "Consultation notes can't include contact details."
    )
    setError(null)
    setSuccess(null)
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      setError('Choose the consultation date and time.')
      return
    }
    if (scheduledAt.getTime() < Date.now() + 60 * 60_000) {
      const suggestion = recommendedSchedulingStartDate({ minLookaheadMinutes: 60 })
      const label = formatDateTime(suggestion.toISOString()) ?? suggestion.toLocaleString()
      setConsultationStartSuggestion({ value: dateToDatetimeLocal(suggestion), label })
      setError(`That consultation time is too soon. The nearest valid option is ${label}.`)
      return
    }
    setConsultationStartSuggestion(null)
    if (leak) {
      setError(leak)
      return
    }
    setBusy(action === 'approve-consultation' ? 'consultation-approve' : 'consultation-schedule')
    try {
      await invokeAccountFunction('tailor-order-action', {
        action,
        orderId: order.id,
        scheduledStartAt: scheduledAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        callType: consultationCallType,
        note: consultationNote.trim() || undefined,
      })
      setConsultationNote('')
      setSuccess(
        action === 'approve-consultation'
          ? 'Consultation approved and scheduled.'
          : 'Consultation scheduled for the customer.'
      )
      onRefresh()
    } catch (consultationError) {
      setError(
        friendlyActionError(
          consultationError,
          'Consultation could not be scheduled. Check the requested time and try again.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  async function declineConsultation() {
    const leak = assertNoContactLeak(
      consultationNote,
      "Consultation notes can't include contact details."
    )
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    setBusy('consultation-decline')
    try {
      await invokeAccountFunction('tailor-order-action', {
        action: 'decline-consultation-request',
        orderId: order.id,
        note: consultationNote.trim() || undefined,
      })
      setConsultationNote('')
      setSuccess('Consultation declined. The order is back in quote review.')
      onRefresh()
    } catch (consultationError) {
      setError(
        friendlyActionError(
          consultationError,
          'Consultation request could not be declined. Refresh and try again.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  async function runTailorLifecycleAction(
    action: string,
    body: Record<string, unknown>,
    successMessage: string
  ) {
    setBusy(action)
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('tailor-order-action', {
        action,
        orderId: order.id,
        ...body,
      })
      setDeclineArmed(false)
      setSuccess(successMessage)
      onRefresh()
      return true
    } catch (actionError) {
      setError(
        friendlyActionError(
          actionError,
          'This tailor action could not finish. Refresh the order and try again.'
        )
      )
      setSuccess(null)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function requestMeasurementConfirmation() {
    const note = measurementNote.trim()
    const leak = assertNoContactLeak(
      [note, measurementFields].join('\n'),
      "Measurement confirmation notes can't include contact details."
    )
    if (note.length < 10) {
      setError('Tell the customer what needs confirming before cutting.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const fields = measurementFields
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean)
      .slice(0, 20)
    const ok = await runTailorLifecycleAction(
      'request-measurement-confirmation',
      { note, fields: fields.length > 0 ? fields : undefined },
      'Measurement confirmation requested from the customer.'
    )
    if (ok) {
      setMeasurementNote('')
      setMeasurementFields('')
    }
  }

  async function confirmFitReadiness() {
    const note = fitReadinessNote.trim()
    const leak = assertNoContactLeak(note, "Fit readiness notes can't include contact details.")
    if (note.length < 10) {
      setError('Explain what you reviewed before clearing fit readiness.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'confirm-fit-readiness',
      { note },
      'Fit readiness confirmed for this order.'
    )
    if (ok) setFitReadinessNote('')
  }

  async function requestStyleAlignment() {
    const note = styleAlignmentNote.trim()
    const leak = assertNoContactLeak(note, "Style approval notes can't include contact details.")
    if (note.length < 10) {
      setError('Explain the style interpretation before asking for approval.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'request-style-alignment',
      { note },
      'Style alignment sent for customer approval.'
    )
    if (ok) setStyleAlignmentNote('')
  }

  async function confirmFabricReceived() {
    const note = fabricReceiptNote.trim()
    const leak = assertNoContactLeak(note, "Fabric receipt notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    if (order.order_kind === 'CUSTOM' && !fabricReceiptFile) {
      setError('Add fabric receipt proof before confirming customer fabric.')
      return
    }
    let preparedFabricReceipt: File | null = null
    if (fabricReceiptFile) {
      try {
        preparedFabricReceipt = await prepareOrderEvidenceFile(fabricReceiptFile)
      } catch (mediaError) {
        setError(
          friendlyActionError(
            mediaError,
            'Choose fabric receipt proof as a photo or MP4/MOV video up to 60 seconds.'
          )
        )
        return
      }
    }
    setBusy('confirm-fabric-received')
    try {
      const photoUrl = preparedFabricReceipt
        ? await uploadPublicFile(
            'order-photos',
            `fabric-receipts/${order.id}`,
            preparedFabricReceipt
          )
        : undefined
      await invokeAccountFunction('tailor-order-action', {
        action: 'confirm-fabric-received',
        orderId: order.id,
        note: note || undefined,
        photoUrl,
      })
      setFabricReceiptNote('')
      setFabricReceiptFile(null)
      setSuccess('Fabric receipt confirmed on the order timeline.')
      onRefresh()
    } catch (fabricError) {
      setError(
        friendlyActionError(
          fabricError,
          'Fabric receipt could not be confirmed. Add proof and try again.'
        )
      )
      setSuccess(null)
    } finally {
      setBusy(null)
    }
  }

  async function openMaterialIssue() {
    const note = materialIssueNote.trim()
    const leak = assertNoContactLeak(note, "Material issue notes can't include contact details.")
    if (note.length < 10) {
      setError('Describe the material issue so the customer can choose what to do next.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'open-material-issue',
      { reason: materialIssueReason, note },
      'Material issue opened for the customer.'
    )
    if (ok) setMaterialIssueNote('')
  }

  function toggleScopeImpact(value: string) {
    setScopeChangeImpacts((current) =>
      current.includes(value) ? current.filter((impact) => impact !== value) : [...current, value]
    )
  }

  async function requestScopeChange() {
    const summary = scopeChangeSummary.trim()
    const deadlineImpact = scopeDeadlineImpact.trim()
    const leak = assertNoContactLeak(
      [summary, deadlineImpact].join('\n'),
      "Change requests can't include contact details."
    )
    const parsedPriceImpact = scopePriceImpact.trim() ? parseMinorUnits(scopePriceImpact) : null
    if (summary.length < 10) {
      setError('Explain what changed and what the customer needs to approve.')
      setSuccess(null)
      return
    }
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    if (scopePriceImpact.trim() && parsedPriceImpact === null) {
      setError('Enter a valid added price, or leave price impact blank.')
      setSuccess(null)
      return
    }
    const impacts = Array.from(
      new Set([
        ...scopeChangeImpacts,
        ...(parsedPriceImpact ? ['PRICE'] : []),
        ...(deadlineImpact ? ['DEADLINE'] : []),
      ])
    )
    const ok = await runTailorLifecycleAction(
      'request-scope-change',
      {
        scopeChangeType,
        scopeChangeSummary: summary,
        scopeChangeImpacts: impacts.length > 0 ? impacts : undefined,
        priceImpactMinor: parsedPriceImpact ?? undefined,
        deadlineImpact: deadlineImpact || undefined,
      },
      'Change request sent to the customer.'
    )
    if (ok) {
      setScopeChangeSummary('')
      setScopeChangeImpacts([])
      setScopePriceImpact('')
      setScopeDeadlineImpact('')
    }
  }

  async function respondTailorScopeChange(decision: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    const note = tailorScopeChangeResponseNote.trim()
    const leak = assertNoContactLeak(note, "Change response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    const ok = await runTailorLifecycleAction(
      'respond-scope-change',
      { scopeChangeDecision: decision, scopeChangeResponseNote: note || undefined },
      decision === 'ACCEPTED'
        ? 'Order change accepted.'
        : decision === 'DECLINED'
          ? 'Order change declined.'
          : 'Change proposal cancelled.'
    )
    if (ok) setTailorScopeChangeResponseNote('')
  }

  async function declineOrder() {
    const note = declineNote.trim()
    const leak = assertNoContactLeak(note, "Decline notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    if (!declineArmed) {
      setDeclineArmed(true)
      setSuccess('Click decline once more to close this order request.')
      return
    }
    const ok = await runTailorLifecycleAction(
      'decline-order',
      { note: note || undefined },
      'Order declined and closed.'
    )
    if (ok) setDeclineNote('')
  }

  async function confirmCollection() {
    const code = pickupCode.replace(/\D/g, '')
    if (!/^\d{4}$/.test(code)) {
      setError('Enter the 4-digit pickup code from the customer.')
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'confirm-collection',
      { code },
      'Collection confirmed. Handoff is closed.'
    )
    if (ok) setPickupCode('')
  }

  async function requestTailorCancellationReview() {
    const note = tailorCancellationNote.trim()
    const leak = assertNoContactLeak(
      note,
      "Cancellation review notes can't include contact details."
    )
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'request-cancellation-review',
      { reason: tailorCancellationReason, note: note || undefined },
      'Cancellation review opened for Drapeon.'
    )
    if (ok) setTailorCancellationNote('')
  }

  async function requestTailorDeliveryReview() {
    const note = tailorDeliveryNote.trim()
    const leak = assertNoContactLeak(note, "Delivery review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    const ok = await runTailorLifecycleAction(
      'request-delivery-review',
      { reason: tailorDeliveryReason, note: note || undefined },
      'Shipping or delivery help recorded. Drapeon applied the appropriate risk protection and Ops follow-up.'
    )
    if (ok) setTailorDeliveryNote('')
  }

  async function advanceStage() {
    const progressOnlySubmission = !fabricApprovalMode && selectedTargetStage === order.stage
    const leak = assertNoContactLeak(stageNote, "Stage notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!selectedTargetStage || stageNote.trim().length < 10) {
      setError('Choose the next stage and add a clear note.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    if (stageMediaFiles.length === 0) {
      setError(
        selectedTargetNeedsDispatchMeta
          ? 'Add fresh packed-order proof before marking this order ready for Drapeon dispatch.'
          : 'Attach fresh proof media before updating this stage.'
      )
      return
    }
    setBusy('stage')
    try {
      const selectedFiles = stageMediaFiles.slice(0, 6)
      const photoUrls = await Promise.all(
        selectedFiles.map(async (file) =>
          uploadPublicFile(
            'order-photos',
            `${fabricApprovalMode ? 'fabric-approval' : 'progress'}/${order.id}`,
            await prepareOrderEvidenceFile(file)
          )
        )
      )
      const mediaFingerprints = selectedFiles.map(mediaFingerprint)
      await invokeAccountFunction('tailor-order-action', {
        action: fabricApprovalMode
          ? 'submit-sourced-fabric'
          : progressOnlySubmission
            ? 'post-stage-progress'
            : 'advance-stage',
        orderId: order.id,
        ...(fabricApprovalMode ? {} : { targetStage: selectedTargetStage }),
        note: stageNote.trim(),
        photoUrl: photoUrls[0],
        photoUrls,
        mediaFingerprints,
        trackingNumber: selectedTargetNeedsDispatchMeta
          ? stageTrackingNumber.trim().toUpperCase() || undefined
          : undefined,
        fulfillmentProvider: selectedTargetNeedsDispatchMeta
          ? stageFulfillmentProvider.trim() || undefined
          : undefined,
        fulfillmentReference: selectedTargetNeedsDispatchMeta
          ? stageFulfillmentReference.trim().toUpperCase() || undefined
          : undefined,
        fulfillmentContactName: selectedTargetNeedsDispatchMeta
          ? stageFulfillmentContactName.trim() || undefined
          : undefined,
        fulfillmentContactPhone: selectedTargetNeedsDispatchMeta
          ? stageFulfillmentContactPhone.trim() || undefined
          : undefined,
      })
      setStageNote('')
      setStageTrackingNumber('')
      setStageFulfillmentProvider('')
      setStageFulfillmentReference('')
      setStageFulfillmentContactName('')
      setStageFulfillmentContactPhone('')
      setStageMediaFiles([])
      setFabricApprovalMode(false)
      setSuccess(
        fabricApprovalMode
          ? 'Exact fabric sent to the customer for approval.'
          : progressOnlySubmission
            ? 'Sourcing progress added without changing the fabric awaiting approval.'
            : 'Stage updated and added to the order timeline.'
      )
      onRefresh()
    } catch (stageError) {
      setError(
        friendlyActionError(
          stageError,
          'Stage could not be updated. Check approval gates and try again.'
        )
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      id="tailor-actions"
      className="scroll-mt-28 rounded-[8px] border border-needle/12 bg-needle/8 p-6 shadow-sm"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
        Tailor actions
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-ink">Work this order from web</h2>
      <div className="mt-5 grid gap-4">
        <ActionNotice error={error} success={success} />
        {tailorFabricNeedsAction ? (
          <div className="grid gap-3 rounded-[8px] border border-needle/18 bg-white p-4 shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
                Current production blocker
              </p>
              <h3 className="mt-1 text-xl font-semibold text-ink">
                {data.customOrderDetail?.fabric_approval_status === 'CHANGES_REQUESTED'
                  ? 'Customer requested fabric changes'
                  : data.customOrderDetail?.fabric_approval_status ===
                        'PENDING_CUSTOMER_APPROVAL' && tailorFabricProofUrls.length > 0
                    ? 'Fabric awaiting customer approval'
                    : 'Fabric approval needs action'}
              </h3>
              <p className="mt-2 text-sm leading-6 text-ink/62">
                {data.customOrderDetail?.fabric_description
                  ? safeUserText(
                      data.customOrderDetail.fabric_description,
                      'Upload a clear fabric proof before cutting.'
                    )
                  : 'Upload a clear photo or video in natural light before cutting.'}
              </p>
              {data.customOrderDetail?.fabric_approval_status === 'CHANGES_REQUESTED' &&
              fabricChangeFeedback ? (
                <button
                  type="button"
                  onClick={() => setShowFabricChangeFeedback(true)}
                  className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle transition-colors duration-200 hover:bg-needle/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
                  aria-haspopup="dialog"
                >
                  View changes
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {tailorFabricProofUrls.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tailorFabricProofUrls.map((src, index) => (
                  <PhotoTile key={src} src={src} label={`Sourced fabric proof ${index + 1}`} />
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setFabricApprovalMode(true)
                setTargetStage('SOURCING')
                setStageNote('')
                setStageMediaFiles([])
                window.requestAnimationFrame(() =>
                  document
                    .getElementById('tailor-stage-update')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                )
              }}
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
            >
              {data.customOrderDetail?.fabric_approval_status === 'PENDING_CUSTOMER_APPROVAL'
                ? tailorFabricProofUrls.length > 0
                  ? 'Replace fabric proof'
                  : 'Upload fabric proof'
                : data.customOrderDetail?.fabric_approval_status === 'CHANGES_REQUESTED'
                  ? 'Upload replacement fabric'
                  : 'Upload sourced fabric'}
            </button>
            {stage === 'SOURCING' ? (
              <button
                type="button"
                onClick={() => {
                  setFabricApprovalMode(false)
                  setTargetStage('SOURCING')
                  setStageNote('')
                  setStageMediaFiles([])
                  window.requestAnimationFrame(() =>
                    document
                      .getElementById('tailor-stage-update')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  )
                }}
                className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink"
              >
                Add sourcing update
              </button>
            ) : null}
          </div>
        ) : null}
        {tailorFabricApproved ? (
          <div
            className="flex items-start gap-3 rounded-[8px] border border-needle/20 bg-needle/8 p-4"
            role="status"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-needle text-white">
              <CheckCheck className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-needle">Fabric approved</h3>
              <p className="mt-1 text-sm leading-6 text-ink/68">
                The customer approved the selected fabric. Continue once the remaining pre-cutting
                checks are clear.
              </p>
            </div>
          </div>
        ) : null}
        {showTailorStyleDecision ? (
          <div className="grid gap-3 rounded-[8px] border border-rust/18 bg-rust/6 p-4">
            <div>
              <h3 className="text-lg font-semibold text-ink">
                {supportMeta.styleAlignment?.status === 'CHANGES_REQUESTED'
                  ? 'Customer requested style clarification'
                  : 'Style plan awaiting customer approval'}
              </h3>
              <p className="mt-1 line-clamp-3 text-sm leading-6 text-ink/62">
                {safeUserText(
                  supportMeta.styleAlignment?.tailorInterpretation,
                  'Explain the planned interpretation before cutting.'
                )}
              </p>
            </div>
            {supportMeta.styleAlignment?.status === 'CHANGES_REQUESTED' && styleChangeFeedback ? (
              <button
                type="button"
                onClick={() => setShowStyleChangeFeedback(true)}
                className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
                aria-haspopup="dialog"
              >
                View changes
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                window.requestAnimationFrame(() =>
                  document
                    .getElementById('tailor-style-alignment')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                )
              }
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
            >
              {supportMeta.styleAlignment?.status === 'CHANGES_REQUESTED'
                ? 'Send updated style plan'
                : 'Update style plan'}
            </button>
          </div>
        ) : null}
        {showTailorStyleApproved ? (
          <div
            className="flex items-start gap-3 rounded-[8px] border border-needle/20 bg-needle/8 p-4"
            role="status"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-needle text-white">
              <CheckCheck className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-needle">Style plan approved</h3>
              <p className="mt-1 text-sm leading-6 text-ink/68">
                The customer approved your interpretation. Continue once the remaining pre-cutting
                checks are clear.
              </p>
            </div>
          </div>
        ) : null}
        {showFabricChangeFeedback && fabricChangeFeedback ? (
          <div
            className="fixed inset-0 z-[100] grid place-items-end bg-ink/45 p-3 backdrop-blur-sm sm:place-items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fabric-change-feedback-title"
            onMouseDown={() => setShowFabricChangeFeedback(false)}
          >
            <div
              className="max-h-[75vh] w-full max-w-lg overflow-y-auto rounded-[16px] bg-white p-5 shadow-2xl sm:p-6"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
                    Customer feedback
                  </p>
                  <h3
                    id="fabric-change-feedback-title"
                    className="mt-1 text-xl font-semibold text-ink"
                  >
                    Requested fabric changes
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFabricChangeFeedback(false)}
                  className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border border-ink/10 text-ink transition-colors duration-200 hover:bg-bone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
                  aria-label="Close requested fabric changes"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 text-ink/78">
                {safeUserText(fabricChangeFeedback.feedback, 'No feedback was provided.')}
              </p>
            </div>
          </div>
        ) : null}
        {showStyleChangeFeedback && styleChangeFeedback ? (
          <div
            className="fixed inset-0 z-[100] grid place-items-end bg-ink/45 p-3 backdrop-blur-sm sm:place-items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tailor-style-change-feedback-title"
            onMouseDown={() => setShowStyleChangeFeedback(false)}
          >
            <div
              className="max-h-[75vh] w-full max-w-lg overflow-y-auto rounded-[16px] bg-white p-5 shadow-2xl sm:p-6"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
                    Customer feedback
                  </p>
                  <h3
                    id="tailor-style-change-feedback-title"
                    className="mt-1 text-xl font-semibold text-ink"
                  >
                    Requested style clarification
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStyleChangeFeedback(false)}
                  className="grid size-10 shrink-0 place-items-center rounded-full border border-ink/10 text-ink"
                  aria-label="Close requested style clarification"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 text-ink/78">
                {safeUserText(styleChangeFeedback.feedback, 'No feedback was provided.')}
              </p>
            </div>
          </div>
        ) : null}
        {tailorCanScheduleConsultation ? (
          <div
            id={`order-consultation-${order.id}`}
            className="grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4"
            tabIndex={-1}
          >
            <div>
              <h3 className="text-xl font-semibold text-ink">
                {consultationRequestedByCustomer
                  ? 'Approve consultation request'
                  : 'Schedule consultation'}
              </h3>
              {consultationRequestedByCustomer ? (
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  Customer requested {proposedConsultationLabel ?? 'a consultation time'} before
                  quote.
                  {consultationMeta?.requestNote
                    ? ` ${safeUserText(consultationMeta.requestNote, '')}`
                    : ''}
                </p>
              ) : (
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  Use this when a quote needs a live fit, scope, or fabric discussion first.
                </p>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="datetime-local"
                value={consultationStart}
                min={dateToDatetimeLocal(
                  recommendedSchedulingStartDate({ minLookaheadMinutes: 60 })
                )}
                onChange={(event) => {
                  setConsultationStart(event.target.value)
                  setConsultationStartSuggestion(null)
                }}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
              />
              {publishedConsultationCallType === 'AUDIO_OR_VIDEO' && !consultationMeta?.callType ? (
                <select
                  value={consultationCallType}
                  onChange={(event) =>
                    setConsultationCallType(event.target.value as 'AUDIO' | 'VIDEO')
                  }
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  aria-label="Consultation call type"
                >
                  <option value="AUDIO">Audio call</option>
                  <option value="VIDEO">Video call</option>
                </select>
              ) : (
                <div className="rounded-[8px] border border-needle/12 bg-needle/5 px-3 py-2 text-sm text-ink">
                  {consultationCallType === 'AUDIO' ? 'Audio' : 'Video'} ·{' '}
                  {data.tailorProfile?.consultation_duration_minutes ?? 30} minutes
                  {data.tailorProfile?.consultation_mode === 'PAID' &&
                  data.tailorProfile.consultation_fee_amount
                    ? ` · ${formatMoney(data.tailorProfile.consultation_fee_amount, data.tailorProfile.consultation_currency ?? quoteCurrency)}`
                    : ' · Free'}
                </div>
              )}
            </div>
            {consultationStartSuggestion ? (
              <button
                type="button"
                onClick={() => {
                  setConsultationStart(consultationStartSuggestion.value)
                  setConsultationStartSuggestion(null)
                  setError(null)
                }}
                className="w-fit rounded-[8px] border border-needle/20 bg-needle/8 px-3 py-2 text-sm font-semibold text-needle"
              >
                Use {consultationStartSuggestion.label}
              </button>
            ) : null}
            <p className="text-xs leading-5 text-ink/54">
              Your published terms apply. Drapeon sends reminders; unanswered customer requests
              expire after 48 hours.
            </p>
            <textarea
              value={consultationNote}
              onChange={(event) => setConsultationNote(event.target.value)}
              rows={2}
              placeholder="Optional consultation note"
              className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void saveConsultation(
                    consultationRequestedByCustomer
                      ? 'approve-consultation'
                      : 'request-consultation'
                  )
                }}
                disabled={busy === 'consultation-approve' || busy === 'consultation-schedule'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busy === 'consultation-approve' || busy === 'consultation-schedule'
                  ? 'Saving...'
                  : consultationRequestedByCustomer
                    ? 'Approve consultation'
                    : 'Schedule consultation'}
              </button>
              {consultationRequestedByCustomer ? (
                <button
                  type="button"
                  onClick={() => {
                    void declineConsultation()
                  }}
                  disabled={busy === 'consultation-decline'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:bg-ink/5 disabled:text-ink/38"
                >
                  {busy === 'consultation-decline' ? 'Declining...' : 'Decline'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? '') || quoteTaxNeedsRefresh ? (
          <div className="grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4">
            <h3 className="text-xl font-semibold text-ink">
              {quoteTaxNeedsRefresh ? 'Refresh quote tax' : 'Send quote'}
            </h3>
            <p className="text-sm leading-6 text-ink/62">
              {quoteTaxNeedsRefresh
                ? 'Your tailoring and fabric amounts are preserved. Review them, then resend to apply the current Ghana VAT, NHIL, and GETFund rates.'
                : fundedFabricQuote
                  ? 'Separate tailoring from fabric so the customer sees exactly what each protected amount covers.'
                  : 'Add the seller amount and delivery date.'}
            </p>
            {quoteDraftStatus ? (
              <p className="text-xs font-semibold text-needle" aria-live="polite">
                {quoteDraftStatus}
              </p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-3">
              {fundedFabricQuote ? (
                <>
                  <MoneyInput
                    id={`quote-tailoring-${order.id}`}
                    label="Tailoring and construction"
                    value={quoteTailoringAmount}
                    onValueChange={setQuoteTailoringAmount}
                    currency={lockedQuoteCurrency as AccountCurrencyCode}
                    required
                  />
                  {tailorSourcesFabric ? (
                    <MoneyInput
                      id={`quote-fabric-${order.id}`}
                      label="Fabric allowance"
                      value={quoteFabricAllowanceAmount}
                      onValueChange={setQuoteFabricAllowanceAmount}
                      currency={lockedQuoteCurrency as AccountCurrencyCode}
                      required
                      hint="Held for approved, evidenced fabric costs. Any unused amount returns to the customer."
                    />
                  ) : (
                    <div className="rounded-[8px] border border-needle/12 bg-needle/5 px-3 py-2 text-sm text-ink/62">
                      Customer supplies fabric · allowance fixed at zero
                    </div>
                  )}
                </>
              ) : (
                <MoneyInput
                  id={`quote-amount-${order.id}`}
                  label="Quote amount"
                  value={quoteAmount}
                  onValueChange={setQuoteAmount}
                  currency={lockedQuoteCurrency as AccountCurrencyCode}
                  required
                />
              )}
              <input
                value={lockedQuoteCurrency}
                disabled
                aria-label="Quote currency locked to order currency"
                className="rounded-full border border-ink/10 bg-bone/50 px-4 py-3 text-sm font-semibold text-ink/62 outline-none"
              />
              <input
                type="date"
                value={completionDate}
                onChange={(event) => setCompletionDate(event.target.value)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
              />
            </div>
            {fundedFabricQuote && tailorSourcesFabric ? (
              <div className="grid gap-3 rounded-[8px] border border-needle/12 bg-bone/45 p-4">
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-semibold text-ink">Allowance covers</legend>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['FABRIC', 'Fabric'],
                        ['LINING', 'Lining'],
                        ['EMBROIDERY', 'Embroidery'],
                        ['TRIMS', 'Trims'],
                        ['NOTIONS', 'Notions'],
                        ['OTHER_AGREED_MATERIAL', 'Other agreed material'],
                      ] as const
                    ).map(([code, label]) => {
                      const selected = quoteFabricCoverage.includes(code)
                      return (
                        <button
                          key={code}
                          type="button"
                          role="checkbox"
                          aria-checked={selected}
                          onClick={() =>
                            setQuoteFabricCoverage((current) =>
                              selected
                                ? current.filter((item) => item !== code)
                                : [...current, code]
                            )
                          }
                          className={`rounded-full border px-3 py-2 text-sm font-semibold ${selected ? 'border-needle/30 bg-needle/10 text-needle' : 'border-ink/10 bg-white text-ink/62'}`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
                <label className="grid gap-1.5 text-sm font-semibold text-ink">
                  Sourcing assumptions
                  <textarea
                    value={quoteFabricAssumptions}
                    onChange={(event) => setQuoteFabricAssumptions(event.target.value)}
                    rows={3}
                    placeholder="Quantity, quality, supplier estimate, lining or trim assumptions..."
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 font-normal text-ink outline-none focus:border-needle/50"
                  />
                </label>
                <div className="flex items-center justify-between border-t border-ink/8 pt-3">
                  <span className="text-sm font-semibold text-ink">Seller subtotal</span>
                  <strong>
                    {formatMoney(
                      (parseMoneyInputToMinorUnits(quoteTailoringAmount) ?? 0) +
                        (parseMoneyInputToMinorUnits(quoteFabricAllowanceAmount) ?? 0),
                      lockedQuoteCurrency
                    )}
                  </strong>
                </div>
                <p className="text-xs leading-5 text-ink/55">
                  The allowance is protected for approved material costs and is not immediate
                  earnings. Any unused allowance is returned to the customer.
                </p>
              </div>
            ) : null}
            <textarea
              value={quoteNote}
              onChange={(event) => setQuoteNote(event.target.value)}
              rows={2}
              placeholder="Optional quote note"
              className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-[8px] border p-4 text-sm leading-6 ${quoteOrderReviewed ? 'border-needle/25 bg-needle/8 text-ink' : 'border-ink/10 bg-bone/45 text-ink/68'}`}
            >
              <input
                type="checkbox"
                checked={quoteOrderReviewed}
                onChange={(event) => setQuoteOrderReviewed(event.target.checked)}
                className="mt-1 size-4 accent-needle"
              />
              <span>{QUOTE_ORDER_REVIEW_COPY}</span>
            </label>
            {quoteSubmitBlockedReason ? (
              <p className="text-center text-xs leading-5 text-ink/58" aria-live="polite">
                {quoteSubmitBlockedReason}
              </p>
            ) : null}
            <div className="sticky bottom-4 z-20 rounded-full border border-ink/8 bg-white/92 p-1.5 shadow-[0_18px_45px_rgba(22,28,24,0.16)] backdrop-blur">
              <button
                type="button"
                onClick={sendQuote}
                disabled={busy === 'quote' || !!quoteSubmitBlockedReason}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-needle px-5 py-3 text-sm font-semibold text-white transition hover:bg-needle-600 disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45"
              >
                {busy === 'quote'
                  ? 'Sending...'
                  : quoteTaxNeedsRefresh
                    ? 'Refresh quote'
                    : 'Send quote'}
              </button>
            </div>
            <p className="text-xs leading-5 text-ink/52">
              Your quote saves automatically and follows this order across Drapeon.
            </p>
          </div>
        ) : null}
        {canRequestMeasurementConfirmation ||
        canConfirmFitReadiness ||
        canRequestStyleAlignment ||
        canConfirmFabricReceived ||
        canOpenMaterialIssue ? (
          <DisclosurePanel
            title="Pre-cutting checks"
            summary="Resolve fit, style, and fabric blockers before cutting starts."
          >
            <div className="grid gap-4">
              {canRequestMeasurementConfirmation ? (
                <div className="grid gap-3">
                  <h3 className="font-semibold text-ink">Request measurement confirmation</h3>
                  <input
                    value={measurementFields}
                    onChange={(event) => setMeasurementFields(event.target.value)}
                    placeholder="Optional fields, comma separated"
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <textarea
                    value={measurementNote}
                    onChange={(event) => setMeasurementNote(event.target.value)}
                    rows={2}
                    placeholder="What should the customer confirm?"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void requestMeasurementConfirmation()
                    }}
                    disabled={busy === 'request-measurement-confirmation'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'request-measurement-confirmation'
                      ? 'Sending...'
                      : 'Request confirmation'}
                  </button>
                </div>
              ) : null}

              {canConfirmFitReadiness ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Confirm fit readiness</h3>
                  <textarea
                    value={fitReadinessNote}
                    onChange={(event) => setFitReadinessNote(event.target.value)}
                    rows={2}
                    placeholder="What did you verify?"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void confirmFitReadiness()
                    }}
                    disabled={busy === 'confirm-fit-readiness'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'confirm-fit-readiness' ? 'Confirming...' : 'Confirm fit readiness'}
                  </button>
                </div>
              ) : null}

              {canRequestStyleAlignment ? (
                <div
                  id="tailor-style-alignment"
                  className="grid scroll-mt-28 gap-3 border-t border-ink/6 pt-4"
                >
                  <h3 className="font-semibold text-ink">Style alignment</h3>
                  <textarea
                    value={styleAlignmentNote}
                    onChange={(event) => setStyleAlignmentNote(event.target.value)}
                    rows={3}
                    placeholder="Explain what can be matched from the references before cutting."
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void requestStyleAlignment()
                    }}
                    disabled={busy === 'request-style-alignment'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'request-style-alignment' ? 'Sending...' : 'Send style alignment'}
                  </button>
                </div>
              ) : null}

              {canConfirmFabricReceived ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Confirm customer fabric</h3>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                    onChange={(event) => setFabricReceiptFile(event.target.files?.[0] ?? null)}
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm file:mr-4 file:rounded-[6px] file:border-0 file:bg-bone file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
                  />
                  <textarea
                    value={fabricReceiptNote}
                    onChange={(event) => setFabricReceiptNote(event.target.value)}
                    rows={2}
                    placeholder="Optional fabric receipt note"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void confirmFabricReceived()
                    }}
                    disabled={busy === 'confirm-fabric-received'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'confirm-fabric-received'
                      ? 'Confirming...'
                      : 'Confirm fabric received'}
                  </button>
                </div>
              ) : null}

              {canOpenMaterialIssue ? (
                <div className="grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Material issue</h3>
                  <select
                    value={materialIssueReason}
                    onChange={(event) =>
                      setMaterialIssueReason(event.target.value as typeof materialIssueReason)
                    }
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    {MATERIAL_ISSUE_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={materialIssueNote}
                    onChange={(event) => setMaterialIssueNote(event.target.value)}
                    rows={2}
                    placeholder="Describe the fabric issue."
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void openMaterialIssue()
                    }}
                    disabled={busy === 'open-material-issue'}
                    className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'open-material-issue' ? 'Opening...' : 'Open material issue'}
                  </button>
                </div>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestScopeChange ? (
          <DisclosurePanel
            title="Order change request"
            summary="Propose a formal scope, price, deadline, fabric, or fit change."
          >
            <div className="grid gap-3">
              <select
                value={scopeChangeType}
                onChange={(event) =>
                  setScopeChangeType(event.target.value as typeof scopeChangeType)
                }
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
              >
                {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/68"
                  >
                    <input
                      type="checkbox"
                      checked={scopeChangeImpacts.includes(option.value)}
                      onChange={() => toggleScopeImpact(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <textarea
                value={scopeChangeSummary}
                onChange={(event) => setScopeChangeSummary(event.target.value)}
                rows={3}
                placeholder="What changed?"
                className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  inputMode="decimal"
                  value={scopePriceImpact}
                  onChange={(event) => setScopePriceImpact(event.target.value)}
                  placeholder={`Added price (${quoteCurrency})`}
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={scopeDeadlineImpact}
                  onChange={(event) => setScopeDeadlineImpact(event.target.value)}
                  placeholder="Deadline impact"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  void requestScopeChange()
                }}
                disabled={busy === 'request-scope-change'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busy === 'request-scope-change' ? 'Sending...' : 'Send change request'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondScopeChange || canCancelScopeChange ? (
          <DisclosurePanel
            title="Open change request"
            summary={
              supportMeta.scopeChange?.summary ??
              'Review the open change request before production continues.'
            }
            defaultOpen
          >
            <div className="grid gap-3">
              {supportMeta.scopeChange?.impacts?.length ? (
                <p className="text-sm leading-6 text-ink/62">
                  Affects:{' '}
                  {supportMeta.scopeChange.impacts.map((impact) => cleanLabel(impact)).join(', ')}
                </p>
              ) : null}
              {typeof supportMeta.scopeChange?.priceImpactMinor === 'number' &&
              supportMeta.scopeChange.priceImpactMinor !== 0 ? (
                <p className="text-sm leading-6 text-ink/62">
                  Price impact:{' '}
                  {formatMoney(
                    Math.abs(supportMeta.scopeChange.priceImpactMinor),
                    order.quoted_currency ?? order.currency
                  )}
                </p>
              ) : null}
              {supportMeta.scopeChange?.deadlineImpact ? (
                <p className="text-sm leading-6 text-ink/62">
                  Deadline: {safeUserText(supportMeta.scopeChange.deadlineImpact, '')}
                </p>
              ) : null}
              <textarea
                value={tailorScopeChangeResponseNote}
                onChange={(event) => setTailorScopeChangeResponseNote(event.target.value)}
                rows={2}
                placeholder="Optional response note"
                className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
              />
              {canRespondScopeChange ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      void respondTailorScopeChange('ACCEPTED')
                    }}
                    disabled={busy === 'respond-scope-change'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busy === 'respond-scope-change' ? 'Saving...' : 'Accept change'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void respondTailorScopeChange('DECLINED')
                    }}
                    disabled={busy === 'respond-scope-change'}
                    className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'respond-scope-change' ? 'Saving...' : 'Decline change'}
                  </button>
                </div>
              ) : null}
              {canCancelScopeChange ? (
                <button
                  type="button"
                  onClick={() => {
                    void respondTailorScopeChange('CANCELLED')
                  }}
                  disabled={busy === 'respond-scope-change'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busy === 'respond-scope-change' ? 'Cancelling...' : 'Cancel proposal'}
                </button>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}

        {stageOptions.length > 0 || fabricApprovalMode ? (
          <div
            id="tailor-stage-update"
            className="scroll-mt-28 grid gap-3 rounded-[8px] border border-ink/8 bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-ink">
                  {fabricApprovalMode
                    ? 'Submit exact fabric for approval'
                    : selectedTargetStage === order.stage
                      ? 'Add sourcing progress'
                      : 'Update production stage'}
                </h3>
                {fabricApprovalMode ? (
                  <p className="mt-1 text-sm leading-6 text-ink/58">
                    This is separate from sourcing progress. Upload only the exact fabric the
                    customer is being asked to approve.
                  </p>
                ) : null}
              </div>
              {fabricApprovalMode ? (
                <button
                  type="button"
                  onClick={() => {
                    setFabricApprovalMode(false)
                    setStageNote('')
                    setStageMediaFiles([])
                  }}
                  className="text-sm font-semibold text-needle"
                >
                  Cancel
                </button>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-[0.8fr_1.2fr]">
              {fabricApprovalMode ? (
                <div className="rounded-[8px] border border-needle/14 bg-needle/6 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-needle/75">
                    Customer decision
                  </p>
                  <p className="mt-1 font-semibold text-ink">Fabric approval</p>
                </div>
              ) : (
                <select
                  value={selectedTargetStage}
                  onChange={(event) => {
                    setFabricApprovalMode(false)
                    setTargetStage(event.target.value)
                  }}
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                >
                  {stageOptions.map((stageOption) => (
                    <option key={stageOption} value={stageOption}>
                      {stageOption === order.stage
                        ? `${cleanLabel(stageOption)} · add update`
                        : cleanLabel(stageOption)}
                    </option>
                  ))}
                </select>
              )}
              <div className="grid gap-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="inline-flex cursor-pointer justify-center rounded-full border border-needle/16 bg-needle/8 px-4 py-3 text-sm font-semibold text-needle">
                    Take fresh proof
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                      capture="environment"
                      onChange={(event) => {
                        void addStageMedia(event.target.files)
                      }}
                      className="sr-only"
                    />
                  </label>
                  <label className="inline-flex cursor-pointer justify-center rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink">
                    Attach media
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                      multiple
                      onChange={(event) => {
                        void addStageMedia(event.target.files)
                      }}
                      className="sr-only"
                    />
                  </label>
                </div>
                <p className="text-xs leading-5 text-ink/52">
                  {fabricApprovalMode
                    ? 'Show the exact fabric in natural light, including its color and weave. Do not use a market visit, supplier search, or general sourcing update here.'
                    : 'Use fresh progress proof. Sourcing updates can show a market visit, supplier options, or the search in progress. Tap a preview to inspect, replace, or remove it before submitting.'}
                </p>
                {stageMediaFiles.length > 0 ? (
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full bg-bone px-3 py-1 text-xs font-semibold text-ink/62">
                        {stageMediaFiles.length} proof item{stageMediaFiles.length === 1 ? '' : 's'}{' '}
                        selected
                      </span>
                      <button
                        type="button"
                        onClick={() => setStageMediaFiles([])}
                        className="text-xs font-semibold text-needle"
                      >
                        Remove all
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {stageMediaFiles.map((file, index) => (
                        <LocalEvidencePreview
                          key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                          file={file}
                          index={index}
                          onRemove={() =>
                            setStageMediaFiles((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index)
                            )
                          }
                          onReplace={(replacement) => {
                            void replaceStageMedia(index, replacement)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            {selectedTargetNeedsDispatchMeta ? (
              <div className="grid gap-3 rounded-[8px] border border-needle/12 bg-needle/6 p-3 md:grid-cols-2">
                <input
                  value={stageFulfillmentProvider}
                  onChange={(event) => setStageFulfillmentProvider(event.target.value)}
                  placeholder="Fulfillment provider"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageFulfillmentReference}
                  onChange={(event) => setStageFulfillmentReference(event.target.value)}
                  placeholder="Fulfillment reference"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageTrackingNumber}
                  onChange={(event) => setStageTrackingNumber(event.target.value)}
                  placeholder="Tracking number"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <input
                  value={stageFulfillmentContactName}
                  onChange={(event) => setStageFulfillmentContactName(event.target.value)}
                  placeholder="Dispatch contact name"
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
                />
                <PhoneNumberField
                  value={stageFulfillmentContactPhone}
                  onValueChange={setStageFulfillmentContactPhone}
                  placeholder="Dispatch contact phone"
                  containerClassName="md:col-span-2"
                />
              </div>
            ) : null}
            <textarea
              value={stageNote}
              onChange={(event) => setStageNote(event.target.value)}
              rows={2}
              placeholder={
                fabricApprovalMode
                  ? 'Describe the exact fabric selection the customer is reviewing'
                  : 'Tell the customer what changed'
              }
              className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
            />
            <button
              type="button"
              onClick={advanceStage}
              disabled={busy === 'stage'}
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
            >
              {busy === 'stage'
                ? 'Saving...'
                : fabricApprovalMode
                  ? 'Send for customer approval'
                  : selectedTargetStage === order.stage
                    ? 'Post sourcing update'
                    : 'Update stage'}
            </button>
          </div>
        ) : null}

        {canConfirmCollection ? (
          <DisclosurePanel
            title="Confirm collection"
            summary="Enter the customer pickup code to close local collection."
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                value={pickupCode}
                onChange={(event) =>
                  setPickupCode(event.target.value.replace(/\D/g, '').slice(0, 4))
                }
                inputMode="numeric"
                placeholder="4-digit pickup code"
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm text-ink outline-none focus:border-needle/50"
              />
              <button
                type="button"
                onClick={() => {
                  void confirmCollection()
                }}
                disabled={busy === 'confirm-collection'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busy === 'confirm-collection' ? 'Confirming...' : 'Confirm collection'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canDeclineOrder || canRequestCancellationReview || canRequestDeliveryReview ? (
          <DisclosurePanel
            title="Help & order options"
            summary="Shipping support, decline, and reviewed cancellation options stay secondary to the current production action."
          >
            <div className="grid gap-4">
              {canDeclineOrder ? (
                <div className="order-[30] grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Decline order</h3>
                  <textarea
                    value={declineNote}
                    onChange={(event) => setDeclineNote(event.target.value)}
                    rows={2}
                    placeholder="Optional note"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void declineOrder()
                    }}
                    disabled={busy === 'decline-order'}
                    className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'decline-order'
                      ? 'Declining...'
                      : declineArmed
                        ? 'Confirm decline'
                        : 'Decline order'}
                  </button>
                </div>
              ) : null}

              {canRequestCancellationReview ? (
                <div className="order-[40] grid gap-3 border-t border-ink/6 pt-4">
                  <h3 className="font-semibold text-ink">Cancellation review</h3>
                  <select
                    value={tailorCancellationReason}
                    onChange={(event) =>
                      setTailorCancellationReason(
                        event.target.value as typeof tailorCancellationReason
                      )
                    }
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    {TAILOR_CANCELLATION_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={tailorCancellationNote}
                    onChange={(event) => setTailorCancellationNote(event.target.value)}
                    rows={2}
                    placeholder="Add context for Drapeon."
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void requestTailorCancellationReview()
                    }}
                    disabled={busy === 'request-cancellation-review'}
                    className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'request-cancellation-review'
                      ? 'Opening...'
                      : 'Open cancellation review'}
                  </button>
                </div>
              ) : null}

              {canRequestDeliveryReview ? (
                <div className="order-[20] grid gap-3">
                  <h3 className="font-semibold text-ink">Shipping &amp; delivery help</h3>
                  <select
                    value={tailorDeliveryReason}
                    onChange={(event) =>
                      setTailorDeliveryReason(event.target.value as typeof tailorDeliveryReason)
                    }
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-needle/50"
                  >
                    {TAILOR_DELIVERY_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={tailorDeliveryNote}
                    onChange={(event) => setTailorDeliveryNote(event.target.value)}
                    rows={2}
                    placeholder="What went wrong with dispatch or delivery?"
                    className="resize-none rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:border-needle/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void requestTailorDeliveryReview()
                    }}
                    disabled={busy === 'request-delivery-review'}
                    className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
                  >
                    {busy === 'request-delivery-review' ? 'Sending...' : 'Send to Drapeon'}
                  </button>
                </div>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}
      </div>
    </section>
  )
}

const CUSTOMER_SELF_CANCEL_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
])

const CUSTOMER_CANCELLATION_REVIEW_STAGES = new Set([
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'FINISHING',
])

const CUSTOMER_DISPUTE_STAGES = new Set([
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'OUT_FOR_DELIVERY',
  'SHIPPED',
  'READY_FOR_COLLECTION',
])

const CUSTOMER_RECEIPT_STAGES = new Set(['SHIPPED', 'OUT_FOR_DELIVERY'])

const CUSTOMER_COMPLETE_STAGES = new Set(['DELIVERED', 'COLLECTED'])

const CUSTOMER_AFTERCARE_STAGES = new Set(['DELIVERED', 'COLLECTED', 'COMPLETE'])

const CUSTOMER_FABRIC_TRACKING_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
])

const MATERIAL_ISSUE_RESPONSE_OPTIONS = [
  { value: 'REPLACE_FABRIC', label: 'I will replace the fabric' },
  { value: 'ASK_TAILOR_TO_SOURCE', label: 'Ask tailor to source fabric' },
  { value: 'REVISE_DESIGN', label: 'Revise the design' },
  { value: 'CANCEL_ORDER', label: 'Request cancellation review' },
] as const

function orderNeedsMeasurementConfirmation(order: AccountOrder) {
  return measurementSnapshotForOrder(order)?.needsConfirmation === true
}

type CustomerOrderActionName =
  | 'confirm-measurements'
  | 'cancel-order'
  | 'request-cancellation-review'
  | 'request-delivery-review'
  | 'approve-style-alignment'
  | 'request-style-alignment-change'
  | 'approve-sourced-fabric'
  | 'request-sourced-fabric-change'
  | 'respond-material-issue'
  | 'request-scope-change'
  | 'respond-scope-change'
  | 'open-dispute'
  | 'confirm-receipt'
  | 'complete-order'
  | 'request-aftercare-support'
  | 'request-emergency-support'
  | 'save-fabric-tracking'

const CUSTOMER_CANCELLATION_REASON_OPTIONS = [
  { value: 'CUSTOMER_CHANGED_MIND', label: 'Changed my mind' },
  { value: 'NEED_FULFILLMENT_CHANGE', label: 'Need pickup or delivery changed' },
  { value: 'OTHER', label: 'Other' },
] as const

const CUSTOMER_DELIVERY_REASON_OPTIONS = [
  { value: 'TRACKING_STALLED', label: 'Tracking has stopped updating' },
  { value: 'SIGNIFICANT_DELAY', label: 'Delivery is significantly delayed' },
  { value: 'NOT_RECEIVED', label: 'Order was not received' },
  { value: 'WRONG_ADDRESS_OR_RECIPIENT', label: 'Delivered to the wrong address or person' },
  { value: 'DAMAGED_IN_TRANSIT', label: 'Parcel was damaged in transit' },
  { value: 'MISSING_CONTENTS', label: 'Something is missing from the parcel' },
  { value: 'RETURNED_TO_DRAPEON', label: 'Parcel was returned to Drapeon' },
  { value: 'CUSTOMS_OR_CARRIER_CHARGE', label: 'Unexpected customs or carrier charge' },
  { value: 'RECIPIENT_CONTACT_PROBLEM', label: 'Courier could not reach the recipient' },
  { value: 'OTHER', label: 'Other' },
] as const

const CUSTOMER_AFTERCARE_OPTIONS = [
  { value: 'FIT_ISSUE', label: 'Fit issue' },
  { value: 'FINISH_ISSUE', label: 'Finish issue' },
  { value: 'DAMAGE_OR_DEFECT', label: 'Damage or defect' },
  { value: 'ALTERATION_FOLLOW_UP', label: 'Alteration follow-up' },
  { value: 'OTHER', label: 'Other' },
] as const

export function CustomerOrderActions({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: OrderDetailRenderData
  onRefresh: () => void
}) {
  const stage = order.stage ?? ''
  const booking = data.consultationBooking
  const supportMeta = supportMetaWithConsultationBooking(order.special_note, booking)
  const latestSourcedFabricEvidence = latestFabricApprovalEvidence(
    productionEvidenceFor(order.id, data.productionEvidence)
  )
  const sourcedFabricProofUrls = Array.from(
    new Set(stringList(latestSourcedFabricEvidence?.photo_urls))
  )
  const viewerIsCustomer = order.customer_id === data.userId
  const canConfirmMeasurements = orderNeedsMeasurementConfirmation(order)
  const canRespondStyleAlignment =
    order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.requiredBeforeCutting === true &&
    supportMeta.styleAlignment.status === 'PENDING_CUSTOMER_APPROVAL'
  const styleChangeFeedback = styleAlignmentChangeFeedbackFromUpdates(
    stageUpdatesFor(order.id, data.stageUpdates)
  )
  const showStyleClarification =
    order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.status === 'CHANGES_REQUESTED'
  const showStyleApproved =
    order.order_kind === 'CUSTOM' &&
    PRE_CUTTING_STAGES.has(stage) &&
    supportMeta.styleAlignment?.status === 'APPROVED'
  const canRespondSourcedFabric =
    order.order_kind === 'CUSTOM' &&
    order.fabric_funding_policy_version !== FABRIC_FUNDING_POLICY_V2_VERSION &&
    order.fabric_source === 'TAILOR_SOURCES' &&
    PRE_CUTTING_STAGES.has(stage) &&
    data.customOrderDetail?.fabric_approval_required === true &&
    data.customOrderDetail.fabric_approval_status === 'PENDING_CUSTOMER_APPROVAL'
  const canRespondMaterialIssue =
    PRE_CUTTING_STAGES.has(stage) && supportMeta.materialIssue?.status === 'OPEN'
  const scopeChangeOpen = supportMeta.scopeChange?.status === 'OPEN'
  const cancellationReviewOpen = supportMeta.cancellationReview?.status === 'OPEN'
  const deliveryReviewOpen = supportMeta.deliveryReview?.status === 'OPEN'
  const canRequestScopeChange =
    order.order_kind === 'CUSTOM' &&
    SCOPE_CHANGE_STAGES.has(stage) &&
    !scopeChangeOpen &&
    !cancellationReviewOpen &&
    !deliveryReviewOpen
  const canRespondScopeChange =
    SCOPE_CHANGE_STAGES.has(stage) &&
    scopeChangeOpen &&
    supportMeta.scopeChange?.requestedBy === 'TAILOR'
  const canCancelScopeChange =
    scopeChangeOpen && supportMeta.scopeChange?.requestedBy === 'CUSTOMER'
  const canSelfCancel = CUSTOMER_SELF_CANCEL_STAGES.has(stage)
  const canRequestCancellationReview =
    CUSTOMER_CANCELLATION_REVIEW_STAGES.has(stage) && !cancellationReviewOpen
  const initialPaymentLikelyPaid = ![
    'PENDING_QUOTE',
    'CONSULTATION',
    'QUOTE_SENT',
    'PAYMENT_PENDING',
    'PAYMENT_FAILED',
    'DECLINED',
    'EXPIRED',
  ].includes(stage)
  const completedOrder = isCompletedOrderStage(stage)
  const canRequestDeliveryReview =
    initialPaymentLikelyPaid && !deliveryReviewOpen && stage !== 'IN_DISPUTE' && !completedOrder
  const canOpenDispute = CUSTOMER_DISPUTE_STAGES.has(stage)
  const canConfirmReceipt = CUSTOMER_RECEIPT_STAGES.has(stage)
  const canCompleteOrder = CUSTOMER_COMPLETE_STAGES.has(stage)
  const canRequestAftercare = CUSTOMER_AFTERCARE_STAGES.has(stage)
  const canRequestEmergencySupport = !completedOrder && !isTerminalOrder(order)
  const canSaveFabricTracking =
    order.fabric_source === 'CUSTOMER_SUPPLIES' && CUSTOMER_FABRIC_TRACKING_STAGES.has(stage)
  const hasActions =
    canConfirmMeasurements ||
    canRespondStyleAlignment ||
    showStyleClarification ||
    showStyleApproved ||
    canRespondSourcedFabric ||
    canRespondMaterialIssue ||
    canRequestScopeChange ||
    canRespondScopeChange ||
    canCancelScopeChange ||
    canSelfCancel ||
    canRequestCancellationReview ||
    canRequestDeliveryReview ||
    canOpenDispute ||
    canConfirmReceipt ||
    canCompleteOrder ||
    canRequestAftercare ||
    canRequestEmergencySupport ||
    canSaveFabricTracking

  const [busyAction, setBusyAction] = useState<CustomerOrderActionName | null>(null)
  const [cancelArmed, setCancelArmed] = useState(false)
  const [fabricTracking, setFabricTracking] = useState(order.fabric_tracking ?? '')
  const [styleChangeNote, setStyleChangeNote] = useState('')
  const [showStyleChangeFeedback, setShowStyleChangeFeedback] = useState(false)
  const [fabricChangeNote, setFabricChangeNote] = useState('')
  const [materialIssueResponse, setMaterialIssueResponse] =
    useState<(typeof MATERIAL_ISSUE_RESPONSE_OPTIONS)[number]['value']>('REPLACE_FABRIC')
  const [materialIssueNote, setMaterialIssueNote] = useState('')
  const [customerScopeChangeType, setCustomerScopeChangeType] =
    useState<(typeof SCOPE_CHANGE_TYPE_OPTIONS)[number]['value']>('STYLE_OR_REFERENCE')
  const [customerScopeChangeSummary, setCustomerScopeChangeSummary] = useState('')
  const [customerScopeChangeImpacts, setCustomerScopeChangeImpacts] = useState<string[]>([])
  const [scopeChangeDecision, setScopeChangeDecision] = useState<'ACCEPTED' | 'DECLINED'>(
    'ACCEPTED'
  )
  const [scopeChangeResponseNote, setScopeChangeResponseNote] = useState('')
  const [cancellationReason, setCancellationReason] =
    useState<(typeof CUSTOMER_CANCELLATION_REASON_OPTIONS)[number]['value']>(
      'CUSTOMER_CHANGED_MIND'
    )
  const [cancellationNote, setCancellationNote] = useState('')
  const [deliveryReason, setDeliveryReason] =
    useState<(typeof CUSTOMER_DELIVERY_REASON_OPTIONS)[number]['value']>('TRACKING_STALLED')
  const [deliveryNote, setDeliveryNote] = useState('')
  const [aftercareType, setAftercareType] =
    useState<(typeof CUSTOMER_AFTERCARE_OPTIONS)[number]['value']>('FIT_ISSUE')
  const [aftercareNote, setAftercareNote] = useState('')
  const [emergencyNote, setEmergencyNote] = useState('')
  const [disputeReason, setDisputeReason] = useState<CustomerConcernReason>('NOT_AS_DESCRIBED')
  const [disputeRequestedOutcome, setDisputeRequestedOutcome] =
    useState<FinancialCaseRequestedOutcome>('OPS_HELP')
  const [disputeDescription, setDisputeDescription] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!showStyleChangeFeedback) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowStyleChangeFeedback(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showStyleChangeFeedback])

  if (!viewerIsCustomer || !hasActions) return null

  async function runCustomerAction(
    action: CustomerOrderActionName,
    body: Record<string, unknown>,
    successMessage: string
  ) {
    setBusyAction(action)
    setError(null)
    setSuccess(null)
    try {
      await invokeAccountFunction('customer-order-action', {
        action,
        orderId: order.id,
        ...body,
      })
      setCancelArmed(false)
      setSuccess(successMessage)
      onRefresh()
    } catch (actionError) {
      setError(
        friendlyActionError(
          actionError,
          'This order action could not finish. Refresh the order and try again.'
        )
      )
      setSuccess(null)
    } finally {
      setBusyAction(null)
      setUploadStatus(null)
    }
  }

  async function confirmMeasurements() {
    await runCustomerAction(
      'confirm-measurements',
      {},
      'Measurements confirmed. The tailor can continue when the order stage allows it.'
    )
  }

  async function decideStyleAlignment(
    action: 'approve-style-alignment' | 'request-style-alignment-change'
  ) {
    const note = styleChangeNote.trim()
    const leak = assertNoContactLeak(note, "Style response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (action === 'request-style-alignment-change' && note.length < 5) {
      setError('Tell the tailor what needs to change before cutting.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      action,
      { note: action === 'request-style-alignment-change' ? note : undefined },
      action === 'approve-style-alignment'
        ? 'Style interpretation approved.'
        : 'Style clarification sent to the tailor.'
    )
    if (action === 'request-style-alignment-change') setStyleChangeNote('')
  }

  async function decideSourcedFabric(
    action: 'approve-sourced-fabric' | 'request-sourced-fabric-change'
  ) {
    const note = fabricChangeNote.trim()
    const leak = assertNoContactLeak(note, "Fabric response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (action === 'request-sourced-fabric-change' && note.length < 5) {
      setError('Tell the tailor what should change about the sourced fabric.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      action,
      { note: action === 'request-sourced-fabric-change' ? note : undefined },
      action === 'approve-sourced-fabric'
        ? 'Sourced fabric approved.'
        : 'Fabric change request sent to the tailor.'
    )
    if (action === 'request-sourced-fabric-change') setFabricChangeNote('')
  }

  async function respondMaterialIssue() {
    const note = materialIssueNote.trim()
    const leak = assertNoContactLeak(
      note,
      "Material issue response notes can't include contact details."
    )
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'respond-material-issue',
      { materialIssueResponse, note: note || undefined },
      'Material issue response sent to the tailor.'
    )
    setMaterialIssueNote('')
  }

  function toggleCustomerScopeImpact(value: string) {
    setCustomerScopeChangeImpacts((current) =>
      current.includes(value) ? current.filter((impact) => impact !== value) : [...current, value]
    )
  }

  async function requestCustomerScopeChange() {
    const summary = customerScopeChangeSummary.trim()
    const leak = assertNoContactLeak(summary, "Change requests can't include contact details.")
    setError(null)
    setSuccess(null)
    if (summary.length < 10) {
      setError('Describe what needs to change so the tailor has a clear record.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'request-scope-change',
      {
        scopeChangeType: customerScopeChangeType,
        scopeChangeSummary: summary,
        scopeChangeImpacts:
          customerScopeChangeImpacts.length > 0 ? customerScopeChangeImpacts : undefined,
      },
      'Change request sent to the tailor.'
    )
    setCustomerScopeChangeSummary('')
    setCustomerScopeChangeImpacts([])
  }

  async function respondScopeChange(decisionOverride?: 'ACCEPTED' | 'DECLINED' | 'CANCELLED') {
    const decision = decisionOverride ?? scopeChangeDecision
    const note = scopeChangeResponseNote.trim()
    const leak = assertNoContactLeak(note, "Change response notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'respond-scope-change',
      { scopeChangeDecision: decision, scopeChangeResponseNote: note || undefined },
      decision === 'ACCEPTED'
        ? 'Order change accepted.'
        : decision === 'DECLINED'
          ? 'Order change declined.'
          : 'Change request cancelled.'
    )
    setScopeChangeResponseNote('')
  }

  async function cancelOrder() {
    if (!cancelArmed) {
      setCancelArmed(true)
      setError(null)
      setSuccess('Click cancel order once more to close this order.')
      return
    }
    await runCustomerAction(
      'cancel-order',
      {},
      'Order cancelled. Any eligible refund review has started.'
    )
  }

  async function requestCancellationReview() {
    const note = cancellationNote.trim()
    const leak = assertNoContactLeak(
      note,
      "Cancellation review notes can't include contact details."
    )
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    await runCustomerAction(
      'request-cancellation-review',
      { cancellationReason, note: note || undefined },
      'Cancellation review opened. Drapeon will review the order timeline before handoff continues.'
    )
    setCancellationNote('')
  }

  async function requestDeliveryReview() {
    const note = deliveryNote.trim()
    const leak = assertNoContactLeak(note, "Delivery review notes can't include contact details.")
    if (leak) {
      setError(leak)
      setSuccess(null)
      return
    }
    await runCustomerAction(
      'request-delivery-review',
      { deliveryReason, note: note || undefined },
      'Shipping or delivery help recorded. Drapeon applied the appropriate risk protection and Ops follow-up.'
    )
    setDeliveryNote('')
  }

  async function openDispute() {
    const description = disputeDescription.trim()
    const leak = assertNoContactLeak(description, "Concern details can't include contact details.")
    setError(null)
    setSuccess(null)
    if (description.length < 10) {
      setError('Add a short description so Drapeon can understand what happened.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'open-dispute',
      { reason: disputeReason, requestedOutcome: disputeRequestedOutcome, description },
      'Concern opened. The order is paused for review.'
    )
    setDisputeDescription('')
  }

  async function confirmReceipt() {
    setError(null)
    setSuccess(null)
    if (!receiptFile) {
      setError('Add proof media before confirming receipt.')
      return
    }
    setBusyAction('confirm-receipt')
    try {
      setUploadStatus('Preparing proof media...')
      const preparedPhoto = await prepareOrderEvidenceFile(receiptFile)
      setUploadStatus('Uploading proof media...')
      const receiptPhotoUrl = await uploadPublicFile(
        'order-photos',
        `receipts/${order.id}`,
        preparedPhoto
      )
      await invokeAccountFunction('customer-order-action', {
        action: 'confirm-receipt',
        orderId: order.id,
        receiptPhotoUrl,
      })
      setReceiptFile(null)
      setSuccess('Receipt confirmed. You can review the order once the record refreshes.')
      onRefresh()
    } catch (receiptError) {
      setError(
        friendlyActionError(
          receiptError,
          'Receipt could not be confirmed. Try a smaller proof photo or MP4/MOV video up to 60 seconds.'
        )
      )
      setSuccess(null)
    } finally {
      setBusyAction(null)
      setUploadStatus(null)
    }
  }

  async function completeOrder() {
    await runCustomerAction('complete-order', {}, 'Order marked complete.')
  }

  async function requestAftercare() {
    const note = aftercareNote.trim()
    const leak = assertNoContactLeak(note, "Aftercare notes can't include contact details.")
    setError(null)
    setSuccess(null)
    if (note.length < 10) {
      setError('Add a short note about the fit, finish, or defect.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'request-aftercare-support',
      { aftercareType, note },
      'Aftercare request sent. Drapeon will review the fit or finish issue.'
    )
    setAftercareNote('')
  }

  async function requestEmergencySupport() {
    const description = emergencyNote.trim()
    const leak = assertNoContactLeak(
      description,
      "Emergency support notes can't include contact details."
    )
    setError(null)
    setSuccess(null)
    if (description.length < 10) {
      setError('Tell Drapeon what is wrong and when the event or wear date is.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'request-emergency-support',
      { description },
      'Emergency support request sent. Keep updates inside this order while Drapeon reviews it.'
    )
    setEmergencyNote('')
  }

  async function saveFabricTracking() {
    const value = fabricTracking.trim()
    const leak = assertNoContactLeak(value, "Tracking numbers can't include contact details.")
    setError(null)
    setSuccess(null)
    if (!value) {
      setError('Add the carrier tracking number before saving.')
      return
    }
    if (leak) {
      setError(leak)
      return
    }
    await runCustomerAction(
      'save-fabric-tracking',
      { fabricTracking: value },
      'Fabric tracking saved on this order.'
    )
  }

  return (
    <Surface id="portfolio" className="overflow-hidden scroll-mt-24">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
            Customer actions
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Manage this order.</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-ink/58">
          Actions shown here match the order stage and stay attached to the order record.
        </p>
      </div>
      <div className="mt-5 grid gap-3">
        <ActionNotice error={error} success={uploadStatus ?? success} />

        {canConfirmMeasurements ? (
          <DisclosurePanel
            title="Confirm measurements"
            summary="Let the tailor continue with the measurements attached to this order."
            defaultOpen
          >
            <div className="grid gap-3">
              <p className="text-sm leading-6 text-ink/62">
                Confirm only if these measurements are still correct. Cutting can stay paused until
                this is done.
              </p>
              <button
                type="button"
                onClick={() => {
                  void confirmMeasurements()
                }}
                disabled={busyAction === 'confirm-measurements'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'confirm-measurements' ? 'Confirming...' : 'Confirm measurements'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondStyleAlignment ? (
          <DisclosurePanel
            title="Style alignment"
            summary={
              supportMeta.styleAlignment?.tailorInterpretation ??
              'Review the tailor style interpretation before cutting.'
            }
            defaultOpen
          >
            <div className="grid gap-3">
              <textarea
                value={styleChangeNote}
                onChange={(event) => setStyleChangeNote(event.target.value)}
                placeholder="Optional change note if this needs clarification."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    void decideStyleAlignment('approve-style-alignment')
                  }}
                  disabled={busyAction === 'approve-style-alignment'}
                  className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                >
                  {busyAction === 'approve-style-alignment' ? 'Approving...' : 'Approve style'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void decideStyleAlignment('request-style-alignment-change')
                  }}
                  disabled={busyAction === 'request-style-alignment-change'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busyAction === 'request-style-alignment-change'
                    ? 'Sending...'
                    : 'Request clarification'}
                </button>
              </div>
            </div>
          </DisclosurePanel>
        ) : null}

        {showStyleClarification ? (
          <div className="grid gap-3 rounded-[8px] border border-rust/18 bg-rust/6 p-4">
            <div>
              <h3 className="text-lg font-semibold text-ink">Style clarification requested</h3>
              <p className="mt-1 line-clamp-3 text-sm leading-6 text-ink/62">
                {safeUserText(
                  supportMeta.styleAlignment?.tailorInterpretation,
                  'The tailor needs to send an updated style plan before cutting.'
                )}
              </p>
            </div>
            {styleChangeFeedback ? (
              <button
                type="button"
                onClick={() => setShowStyleChangeFeedback(true)}
                className="inline-flex w-fit cursor-pointer items-center gap-1 rounded-full border border-needle/20 bg-needle/8 px-3 py-1.5 text-xs font-semibold text-needle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35"
                aria-haspopup="dialog"
              >
                View changes
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
            <p className="text-sm leading-6 text-ink/62">
              The tailor must update the style plan before you can approve it.
            </p>
          </div>
        ) : null}

        {showStyleApproved ? (
          <div
            className="flex items-start gap-3 rounded-[8px] border border-needle/20 bg-needle/8 p-4"
            role="status"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-needle text-white">
              <CheckCheck className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-needle">Style plan approved</h3>
              <p className="mt-1 text-sm leading-6 text-ink/68">
                Your approved interpretation is recorded with this order before cutting.
              </p>
            </div>
          </div>
        ) : null}

        {showStyleChangeFeedback && styleChangeFeedback ? (
          <div
            className="fixed inset-0 z-[100] grid place-items-end bg-ink/45 p-3 backdrop-blur-sm sm:place-items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-style-change-feedback-title"
            onMouseDown={() => setShowStyleChangeFeedback(false)}
          >
            <div
              className="max-h-[75vh] w-full max-w-lg overflow-y-auto rounded-[16px] bg-white p-5 shadow-2xl sm:p-6"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle">
                    Your feedback
                  </p>
                  <h3
                    id="customer-style-change-feedback-title"
                    className="mt-1 text-xl font-semibold text-ink"
                  >
                    Requested style clarification
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowStyleChangeFeedback(false)}
                  className="grid size-10 shrink-0 place-items-center rounded-full border border-ink/10 text-ink"
                  aria-label="Close requested style clarification"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 text-ink/78">
                {safeUserText(styleChangeFeedback.feedback, 'No feedback was provided.')}
              </p>
            </div>
          </div>
        ) : null}

        {canRespondSourcedFabric ? (
          <DisclosurePanel
            title="Sourced fabric"
            summary="Approve the tailor-sourced fabric or request a change before cutting."
            defaultOpen
          >
            <div className="grid gap-3">
              {sourcedFabricProofUrls.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {sourcedFabricProofUrls.map((src, index) => (
                    <PhotoTile key={src} src={src} label={`Sourced fabric proof ${index + 1}`} />
                  ))}
                </div>
              ) : (
                <p className="rounded-[8px] border border-rust/14 bg-rust/6 p-3 text-sm text-rust-700">
                  Fabric proof is missing. Ask the tailor to upload it before approving.
                </p>
              )}
              <textarea
                value={fabricChangeNote}
                onChange={(event) => setFabricChangeNote(event.target.value)}
                placeholder="Optional change note if the fabric is not right."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    void decideSourcedFabric('approve-sourced-fabric')
                  }}
                  disabled={busyAction === 'approve-sourced-fabric'}
                  className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                >
                  {busyAction === 'approve-sourced-fabric' ? 'Approving...' : 'Approve fabric'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void decideSourcedFabric('request-sourced-fabric-change')
                  }}
                  disabled={busyAction === 'request-sourced-fabric-change'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busyAction === 'request-sourced-fabric-change'
                    ? 'Sending...'
                    : 'Request fabric change'}
                </button>
              </div>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondMaterialIssue ? (
          <DisclosurePanel
            title="Material issue"
            summary={
              supportMeta.materialIssue?.reasonLabel ?? 'Choose how to handle the fabric issue.'
            }
            defaultOpen
          >
            <div className="grid gap-3">
              {supportMeta.materialIssue?.note ? (
                <p className="text-sm leading-6 text-ink/62">
                  {safeUserText(supportMeta.materialIssue.note, '')}
                </p>
              ) : null}
              <select
                value={materialIssueResponse}
                onChange={(event) =>
                  setMaterialIssueResponse(event.target.value as typeof materialIssueResponse)
                }
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {MATERIAL_ISSUE_RESPONSE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <textarea
                value={materialIssueNote}
                onChange={(event) => setMaterialIssueNote(event.target.value)}
                placeholder="Optional note for the tailor."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => {
                  void respondMaterialIssue()
                }}
                disabled={busyAction === 'respond-material-issue'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'respond-material-issue' ? 'Sending...' : 'Send material response'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestScopeChange ? (
          <DisclosurePanel
            title="Request change"
            summary="Ask for a formal scope, fit, fabric, style, deadline, or fulfillment change."
          >
            <div className="grid gap-3">
              <select
                value={customerScopeChangeType}
                onChange={(event) =>
                  setCustomerScopeChangeType(event.target.value as typeof customerScopeChangeType)
                }
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {SCOPE_CHANGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {SCOPE_CHANGE_IMPACT_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/68"
                  >
                    <input
                      type="checkbox"
                      checked={customerScopeChangeImpacts.includes(option.value)}
                      onChange={() => toggleCustomerScopeImpact(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <textarea
                value={customerScopeChangeSummary}
                onChange={(event) => setCustomerScopeChangeSummary(event.target.value)}
                placeholder="What needs to change?"
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => {
                  void requestCustomerScopeChange()
                }}
                disabled={busyAction === 'request-scope-change'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-scope-change' ? 'Sending...' : 'Send change request'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRespondScopeChange || canCancelScopeChange ? (
          <DisclosurePanel
            title="Order change"
            summary={
              supportMeta.scopeChange?.summary ??
              'Review the open change request before work continues.'
            }
            defaultOpen
          >
            <div className="grid gap-3">
              {canRespondScopeChange ? (
                <>
                  <select
                    value={scopeChangeDecision}
                    onChange={(event) =>
                      setScopeChangeDecision(event.target.value as typeof scopeChangeDecision)
                    }
                    className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
                  >
                    <option value="ACCEPTED">Accept change</option>
                    <option value="DECLINED">Decline change</option>
                  </select>
                  <textarea
                    value={scopeChangeResponseNote}
                    onChange={(event) => setScopeChangeResponseNote(event.target.value)}
                    placeholder="Optional response note."
                    className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void respondScopeChange()
                    }}
                    disabled={busyAction === 'respond-scope-change'}
                    className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                  >
                    {busyAction === 'respond-scope-change' ? 'Saving...' : 'Send change response'}
                  </button>
                </>
              ) : null}
              {canCancelScopeChange ? (
                <button
                  type="button"
                  onClick={() => {
                    void respondScopeChange('CANCELLED')
                  }}
                  disabled={busyAction === 'respond-scope-change'}
                  className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  {busyAction === 'respond-scope-change' ? 'Cancelling...' : 'Cancel request'}
                </button>
              ) : null}
            </div>
          </DisclosurePanel>
        ) : null}

        {canSaveFabricTracking ? (
          <DisclosurePanel
            title="Fabric tracking"
            summary="Add the carrier tracking number when you are sending fabric to the tailor."
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                value={fabricTracking}
                onChange={(event) => setFabricTracking(event.target.value)}
                placeholder="Carrier tracking number"
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => {
                  void saveFabricTracking()
                }}
                disabled={
                  busyAction === 'save-fabric-tracking' ||
                  fabricTracking.trim() === (order.fabric_tracking ?? '')
                }
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'save-fabric-tracking' ? 'Saving...' : 'Save tracking'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canSelfCancel ? (
          <div className="order-[90]">
            <DisclosurePanel
              title="Cancel order"
              summary="Close an early order before live production starts."
            >
              <button
                type="button"
                onClick={() => {
                  void cancelOrder()
                }}
                disabled={busyAction === 'cancel-order'}
                className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
              >
                {busyAction === 'cancel-order'
                  ? 'Cancelling...'
                  : cancelArmed
                    ? 'Confirm cancellation'
                    : 'Cancel order'}
              </button>
            </DisclosurePanel>
          </div>
        ) : null}

        {canRequestCancellationReview ? (
          <div className="order-[90]">
            <DisclosurePanel
              title="Cancellation review"
              summary="Ask Drapeon to review cancellation after production has started."
            >
              <div className="grid gap-3">
                <select
                  value={cancellationReason}
                  onChange={(event) =>
                    setCancellationReason(event.target.value as typeof cancellationReason)
                  }
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
                >
                  {CUSTOMER_CANCELLATION_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={cancellationNote}
                  onChange={(event) => setCancellationNote(event.target.value)}
                  placeholder="Add context for the review."
                  className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
                />
                <button
                  type="button"
                  onClick={() => {
                    void requestCancellationReview()
                  }}
                  disabled={busyAction === 'request-cancellation-review'}
                  className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                >
                  {busyAction === 'request-cancellation-review'
                    ? 'Opening review...'
                    : 'Open cancellation review'}
                </button>
              </div>
            </DisclosurePanel>
          </div>
        ) : null}

        {canRequestDeliveryReview ? (
          <div className="order-[80]">
            <DisclosurePanel
              title="Shipping & delivery help"
              summary="Available after payment, including after completion. High-risk reports pause protected steps; routine follow-up does not."
            >
              <div className="grid gap-3">
                <select
                  value={deliveryReason}
                  onChange={(event) =>
                    setDeliveryReason(event.target.value as typeof deliveryReason)
                  }
                  className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
                >
                  {CUSTOMER_DELIVERY_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={deliveryNote}
                  onChange={(event) => setDeliveryNote(event.target.value)}
                  placeholder="What happened with dispatch or delivery?"
                  className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
                />
                <button
                  type="button"
                  onClick={() => {
                    void requestDeliveryReview()
                  }}
                  disabled={busyAction === 'request-delivery-review'}
                  className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
                >
                  {busyAction === 'request-delivery-review' ? 'Sending...' : 'Send to Drapeon'}
                </button>
              </div>
            </DisclosurePanel>
          </div>
        ) : null}

        {canConfirmReceipt ? (
          <DisclosurePanel
            title="Confirm receipt"
            summary="Add proof that the item is in hand before closing delivery."
            defaultOpen
          >
            <div className="grid gap-3">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm file:mr-4 file:rounded-[6px] file:border-0 file:bg-bone file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
              />
              <button
                type="button"
                onClick={() => {
                  void confirmReceipt()
                }}
                disabled={busyAction === 'confirm-receipt'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'confirm-receipt' ? 'Confirming...' : 'Confirm receipt'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canCompleteOrder ? (
          <DisclosurePanel
            title="Complete order"
            summary="Mark the order complete after delivery or collection is settled."
          >
            <button
              type="button"
              onClick={() => {
                void completeOrder()
              }}
              disabled={busyAction === 'complete-order'}
              className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
            >
              {busyAction === 'complete-order' ? 'Completing...' : 'Mark complete'}
            </button>
          </DisclosurePanel>
        ) : null}

        {canRequestAftercare ? (
          <DisclosurePanel
            title="Aftercare"
            summary="Raise a fit, finish, damage, or alteration issue after handoff."
          >
            <div className="grid gap-3">
              <select
                value={aftercareType}
                onChange={(event) => setAftercareType(event.target.value as typeof aftercareType)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_AFTERCARE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <textarea
                value={aftercareNote}
                onChange={(event) => setAftercareNote(event.target.value)}
                placeholder="Describe the fit, finish, or defect."
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => {
                  void requestAftercare()
                }}
                disabled={busyAction === 'request-aftercare-support'}
                className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
              >
                {busyAction === 'request-aftercare-support'
                  ? 'Sending...'
                  : 'Send aftercare request'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canOpenDispute ? (
          <DisclosurePanel
            title="Raise a concern"
            summary="Pause the order for Drapeon review when something is wrong."
          >
            <div className="grid gap-3">
              <select
                value={disputeReason}
                onChange={(event) => setDisputeReason(event.target.value as CustomerConcernReason)}
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {CUSTOMER_CONCERN_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {CUSTOMER_CONCERN_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
              <select
                value={disputeRequestedOutcome}
                onChange={(event) =>
                  setDisputeRequestedOutcome(event.target.value as FinancialCaseRequestedOutcome)
                }
                aria-label="Requested outcome"
                className="rounded-[8px] border border-ui-border bg-white px-3 py-2 text-sm outline-none focus:border-needle"
              >
                {FINANCIAL_CASE_REQUESTED_OUTCOMES.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {FINANCIAL_CASE_REQUESTED_OUTCOME_LABELS[outcome]}
                  </option>
                ))}
              </select>
              {evidencePromptsForConcern(disputeReason).length > 0 ? (
                <p className="rounded-[8px] bg-bone px-3 py-2 text-xs leading-5 text-ink/64">
                  Helpful evidence:{' '}
                  {evidencePromptsForConcern(disputeReason)
                    .map((prompt) => prompt.label)
                    .join(' · ')}
                  . Add it securely in the order thread after submitting.
                </p>
              ) : null}
              <textarea
                value={disputeDescription}
                onChange={(event) => setDisputeDescription(event.target.value)}
                placeholder="Describe what happened."
                maxLength={2000}
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => {
                  void openDispute()
                }}
                disabled={busyAction === 'open-dispute'}
                className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
              >
                {busyAction === 'open-dispute' ? 'Opening concern...' : 'Raise concern'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}

        {canRequestEmergencySupport ? (
          <DisclosurePanel
            title="Event emergency"
            summary="Use this for urgent event or wear-date problems."
          >
            <div className="grid gap-3">
              <textarea
                value={emergencyNote}
                onChange={(event) => setEmergencyNote(event.target.value)}
                placeholder="What is wrong, and when is the event or wear date?"
                className="min-h-24 rounded-[8px] border border-ink/10 bg-white px-4 py-3 text-sm outline-none focus:border-needle"
              />
              <button
                type="button"
                onClick={() => {
                  void requestEmergencySupport()
                }}
                disabled={busyAction === 'request-emergency-support'}
                className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
              >
                {busyAction === 'request-emergency-support'
                  ? 'Sending...'
                  : 'Request emergency help'}
              </button>
            </div>
          </DisclosurePanel>
        ) : null}
      </div>
    </Surface>
  )
}
