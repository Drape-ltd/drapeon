'use client'

import {
  AccountCurrencyCode,
  QUOTE_ORDER_REVIEW_COPY,
  formatMoney,
  parseMoneyInputToMinorUnits,
} from '@drape/shared'
import { recommendedSchedulingStartDate } from '@drape/shared/call-scheduling-policy'
import { CheckCheck, ChevronRight, X } from 'lucide-react'
import { MoneyInput } from '../../../components/money-input'
import { PhoneNumberField } from '../../../components/ui/phone-number-field'
import { safeUserText } from '../../../lib/safe-display'
import {
  ActionNotice,
  DisclosurePanel,
  cleanLabel,
  dateToDatetimeLocal,
} from '../messages/message-foundation'
import { TailorOrderHelpActions } from './tailor-order-help-actions'

import {
  LocalEvidencePreview,
  MATERIAL_ISSUE_REASON_OPTIONS,
  PhotoTile,
  SCOPE_CHANGE_IMPACT_OPTIONS,
  SCOPE_CHANGE_TYPE_OPTIONS,
} from './order-action-helpers'

import type { useTailorOrderActionsController } from './tailor-order-actions'

type Props = { context: NonNullable<ReturnType<typeof useTailorOrderActionsController>> }

export function TailorOrderActionsView({ context }: Props) {
  // Mirror the typed controller/view handoff.
  // prettier-ignore
  const {
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
  } = context
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

        <TailorOrderHelpActions
          canConfirmCollection={canConfirmCollection}
          pickupCode={pickupCode}
          setPickupCode={setPickupCode}
          confirmCollection={confirmCollection}
          busy={busy}
          canDeclineOrder={canDeclineOrder}
          canRequestCancellationReview={canRequestCancellationReview}
          canRequestDeliveryReview={canRequestDeliveryReview}
          declineNote={declineNote}
          setDeclineNote={setDeclineNote}
          declineOrder={declineOrder}
          declineArmed={declineArmed}
          tailorCancellationReason={tailorCancellationReason}
          setTailorCancellationReason={setTailorCancellationReason}
          tailorCancellationNote={tailorCancellationNote}
          setTailorCancellationNote={setTailorCancellationNote}
          requestTailorCancellationReview={requestTailorCancellationReview}
          tailorDeliveryReason={tailorDeliveryReason}
          setTailorDeliveryReason={setTailorDeliveryReason}
          tailorDeliveryNote={tailorDeliveryNote}
          setTailorDeliveryNote={setTailorDeliveryNote}
          requestTailorDeliveryReview={requestTailorDeliveryReview}
        />
      </div>
    </section>
  )
}
