'use client'

import {
  AccountCurrencyCode,
  QUOTE_ORDER_REVIEW_VERSION,
  TAILOR_QUOTE_DRAFT_VERSION,
  TailorQuoteDraftFields,
  canSubmitTailorFabricApproval,
  deriveCancellationPolicy,
  formatMoneyInputValue,
  isCompletedOrderStage,
  isMeaningfulTailorQuoteDraft,
  isFundedFabricPolicy,
  latestFabricApprovalEvidence,
  normalizeAccountCurrency,
  parseMoneyInputToMinorUnits,
  sourcedFabricChangeFeedbackFromUpdates,
  styleAlignmentChangeFeedbackFromUpdates,
  taxSnapshotNeedsRefresh,
} from '@drape/shared'
import { friendlyActionError } from '@drape/shared/action-errors'
import { recommendedSchedulingStartDate } from '@drape/shared/call-scheduling-policy'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  activeQuoteForOrder,
  assertNoContactLeak,
  dateToDatetimeLocal,
  formatDateTime,
  parseMinorUnits,
  supportMetaWithConsultationBooking,
} from '../messages/message-foundation'
import type { AccountOrder, OrderDetailRenderData } from '../shared/account-data-contracts'
import { invokeAccountFunction, stringList } from '../shared/account-data-queries'
import { TailorOrderActionsView } from './tailor-order-actions-view'

import {
  MATERIAL_ISSUE_REASON_OPTIONS,
  PRE_CUTTING_STAGES,
  SCOPE_CHANGE_STAGES,
  SCOPE_CHANGE_TYPE_OPTIONS,
  TAILOR_CANCELLATION_REASON_OPTIONS,
  TAILOR_DELIVERY_REASON_OPTIONS,
  asOrderStage,
  dateTimeLocalInputValue,
  isTailorOrder,
  measurementSnapshotForOrder,
  mediaFingerprint,
  minorUnitsInput,
  nextStageOptions,
  prepareOrderEvidenceFile,
  productionEvidenceFor,
  stageUpdatesFor,
  uploadPublicFile,
} from './order-action-helpers'
export * from './order-action-helpers'

export function useTailorOrderActionsController({
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
  const fundedFabricQuote = isFundedFabricPolicy(order.fabric_funding_policy_version)
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
  }, [order.id, quoteDraftFields, setQuoteDraftStatus])

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
          setQuoteTailoringAmount(formatMoneyInputValue(fields.tailoringAmount ||
            (order.fabric_source === 'CUSTOMER_SUPPLIES' ? fields.amount ?? '' : '')))
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
  }, [isTailor, persistQuoteDraft, quoteDraftFields, quoteDraftLoaded, stage])

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

  // Keep the typed controller/view handoff compact.
  // prettier-ignore
  return {
      order, data, supportMeta, consultationMeta, quoteTaxNeedsRefresh, quoteAmount, setQuoteAmount, quoteTailoringAmount,
      setQuoteTailoringAmount, quoteFabricAllowanceAmount, setQuoteFabricAllowanceAmount, quoteFabricCoverage, setQuoteFabricCoverage, quoteFabricAssumptions, setQuoteFabricAssumptions, quoteCurrency,
      completionDate, setCompletionDate, quoteNote, setQuoteNote, quoteOrderReviewed, setQuoteOrderReviewed, quoteDraftStatus, consultationStart,
      setConsultationStart, consultationStartSuggestion, setConsultationStartSuggestion, publishedConsultationCallType, consultationCallType, setConsultationCallType, consultationNote, setConsultationNote,
      setTargetStage, stageNote, setStageNote, stageTrackingNumber, setStageTrackingNumber, stageFulfillmentProvider, setStageFulfillmentProvider, stageFulfillmentReference,
      setStageFulfillmentReference, stageFulfillmentContactName, setStageFulfillmentContactName, stageFulfillmentContactPhone, setStageFulfillmentContactPhone, stageMediaFiles, setStageMediaFiles, fabricApprovalMode,
      setFabricApprovalMode, showFabricChangeFeedback, setShowFabricChangeFeedback, showStyleChangeFeedback, setShowStyleChangeFeedback, measurementNote, setMeasurementNote, measurementFields,
      setMeasurementFields, fitReadinessNote, setFitReadinessNote, styleAlignmentNote, setStyleAlignmentNote, fabricReceiptNote, setFabricReceiptNote, setFabricReceiptFile,
      materialIssueReason, setMaterialIssueReason, materialIssueNote, setMaterialIssueNote, scopeChangeType, setScopeChangeType, scopeChangeSummary, setScopeChangeSummary,
      scopeChangeImpacts, scopePriceImpact, setScopePriceImpact, scopeDeadlineImpact, setScopeDeadlineImpact, tailorScopeChangeResponseNote, setTailorScopeChangeResponseNote, declineNote,
      setDeclineNote, declineArmed, pickupCode, setPickupCode, tailorCancellationReason, setTailorCancellationReason, tailorCancellationNote, setTailorCancellationNote,
      tailorDeliveryReason, setTailorDeliveryReason, tailorDeliveryNote, setTailorDeliveryNote, busy, error, setError, success,
      stage, tailorFabricNeedsAction, tailorFabricApproved, tailorFabricProofUrls, fabricChangeFeedback, styleChangeFeedback, showTailorStyleDecision, showTailorStyleApproved,
      stageOptions, selectedTargetStage, selectedTargetNeedsDispatchMeta, lockedQuoteCurrency, fundedFabricQuote, tailorSourcesFabric, consultationRequestedByCustomer, tailorCanScheduleConsultation,
      proposedConsultationLabel, canRequestMeasurementConfirmation, canConfirmFitReadiness, canRequestStyleAlignment, canConfirmFabricReceived, canOpenMaterialIssue, canRequestScopeChange, canRespondScopeChange,
      canCancelScopeChange, canDeclineOrder, canRequestCancellationReview, canRequestDeliveryReview, canConfirmCollection, quoteSubmitBlockedReason, addStageMedia, replaceStageMedia,
      sendQuote, saveConsultation, declineConsultation, requestMeasurementConfirmation, confirmFitReadiness, requestStyleAlignment, confirmFabricReceived, openMaterialIssue,
      toggleScopeImpact, requestScopeChange, respondTailorScopeChange, declineOrder, confirmCollection, requestTailorCancellationReview, requestTailorDeliveryReview, advanceStage,
    }
}

export function TailorOrderActions(props: {
  order: AccountOrder
  data: OrderDetailRenderData
  onRefresh: () => void
}) {
  const context = useTailorOrderActionsController(props)
  if (!context) return null
  return <TailorOrderActionsView context={context} />
}
