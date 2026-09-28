'use client'

import {
  CUSTOMER_CONCERN_REASONS,
  CUSTOMER_CONCERN_REASON_LABELS,
  CustomerConcernReason,
  FINANCIAL_CASE_REQUESTED_OUTCOMES,
  FINANCIAL_CASE_REQUESTED_OUTCOME_LABELS,
  FinancialCaseRequestedOutcome,
  evidencePromptsForConcern,
} from '@drape/shared'
import { friendlyActionError } from '@drape/shared/action-errors'
import { CheckCheck, ChevronRight, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Surface } from '../../../components/ui/surface'
import { safeUserText } from '../../../lib/safe-display'
import { ActionNotice, DisclosurePanel, assertNoContactLeak } from '../messages/message-foundation'
import { invokeAccountFunction } from '../shared/account-data-queries'
import { customerOrderActionAvailability } from './customer-order-action-availability'

import {
  CUSTOMER_AFTERCARE_OPTIONS,
  CUSTOMER_CANCELLATION_REASON_OPTIONS,
  CUSTOMER_DELIVERY_REASON_OPTIONS,
  CustomerOrderActionName,
  MATERIAL_ISSUE_RESPONSE_OPTIONS,
  type CustomerOrderActionsProps,
} from './customer-order-action-config'
import {
  PhotoTile,
  SCOPE_CHANGE_IMPACT_OPTIONS,
  SCOPE_CHANGE_TYPE_OPTIONS,
  prepareOrderEvidenceFile,
  uploadPublicFile,
} from './order-action-helpers'
export function CustomerOrderActions({ order, data, onRefresh }: CustomerOrderActionsProps) {
  const {
    stage,
    booking,
    supportMeta,
    latestSourcedFabricEvidence,
    sourcedFabricProofUrls,
    viewerIsCustomer,
    canConfirmMeasurements,
    canRespondStyleAlignment,
    styleChangeFeedback,
    showStyleClarification,
    showStyleApproved,
    canRespondSourcedFabric,
    canRespondMaterialIssue,
    scopeChangeOpen,
    cancellationReviewOpen,
    deliveryReviewOpen,
    canRequestScopeChange,
    canRespondScopeChange,
    canCancelScopeChange,
    canSelfCancel,
    canRequestCancellationReview,
    initialPaymentLikelyPaid,
    completedOrder,
    canRequestDeliveryReview,
    canOpenDispute,
    canConfirmReceipt,
    canCompleteOrder,
    canRequestAftercare,
    canRequestEmergencySupport,
    canSaveFabricTracking,
    hasActions,
  } = customerOrderActionAvailability({ order, data })

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
