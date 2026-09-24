'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown, ClipboardList, ShieldCheck } from 'lucide-react'
import { ConsultationAttendancePanel } from '../../../components/consultation-attendance-panel'
import { ConsultationReschedulePanel } from '../../../components/consultation-reschedule-panel'
import { ConsultationLifecyclePanel } from '../../../components/consultation-lifecycle-panel'
import { FabricWorkflowPanel } from '../../../components/fabric-workflow-panel'
import { friendlyActionError } from '@drape/shared/action-errors'
import { buildBriefDossier, formatDatabaseEnumLabel, formatDate, formatMoney, formatRelative, formatTaxRate, taxLinesForReceiptSnapshot, taxSnapshotNeedsRefresh, orderHistorySummary, presentProviderDispute, deriveFulfillmentAwareHistoryLabel, deriveFulfillmentAwareOrderStagePresentation } from '@drape/shared'
import { getCallLifecycleState } from '@drape/shared/call-scheduling-policy'
import { isVideoMediaUrl } from '@drape/shared/media-policy'
import { OrderStage } from '@drape/shared/order-machine'
import type { BriefDossierRow, BriefDossierSection } from '@drape/shared/order-brief-dossier'
import { safeUserText } from '../../../lib/safe-display'
import { QUOTE_NEGOTIATION_UI_ENABLED } from '../shared/account-realtime-config'
import type { AccountOrder, AccountOrderQuote, OrderDetailRenderData, StageUpdate } from '../shared/account-data-contracts'
import { invokeAccountFunction, stringList } from '../shared/account-data-queries'
import { ActionNotice, CallLifecycleEventCard, DisclosurePanel, EmptyState, MessageComposer, MessageContent, OrderConversationEventCard, accountRoute, activeQuoteForOrder, cleanLabel, formatMessageRelative, orderTitle, safeMediaUrl, supportMetaWithConsultationBooking, timestampMs } from '../messages/account-messages-surface'
import { OpenAppButton } from '../../../components/open-app-button'
import { MediaViewerDialog } from '../../../components/ui/media-viewer-dialog'
import { StatusChip } from '../../../components/ui/status-chip'
import { Surface, SurfaceHeader } from '../../../components/ui/surface'
import { PhotoTile, TailorOrderActions, asOrderStage, filterFulfillmentStage, isTailorOrder, nextStageOptions, productionEvidenceFor, stageUpdatesFor, CustomerOrderActions } from './account-order-actions'
import { CLOSED_STAGES, StagePill, orderAmount } from '../payouts/account-payout-surfaces'
import { MaterialAdvancePanel, StripeCardAuthorization } from './material-advance-panel'
import { AccountDrapeonDispatchCard, SummaryLine } from './account-dispatch-card'
import { CommercialBenefitControl } from '../checkout/ready-made-checkout-form'
import { CommercialAdjustmentPanel, OpsRefundStatusPanel, OrderReviewPanel, OrderTipPanel, ReturnResolutionPanel, isCustomerOrder } from './order-resolution-panels'

function autoReleaseLabel(value: string | null | undefined) {
  if (!value) return null
  const dateLabel = formatDate(value)
  const relative = formatRelative(value)
  return dateLabel ? `${relative} (${dateLabel})` : relative
}

function isHandoffStage(stage: string | null | undefined) {
  return [
    'READY_FOR_COLLECTION',
    'READY_FOR_DRAPE_DISPATCH',
    'SHIPPED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'COLLECTED',
  ].includes(stage ?? '')
}

function readableCode(value: string | null | undefined) {
  if (!value) return null
  return value
    .replace(/\s+/g, '')
    .replace(/(.{2})/g, '$1 ')
    .trim()
}

export function isPayableOrder(order: AccountOrder) {
  if (
    order.stage === 'FINISHING' &&
    order.delivery_method !== 'LOCAL_COLLECTION' &&
    typeof order.fulfillment_fee === 'number' &&
    order.fulfillment_fee > 0 &&
    !!order.fulfillment_payment_requested_at &&
    !order.fulfillment_payment_paid_at
  ) {
    return true
  }
  if (order.order_kind === 'CUSTOM') {
    return ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
  }
  if (order.order_kind === 'READY_MADE') {
    return ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
  }
  return false
}

function checkoutActionLabel(order: AccountOrder) {
  if (
    order.stage === 'FINISHING' &&
    order.delivery_method !== 'LOCAL_COLLECTION' &&
    !!order.fulfillment_payment_requested_at &&
    !order.fulfillment_payment_paid_at
  ) {
    return order.delivery_method === 'LOCAL_DELIVERY' ? 'Pay delivery fee' : 'Pay shipping fee'
  }
  if (order.stage === 'QUOTE_SENT') return 'Accept quote and pay'
  return 'Start secure checkout'
}

const CUSTOMER_STAGE_FLOW: OrderStage[] = [
  'PENDING_QUOTE',
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
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COLLECTED',
  'COMPLETE',
]

export function stageProgress(order: AccountOrder) {
  const current = asOrderStage(order.stage)
  if (!current) return 0
  if (CLOSED_STAGES.has(current)) return 100
  const index = CUSTOMER_STAGE_FLOW.indexOf(current)
  if (index < 0) return 12
  return Math.max(8, Math.round(((index + 1) / CUSTOMER_STAGE_FLOW.length) * 100))
}

export function StageProgressBar({ order }: { order: AccountOrder }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-ink/8" aria-hidden="true">
      <div
        className="h-full rounded-full bg-needle"
        style={{ width: `${stageProgress(order)}%` }}
      />
    </div>
  )
}

function StageTimeline({ order }: { order: AccountOrder }) {
  const presentation = deriveFulfillmentAwareOrderStagePresentation({
    orderStage: order.stage,
    effectiveMethod: order.delivery_method,
  })
  const current = asOrderStage(presentation.stage)
  const visibleStages = CUSTOMER_STAGE_FLOW.filter((stage) => filterFulfillmentStage(order, stage))
  const currentIndex = current ? visibleStages.indexOf(current) : -1
  return (
    <div className="rounded-[8px] border border-ink/6 bg-bone/55 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
          Stage progress
        </p>
        {presentation.label ?? <StagePill stage={presentation.stage ?? order.stage} />}
      </div>
      <div className="mt-4">
        <StageProgressBar order={order} />
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {visibleStages.map((stage, index) => {
          const reached = currentIndex >= 0 && index <= currentIndex
          const active = current === stage
          return (
            <li
              key={stage}
              className={`rounded-[8px] border px-3 py-2 text-xs font-semibold ${
                active
                  ? 'border-needle bg-needle text-white'
                  : reached
                    ? 'border-needle/16 bg-needle/8 text-needle'
                    : 'border-ink/6 bg-white/72 text-ink/44'
              }`}
            >
              {cleanLabel(stage)}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function dossierDisplayValue(value: string | null | undefined, fallback = 'Not set') {
  const safe = safeUserText(value, fallback)
  return /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/u.test(safe) ? formatDatabaseEnumLabel(safe, fallback) : safe
}

function BriefDossierRowView({ row }: { row: BriefDossierRow }) {
  const label = <p className="text-[0.68rem] font-semibold uppercase text-needle/72">{row.label}</p>

  if (row.presentation === 'chips' && row.values?.length) {
    return (
      <div className="rounded-[8px] border border-ui-border bg-white p-4">
        {label}
        <div className="mt-3 flex flex-wrap gap-2">
          {row.values.map((value) => (
            <span
              key={value}
              className="rounded-full bg-rust/8 px-3 py-1 text-xs font-semibold text-rust"
            >
              {formatDatabaseEnumLabel(value, value)}
            </span>
          ))}
        </div>
      </div>
    )
  }

  if (row.presentation === 'links' && row.hrefs?.length) {
    return (
      <div className="rounded-[8px] border border-ui-border bg-white p-4">
        {label}
        <div className="mt-3 grid gap-2">
          {row.hrefs.map((href) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sm font-semibold text-needle underline-offset-4 hover:underline"
            >
              {safeUserText(href, href)}
            </a>
          ))}
        </div>
      </div>
    )
  }

  if (row.presentation === 'media' && row.mediaUrls?.length) {
    return (
      <div className="rounded-[8px] border border-ui-border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          {label}
          <p className="text-xs font-semibold text-ink/46">{row.value}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {row.mediaUrls.slice(0, 6).map((src, index) => {
            const safeSrc = safeMediaUrl(src)
            if (!safeSrc) return null
            const mediaLabel = `${row.label} ${index + 1}`
            return (
              <MediaViewerDialog
                key={`${safeSrc}-${index}`}
                src={safeSrc}
                kind={isVideoMediaUrl(safeSrc) ? 'video' : 'image'}
                title={mediaLabel}
              >
                <button
                  type="button"
                  className="cursor-zoom-in rounded-[8px] text-left transition-opacity hover:opacity-90"
                >
                  <PhotoTile src={safeSrc} label={mediaLabel} />
                </button>
              </MediaViewerDialog>
            )
          })}
        </div>
      </div>
    )
  }

  if (row.presentation === 'stacked') {
    return (
      <div className="rounded-[8px] border border-ui-border bg-white p-4">
        {label}
        <p className="mt-2 whitespace-pre-line break-words text-sm font-semibold leading-6 text-ink">
          {dossierDisplayValue(row.value)}
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-2 rounded-[8px] border border-ui-border bg-white p-4 sm:grid-cols-[minmax(9rem,0.4fr)_minmax(0,1fr)] sm:items-start">
      <p className="text-[0.68rem] font-semibold uppercase text-needle/72">{row.label}</p>
      <p className="break-words text-sm font-semibold leading-6 text-ink sm:text-right">
        {dossierDisplayValue(row.value)}
      </p>
    </div>
  )
}

function BriefDossierSectionCard({ section }: { section: BriefDossierSection }) {
  return (
    <DisclosurePanel
      title={section.title}
      summary={
        section.summary ??
        `${section.rows.length} ${section.rows.length === 1 ? 'detail' : 'details'}`
      }
      defaultOpen={section.id === 'summary'}
    >
      <div className="grid gap-3">
        {section.rows.map((row) => (
          <BriefDossierRowView key={row.id} row={row} />
        ))}
      </div>
    </DisclosurePanel>
  )
}

export function CheckoutAction({
  order,
  activeQuote,
  onRefresh,
}: {
  order: AccountOrder
  activeQuote?: AccountOrderQuote | null
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [declineArmed, setDeclineArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [stripePayment, setStripePayment] = useState<{
    clientSecret: string
    paymentIntentId?: string | null
    amount?: number | null
    currency?: string | null
  } | null>(null)
  const quoteTaxNeedsRefresh = taxSnapshotNeedsRefresh({
    taxRegion: order.tax_region,
    taxRateBps: order.tax_rate_bps,
    taxFallback: order.tax_fallback,
  })

  async function handleCheckout() {
    if (quoteTaxNeedsRefresh) {
      setError(
        'This quote uses an older Ghana tax snapshot. The tailor must refresh it before payment.'
      )
      return
    }
    if (
      QUOTE_NEGOTIATION_UI_ENABLED &&
      order.order_kind === 'CUSTOM' &&
      order.stage === 'QUOTE_SENT' &&
      !activeQuote
    ) {
      setError('The active quote could not be loaded. Refresh this order before paying.')
      return
    }
    setBusy(true)
    setError(null)
    setStripePayment(null)
    setSuccess('Preparing payment. Do not start another checkout while this finishes.')
    try {
      const result = await invokeAccountFunction<{
        ok?: boolean
        confirmed?: boolean
        alreadyPaid?: boolean
        provider?: string
        authorizationUrl?: string | null
        clientSecret?: string | null
        paymentIntentId?: string | null
        amount?: number
        currency?: string
      }>('payment-action', {
        action: 'prepare-payment',
        orderId: order.id,
        ...(QUOTE_NEGOTIATION_UI_ENABLED && activeQuote
          ? {
              quoteId: activeQuote.id,
              expectedQuoteVersion: activeQuote.version,
            }
          : {}),
      })

      onRefresh()
      if (result.confirmed || result.alreadyPaid) {
        setSuccess('Payment is already confirmed on this order.')
        return
      }
      if (result.authorizationUrl) {
        setSuccess('Payment is ready. Redirecting to the secure provider checkout.')
        window.location.assign(result.authorizationUrl)
        return
      }
      if (result.provider === 'STRIPE' && result.clientSecret) {
        setStripePayment({
          clientSecret: result.clientSecret,
          paymentIntentId: result.paymentIntentId ?? null,
          amount: result.amount ?? null,
          currency: result.currency ?? null,
        })
        setSuccess(
          'Card payment is ready. Enter card details below; Drapeon will not create a duplicate charge.'
        )
        return
      }
      setSuccess('Payment is prepared. Open the app if the provider window does not appear.')
    } catch (checkoutError) {
      setError(
        friendlyActionError(
          checkoutError,
          'Payment could not start cleanly. Please refresh the order and try again.'
        )
      )
      setSuccess(null)
    } finally {
      setBusy(false)
    }
  }

  async function declineQuote() {
    if (order.order_kind !== 'CUSTOM' || order.stage !== 'QUOTE_SENT') return
    setError(null)
    setSuccess(null)
    if (QUOTE_NEGOTIATION_UI_ENABLED && !activeQuote) {
      setError('The active quote could not be loaded. Refresh this order before declining it.')
      return
    }
    if (!declineArmed) {
      setDeclineArmed(true)
      setSuccess('Click decline once more to close this quote.')
      return
    }
    setDeclining(true)
    try {
      await invokeAccountFunction('customer-order-action', {
        action: 'decline-quote',
        orderId: order.id,
        ...(QUOTE_NEGOTIATION_UI_ENABLED && activeQuote
          ? {
              quoteId: activeQuote.id,
              expectedQuoteVersion: activeQuote.version,
            }
          : {}),
      })
      setDeclineArmed(false)
      setSuccess('Quote declined. This order is now closed.')
      onRefresh()
    } catch (declineError) {
      setError(
        friendlyActionError(
          declineError,
          'Quote could not be declined. Refresh the order and try again.'
        )
      )
      setSuccess(null)
    } finally {
      setDeclining(false)
    }
  }

  if (!isPayableOrder(order)) {
    return (
      <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
        This order is not awaiting a customer payment right now.
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      <ActionNotice error={error} success={success} />
      <button
        type="button"
        onClick={handleCheckout}
        disabled={busy || quoteTaxNeedsRefresh}
        className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-ink/20"
      >
        {busy
          ? 'Preparing checkout...'
          : quoteTaxNeedsRefresh
            ? 'Tax update needed'
            : checkoutActionLabel(order)}
      </button>
      {order.order_kind === 'CUSTOM' && order.stage === 'QUOTE_SENT' ? (
        <button
          type="button"
          onClick={() => {
            void declineQuote()
          }}
          disabled={declining || busy}
          className="inline-flex justify-center rounded-[8px] border border-rust/18 bg-white px-4 py-2.5 text-sm font-semibold text-rust disabled:cursor-not-allowed disabled:text-ink/30"
        >
          {declining ? 'Declining...' : declineArmed ? 'Confirm decline' : 'Decline quote'}
        </button>
      ) : null}
      {stripePayment ? (
        <StripeCardAuthorization
          clientSecret={stripePayment.clientSecret}
          label={formatMoney(
            stripePayment.amount ?? order.total_amount ?? order.quoted_amount,
            stripePayment.currency ?? order.currency ?? order.quoted_currency
          )}
          submitLabel="Authorize card"
          onConfirm={async (paymentIntentId) => {
            await invokeAccountFunction('payment-action', {
              action: 'confirm-payment',
              orderId: order.id,
              paymentIntentId,
            })
          }}
          onDone={() => {
            setStripePayment(null)
            onRefresh()
          }}
        />
      ) : null}
      <p className="text-xs leading-5 text-ink/52">
        {order.stage === 'QUOTE_SENT'
          ? 'Accepting prepares secure payment and moves the quote into payment pending. Production starts only after payment succeeds.'
          : 'If checkout is already processing, Drapeon will reuse the current attempt instead of creating a duplicate charge.'}
      </p>
    </div>
  )
}

function CommercialBenefitsPanel({
  order,
  data,
  onRefresh,
}: {
  order: AccountOrder
  data: Pick<OrderDetailRenderData, 'benefitReservations' | 'userId'>
  onRefresh: () => void
}) {
  const customer = order.customer_id === data.userId
  if (!customer || !['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? ''))
    return null
  return (
    <Surface className="overflow-hidden">
      <div className="p-5">
        <CommercialBenefitControl orderId={order.id} onMutation={onRefresh} />
      </div>
    </Surface>
  )
}

export function RenderOrderDetail({
  data,
  onRefresh,
}: {
  data: OrderDetailRenderData
  onRefresh: () => void
}) {
  const order = data.order
  if (!order) {
    return (
      <EmptyState
        title="Order not found."
        body="This order may belong to another account, or it may not have loaded yet. Refresh, then check the app if the issue persists."
        action={
          <Link href="/account/orders" className="font-semibold text-needle">
            Back to orders
          </Link>
        }
      />
    )
  }
  const updates = stageUpdatesFor(order.id, data.stageUpdates).sort((a, b) => {
    return timestampMs(a.created_at) - timestampMs(b.created_at)
  })
  const payments = data.payments.filter((payment) => payment.order_id === order.id)
  const receipt = data.receipts.find((entry) => entry.order_id === order.id) ?? null
  const receiptTaxLines = receipt
    ? taxLinesForReceiptSnapshot({
        taxJurisdiction: receipt.tax_jurisdiction,
        taxAmount: Math.max(
          receipt.tax_amount - receipt.import_tax_amount - receipt.duty_amount,
          0
        ),
      })
    : []
  const settlementSummary = data.settlementTranches.reduce(
    (summary, tranche) => {
      summary.total += tranche.amount
      if (tranche.status === 'RELEASED') summary.released += tranche.amount
      else if (tranche.status === 'ELIGIBLE' || tranche.status === 'RELEASE_REQUESTED')
        summary.eligible += tranche.amount
      else summary.protected += tranche.amount
      return summary
    },
    { total: 0, released: 0, eligible: 0, protected: 0 }
  )
  const providerDispute =
    data.providerDisputes.find((item) => item.money_movement_blocked) ??
    data.providerDisputes[0] ??
    null
  const providerDisputePresentation = providerDispute
    ? presentProviderDispute({
        status: providerDispute.status,
        amount: providerDispute.amount,
        currency: providerDispute.currency,
        evidenceDueAt: providerDispute.evidence_due_at,
        moneyMovementBlocked: providerDispute.money_movement_blocked,
      })
    : null
  const messages = data.messages.filter((message) => message.order_id === order.id)
  const booking = data.consultationBooking
  const supportMeta = supportMetaWithConsultationBooking(order.special_note, booking)
  const proofEvidence = productionEvidenceFor(order.id, data.productionEvidence)
  const proofMediaUrls = Array.from(
    new Set(
      proofEvidence
        .flatMap((item) => stringList(item.photo_urls))
        .map((src) => safeMediaUrl(src))
        .filter((src): src is string => !!src)
    )
  )
  const customDetail = data.customOrderDetail
    ? {
        garmentTypeOther: data.customOrderDetail.garment_type_other ?? null,
        genderPresentation: data.customOrderDetail.gender_presentation ?? null,
        socialReferenceLinks: stringList(data.customOrderDetail.social_reference_links),
        styleNotes: data.customOrderDetail.style_notes ?? null,
        bodyNote: data.customOrderDetail.body_note ?? null,
        fabricDescription: data.customOrderDetail.fabric_description ?? null,
        fabricBudgetAmount: data.customOrderDetail.fabric_budget_amount ?? null,
        fabricBudgetCurrency: data.customOrderDetail.fabric_budget_currency ?? null,
        fabricSourcingDeadlineDays: data.customOrderDetail.fabric_sourcing_deadline_days ?? null,
        fabricSourcingDeadlineAt: data.customOrderDetail.fabric_sourcing_deadline_at ?? null,
        fabricApprovalStatus: data.customOrderDetail.fabric_approval_status ?? null,
        shippingPreference: data.customOrderDetail.shipping_preference ?? null,
        deliveryInstructions: data.customOrderDetail.delivery_instructions ?? null,
        targetDeliveryDate: data.customOrderDetail.target_delivery_date ?? null,
      }
    : null
  const briefDossier = buildBriefDossier(
    {
      orderKind: order.order_kind,
      garmentType: order.garment_type,
      garmentDescription: order.garment_description,
      itemTitle: order.item_title,
      itemSize: order.item_size,
      occasion: order.occasion,
      stage: order.stage,
      quotedAmount: order.quoted_amount,
      quotedCurrency: order.quoted_currency ?? order.currency,
      quotedCompletionDate: order.quoted_completion_date,
      deadline: order.deadline,
      fabricSource: order.fabric_source,
      deliveryMethod: order.delivery_method,
      deliveryAddress: order.delivery_address ?? null,
      recipientName: order.recipient_name ?? null,
      recipientPhone: order.recipient_phone ?? null,
      fabricTracking: order.fabric_tracking,
      trackingNumber: order.tracking_number ?? null,
      carrier: order.carrier ?? null,
      fulfillmentProvider: order.fulfillment_provider ?? null,
      fulfillmentReference: order.fulfillment_reference ?? null,
      fulfillmentContactName: order.fulfillment_contact_name ?? null,
      fulfillmentContactPhone: order.fulfillment_contact_phone ?? null,
      collectionCode: order.collection_code,
      referencePhotos: stringList(order.reference_photos),
      proofMediaUrls,
      messageCount: messages.length,
      supportMeta: supportMeta as Record<string, unknown>,
      customDetail,
      measurementSnapshot: order.customer_measurements_snapshot ?? null,
    },
    { label: cleanLabel, date: formatDate, money: formatMoney }
  )
  const viewerIsCustomer = isCustomerOrder(order, data)
  const viewerIsTailor = isTailorOrder(order, data)
  const customerCanCheckout = viewerIsCustomer && isPayableOrder(order)
  const paymentConfirmed = payments.some((payment) =>
    ['CONFIRMED', 'SUCCEEDED', 'PAID'].includes(payment.status ?? '')
  )
  const paymentFailed =
    order.stage === 'PAYMENT_FAILED' ||
    payments.some((payment) => ['FAILED', 'PAYMENT_FAILED'].includes(payment.status ?? ''))
  const autoRelease = autoReleaseLabel(order.auto_release_at)
  const collectionCode = readableCode(order.collection_code)
  const pickupCredentialActive =
    order.delivery_method === 'LOCAL_COLLECTION' && order.stage === 'READY_FOR_COLLECTION'
  const fulfillmentStagePresentation = deriveFulfillmentAwareOrderStagePresentation({
    orderStage: order.stage,
    effectiveMethod: order.delivery_method,
  })
  const fulfillmentAwareHistoryLabel = (update: StageUpdate, isLatest = false) =>
    deriveFulfillmentAwareHistoryLabel({
      eventStage: update.stage,
      effectiveMethod: order.delivery_method,
      defaultLabel: cleanLabel(update.stage, 'Stage update'),
      isLatest,
    })
  const shouldShowHandoffState = viewerIsCustomer && isHandoffStage(order.stage)
  const tailorCanQuote =
    viewerIsTailor && ['PENDING_QUOTE', 'CONSULTATION'].includes(order.stage ?? '')
  const tailorCanAdvance = viewerIsTailor && nextStageOptions(order).length > 0
  const nextActionTitle = customerCanCheckout
    ? 'Complete secure checkout.'
    : tailorCanQuote
      ? 'Send the customer a quote.'
      : tailorCanAdvance
        ? 'Update production progress.'
        : paymentConfirmed
          ? 'Review order progress.'
          : 'Review order state.'
  const nextActionBody = customerCanCheckout
    ? 'This order is ready for customer payment. Web checkout reuses any existing provider attempt so a refresh or double tap does not create a duplicate charge.'
    : viewerIsTailor
      ? 'Quotes, production stages, proof media, messages, and support context stay attached to this order.'
      : 'Payment, messages, consultation requests, stage updates, and proof media stay attached to this order. Drapeon Vision capture is available in the app when body scanning is needed.'
  const nextActionPrimary = customerCanCheckout ? (
    <Link
      href={`/account/checkout/${order.id}`}
      className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
    >
      Pay now
    </Link>
  ) : viewerIsTailor && (tailorCanQuote || tailorCanAdvance) ? (
    <a
      href="#tailor-actions"
      className="inline-flex justify-center rounded-[8px] bg-needle px-4 py-2.5 text-sm font-semibold text-white"
    >
      Work this order
    </a>
  ) : (
    <OpenAppButton label="Open order in app" />
  )
  const nextActionSecondary = (
    <>
      <a
        href="#order-messages"
        className="inline-flex justify-center rounded-[8px] border border-needle/22 bg-needle/10 px-4 py-2.5 text-sm font-semibold text-needle"
      >
        Open order chat
      </a>
      {customerCanCheckout ? (
        <OpenAppButton
          label="Open order in app"
          className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink"
        />
      ) : (
        <Link
          href="/account/support"
          className="inline-flex justify-center rounded-[8px] border border-ui-border bg-white px-4 py-2.5 text-sm font-semibold text-ink"
        >
          Order support
        </Link>
      )}
    </>
  )

  return (
    <div className="grid gap-6">
      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
            {cleanLabel(order.order_kind, 'Order')}
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-ink sm:text-3xl">{orderTitle(order)}</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            {safeUserText(
              order.garment_description || order.special_note,
              'The app brief carries full order details and proof media.'
            )}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SummaryLine
              label="Status"
              value={
                fulfillmentStagePresentation.label ?? (
                  <StagePill stage={fulfillmentStagePresentation.stage ?? order.stage} />
                )
              }
            />
            <SummaryLine label="Amount" value={orderAmount(order)} />
            <SummaryLine
              label="Fulfillment"
              value={cleanLabel(order.delivery_method, 'Fulfillment')}
            />
            <SummaryLine
              label="Due date"
              value={formatDate(order.quoted_completion_date ?? order.deadline) ?? 'Pending'}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-start gap-2">
            {receipt ? (
              <details className="group w-fit rounded-full border border-ink/10 bg-bone/45 open:w-full open:rounded-[8px]">
                <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-needle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35">
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Receipt</span>
                </summary>
                <div className="grid gap-2 border-t border-ink/8 bg-white p-4">
                  {viewerIsTailor ? (
                    <>
                      <SummaryLine
                        label="Customer paid"
                        value={formatMoney(receipt.total_amount, receipt.currency)}
                      />
                      <SummaryLine
                        label={
                          receipt.fabric_funding_policy_version
                            ? 'Tailoring protected'
                            : 'Protected tailor amount'
                        }
                        value={
                          <strong>
                            {formatMoney(
                              receipt.tailoring_amount ?? receipt.subtotal_amount,
                              receipt.currency
                            )}
                          </strong>
                        }
                      />
                      {receipt.fabric_funding_policy_version &&
                      receipt.fabric_allowance_amount != null ? (
                        <SummaryLine
                          label="Fabric allowance held for approved material costs"
                          value={formatMoney(receipt.fabric_allowance_amount, receipt.currency)}
                        />
                      ) : null}
                    </>
                  ) : (
                    <>
                      {receipt.fabric_funding_policy_version &&
                      receipt.tailoring_amount != null &&
                      receipt.fabric_allowance_amount != null ? (
                        <>
                          <SummaryLine
                            label="Tailoring and construction"
                            value={formatMoney(
                              receipt.tailoring_amount + receipt.consultation_credit_amount,
                              receipt.currency
                            )}
                          />
                          <SummaryLine
                            label="Protected fabric allowance"
                            value={formatMoney(receipt.fabric_allowance_amount, receipt.currency)}
                          />
                        </>
                      ) : (
                        <SummaryLine
                          label="Tailor work and included materials"
                          value={formatMoney(
                            receipt.subtotal_amount + receipt.consultation_credit_amount,
                            receipt.currency
                          )}
                        />
                      )}
                      {receipt.consultation_credit_amount > 0 ? (
                        <SummaryLine
                          label="Consultation fee credit"
                          value={`−${formatMoney(receipt.consultation_credit_amount, receipt.currency)}`}
                        />
                      ) : null}
                      {receipt.promotion_amount > 0 ? (
                        <SummaryLine
                          label="Drapeon-funded benefit"
                          value={`−${formatMoney(receipt.promotion_amount, receipt.currency)}`}
                        />
                      ) : null}
                      {receipt.platform_fee_amount > 0 ? (
                        <SummaryLine
                          label="Drapeon service fee"
                          value={formatMoney(receipt.platform_fee_amount, receipt.currency)}
                        />
                      ) : null}
                      <SummaryLine
                        label="Fulfillment"
                        value={
                          receipt.shipping_amount > 0
                            ? formatMoney(receipt.shipping_amount, receipt.currency)
                            : 'Free'
                        }
                      />
                      {receiptTaxLines.map((line) => (
                        <SummaryLine
                          key={line.key}
                          label={
                            line.rateBps > 0
                              ? `${line.label} (${formatTaxRate(line.rateBps)})`
                              : line.label
                          }
                          value={formatMoney(line.amount, receipt.currency)}
                        />
                      ))}
                      {receipt.import_tax_amount > 0 ? (
                        <SummaryLine
                          label="Import tax"
                          value={formatMoney(receipt.import_tax_amount, receipt.currency)}
                        />
                      ) : null}
                      {receipt.duty_amount > 0 ? (
                        <SummaryLine
                          label="Customs duty"
                          value={formatMoney(receipt.duty_amount, receipt.currency)}
                        />
                      ) : null}
                      <SummaryLine
                        label="Total paid"
                        value={
                          <strong>{formatMoney(receipt.total_amount, receipt.currency)}</strong>
                        }
                      />
                    </>
                  )}
                  <SummaryLine
                    label="Provider reference"
                    value={`${cleanLabel(receipt.provider, 'Provider')} · ${receipt.provider_reference}`}
                  />
                  <p className="mt-2 text-xs leading-5 text-ink/55">
                    This receipt is locked to the captured checkout. Refunds and corrections are
                    recorded separately.
                  </p>
                </div>
              </details>
            ) : null}
            {data.settlementPlan && data.settlementTranches.length > 0 ? (
              <details className="group w-fit rounded-full border border-ink/10 bg-bone/45 open:w-full open:rounded-[8px]">
                <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-needle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-needle/35">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{viewerIsTailor ? 'Earnings' : 'Protection'}</span>
                </summary>
                <div className="border-t border-ink/8 bg-white p-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-ink">
                        {data.settlementPlan.status === 'FROZEN'
                          ? 'Release paused for review'
                          : `${formatMoney(settlementSummary.released, data.settlementPlan.currency)} released`}
                      </h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/62">
                        {data.settlementPlan.status === 'FROZEN'
                          ? 'Unreleased money stays protected while Drapeon reviews the open concern.'
                          : viewerIsTailor
                            ? `${formatMoney(settlementSummary.eligible, data.settlementPlan.currency)} is ready for Drapeon review. ${formatMoney(settlementSummary.protected, data.settlementPlan.currency)} remains protected.`
                            : `${formatMoney(settlementSummary.protected, data.settlementPlan.currency)} remains protected until verified handoff milestones are complete.`}
                      </p>
                    </div>
                    <span className="rounded-full bg-needle/10 px-3 py-1.5 text-xs font-semibold text-needle">
                      {cleanLabel(data.settlementPlan.status, 'Settlement')}
                    </span>
                  </div>
                  <div
                    className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink/8"
                    aria-label={`${settlementSummary.total > 0 ? Math.round((settlementSummary.released / settlementSummary.total) * 100) : 0}% released`}
                  >
                    <div
                      className="h-full rounded-full bg-needle"
                      style={{
                        width: `${settlementSummary.total > 0 ? Math.round((settlementSummary.released / settlementSummary.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  {data.settlementPlan.excluded_fabric_allowance_amount > 0 ? (
                    <div className="mt-4 grid gap-2 rounded-[8px] border border-ink/8 bg-bone/60 p-3 text-sm text-ink/66 sm:grid-cols-2">
                      <span>Fabric allowance paid through approved material releases</span>
                      <strong className="text-ink sm:text-right">
                        Excluded from earnings release ·{' '}
                        {formatMoney(
                          data.settlementPlan.excluded_fabric_allowance_amount,
                          data.settlementPlan.currency
                        )}
                      </strong>
                      {data.settlementPlan.material_recovery_offset_amount > 0 ? (
                        <>
                          <span>Unused fabric value recovered for customer refund</span>
                          <strong className="text-ink sm:text-right">
                            −
                            {formatMoney(
                              data.settlementPlan.material_recovery_offset_amount,
                              data.settlementPlan.currency
                            )}
                          </strong>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-4 grid gap-2">
                    {data.settlementTranches.map((tranche) => {
                      const title =
                        (
                          {
                            SHIP_CUSTODY_70: 'Accepted for delivery',
                            SHIP_DELIVERY_20: 'Delivery settled',
                            SHIP_PROTECTION_10: 'Protection window complete',
                            LOCAL_HANDOFF_80: 'Handoff confirmed',
                            LOCAL_SETTLED_20: 'Handoff settled',
                          } as Record<string, string>
                        )[tranche.code] ?? 'Settlement stage'
                      const state =
                        (
                          {
                            LOCKED: 'Still protected',
                            ELIGIBLE: 'Ready for Drapeon review',
                            RELEASE_REQUESTED: 'Release under review',
                            RELEASED: 'Released',
                            BLOCKED: 'Paused for review',
                            CANCELLED: 'Cancelled',
                          } as Record<string, string>
                        )[tranche.status] ?? cleanLabel(tranche.status, 'Pending')
                      return (
                        <div
                          key={tranche.id}
                          className="grid grid-cols-[10px_1fr_auto] items-center gap-3 border-t border-ink/8 pt-3"
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${tranche.status === 'RELEASED' ? 'bg-needle' : tranche.status === 'BLOCKED' ? 'bg-rust' : 'bg-ink/25'}`}
                            aria-hidden="true"
                          />
                          <div>
                            <p className="text-sm font-semibold text-ink">{title}</p>
                            <p className="mt-0.5 text-xs text-ink/52">{state}</p>
                          </div>
                          <strong className="text-sm text-ink">
                            {formatMoney(tranche.amount, tranche.currency)}
                          </strong>
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-4 text-xs leading-5 text-ink/52">
                    Ready or label-created states do not release money. Drapeon uses verified
                    custody, delivery, or authenticated collection evidence.
                  </p>
                </div>
              </details>
            ) : null}
            <AccountDrapeonDispatchCard
              order={order}
              viewerRole={viewerIsTailor ? 'TAILOR' : 'CUSTOMER'}
              onRefresh={onRefresh}
            />
          </div>
          <div className="mt-5">
            <StageTimeline order={order} />
          </div>
        </div>
        <div className="rounded-[8px] border border-needle/12 bg-needle/8 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
            Next best action
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-ink">{nextActionTitle}</h3>
          <p className="mt-3 text-sm leading-7 text-ink/66">{nextActionBody}</p>
          <div className="mt-5 flex flex-col gap-3">
            {nextActionPrimary}
            {nextActionSecondary}
          </div>
        </div>
      </section>

      {viewerIsCustomer && pickupCredentialActive && collectionCode ? (
        <section
          className="rounded-[8px] border border-needle/20 bg-needle/8 p-6 shadow-sm"
          aria-label={`Collection code ${collectionCode}`}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-needle">
            Collection code
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-ink">Show this code to the tailor</h2>
          <p className="mt-2 text-sm leading-6 text-ink/66">
            This is not the order number. Inspect the order first, then share the code so Drapeon
            can record the pickup handoff.
          </p>
          <p className="mt-5 rounded-[8px] border border-needle/16 bg-white px-5 py-4 text-center text-3xl font-semibold tracking-[0.28em] text-needle">
            {collectionCode}
          </p>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <OrderReviewPanel order={order} data={data} onRefresh={onRefresh} />
        <OrderTipPanel order={order} data={data} onRefresh={onRefresh} />
      </div>
      {supportMeta.consultation?.status === 'SCHEDULED' &&
      supportMeta.consultation.scheduledStartAt ? (
        <>
          {getCallLifecycleState(supportMeta.consultation.scheduledStartAt).status !== 'expired' ? (
            <>
              <CallLifecycleEventCard
                event={{
                  kind: 'consultation',
                  scheduledStartAt: supportMeta.consultation.scheduledStartAt,
                  timezone: supportMeta.consultation.timezone,
                  status: supportMeta.consultation.status,
                  paymentRequired:
                    !!supportMeta.consultation.feeAmount &&
                    supportMeta.consultation.paymentTiming === 'BEFORE_CALL_STARTS',
                  paymentPaid: !!supportMeta.consultation.paidAt,
                  callType: supportMeta.consultation.callType === 'AUDIO' ? 'audio' : 'video',
                  joinHref: accountRoute(
                    `/account/messages?orderId=${encodeURIComponent(order.id)}`
                  ),
                  paymentHref: viewerIsCustomer
                    ? accountRoute(`/account/checkout/${order.id}`)
                    : accountRoute(`/account/orders/${order.id}`),
                  paymentActionLabel: viewerIsCustomer ? 'Pay now' : 'View order',
                }}
              />
              <ConsultationLifecyclePanel
                orderId={order.id}
                actorRole={viewerIsTailor ? 'TAILOR' : 'CUSTOMER'}
                onUpdated={onRefresh}
              />
            </>
          ) : null}
          <ConsultationReschedulePanel
            orderId={order.id}
            actorId={data.userId}
            actorRole={viewerIsTailor ? 'TAILOR' : 'CUSTOMER'}
            onUpdated={onRefresh}
          />
        </>
      ) : null}
      {supportMeta.consultation?.scheduledStartAt ? (
        <ConsultationAttendancePanel
          orderId={order.id}
          actorRole={viewerIsTailor ? 'TAILOR' : 'CUSTOMER'}
        />
      ) : null}
      {providerDisputePresentation ? (
        <section
          className={`rounded-[8px] border p-6 shadow-sm ${providerDisputePresentation.tone === 'success' ? 'border-needle/18 bg-needle/8' : 'border-rust/22 bg-rust/8'}`}
          role="status"
        >
          <p
            className={`text-xs font-semibold uppercase tracking-[0.18em] ${providerDisputePresentation.tone === 'success' ? 'text-needle' : 'text-rust'}`}
          >
            {providerDisputePresentation.label}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-ink">
            {providerDisputePresentation.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/66">
            {providerDisputePresentation.body}
          </p>
          {providerDisputePresentation.deadline ? (
            <p className="mt-3 text-xs font-semibold text-ink/58">
              Provider evidence due {formatDate(providerDisputePresentation.deadline)}
            </p>
          ) : null}
        </section>
      ) : null}
      <CustomerOrderActions order={order} data={data} onRefresh={onRefresh} />
      <FabricWorkflowPanel
        orderId={order.id}
        policyVersion={order.fabric_funding_policy_version}
        onRefresh={onRefresh}
      />

      {paymentFailed || shouldShowHandoffState || autoRelease ? (
        <section className="grid gap-4 rounded-[8px] border border-rust/14 bg-white/86 p-6 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust">
              Order safeguards
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">Important order state.</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {paymentFailed ? (
              <div className="rounded-[8px] border border-rust/18 bg-rust/8 p-4">
                <h3 className="font-semibold text-ink">Payment needs attention</h3>
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  The latest payment attempt did not complete. Retry checkout before production
                  continues.
                </p>
                <Link
                  href={accountRoute(`/account/checkout/${order.id}`)}
                  className="mt-4 inline-flex rounded-lg bg-rust px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Retry payment
                </Link>
              </div>
            ) : null}
            {shouldShowHandoffState ? (
              <div className="rounded-[8px] border border-needle/14 bg-needle/8 p-4">
                <h3 className="font-semibold text-ink">Handoff and pickup</h3>
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  {order.delivery_method === 'LOCAL_COLLECTION'
                    ? collectionCode
                      ? 'Bring this code to pickup and inspect the garment before handoff is closed.'
                      : 'Your pickup code appears here once the tailor marks the order ready for collection.'
                    : 'Track delivery here and raise a concern before auto-release if something is wrong.'}
                </p>
                {order.delivery_method === 'LOCAL_COLLECTION' &&
                collectionCode &&
                order.stage !== 'READY_FOR_COLLECTION' ? (
                  <p className="mt-4 rounded-[8px] bg-white px-4 py-3 text-center text-2xl font-semibold tracking-[0.2em] text-needle">
                    {collectionCode}
                  </p>
                ) : null}
                {order.delivery_method === 'LOCAL_COLLECTION' && order.collection_code_expiry ? (
                  <p className="mt-2 text-xs text-ink/50">
                    Code expires {autoReleaseLabel(order.collection_code_expiry)}.
                  </p>
                ) : null}
              </div>
            ) : null}
            {autoRelease ? (
              <div className="rounded-[8px] border border-ink/8 bg-bone/60 p-4">
                <h3 className="font-semibold text-ink">Auto-release timing</h3>
                <p className="mt-2 text-sm leading-6 text-ink/62">
                  Unless a concern is raised, this order can auto-confirm {autoRelease}.
                </p>
                <Link
                  href={accountRoute(`/account/support?orderId=${order.id}`)}
                  className="mt-4 inline-flex rounded-lg border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink"
                >
                  Raise a concern
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <CommercialBenefitsPanel order={order} data={data} onRefresh={onRefresh} />

      {order.customer_id === data.userId && isPayableOrder(order) ? (
        <section className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-ink">Checkout</h2>
          <p className="mt-3 text-sm leading-7 text-ink/66">
            Start the real provider checkout from web. If this is an extra delivery or shipping fee,
            Drapeon uses the existing fulfillment payment request.
          </p>
          <div className="mt-5">
            <CheckoutAction
              order={order}
              activeQuote={activeQuoteForOrder(data.quotes, order.id)}
              onRefresh={onRefresh}
            />
          </div>
        </section>
      ) : null}

      <TailorOrderActions order={order} data={data} onRefresh={onRefresh} />
      <OpsRefundStatusPanel order={order} data={data} />
      <ReturnResolutionPanel order={order} data={data} onRefresh={onRefresh} />
      <CommercialAdjustmentPanel order={order} data={data} onRefresh={onRefresh} />
      <MaterialAdvancePanel order={order} data={data} onRefresh={onRefresh} />

      <Surface className="p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-needle/80">
              Order brief
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">{briefDossier.title}</h2>
          </div>
          <p className="text-sm font-semibold text-ink/48">
            {briefDossier.sections.length} sections
          </p>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {briefDossier.sections.map((section) => (
            <BriefDossierSectionCard key={section.id} section={section} />
          ))}
        </div>
      </Surface>

      {data.orderEvents.length > 0 ? (
        <Surface className="p-6">
          <SurfaceHeader
            eyebrow="Formal record"
            title="Quote and order decisions"
            description="Versioned decisions are preserved here even when later quotes supersede earlier ones."
          />
          <div className="mt-5 grid gap-3">
            {data.orderEvents.map((event) => (
              <OrderConversationEventCard key={event.id} event={event} />
            ))}
          </div>
        </Surface>
      ) : null}

      <details
        id="order-media"
        className="group scroll-mt-24 rounded-[8px] border border-ink/8 bg-white/84 shadow-sm"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[8px] p-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-needle">
          <span>
            <span className="block text-2xl font-semibold text-ink">Order history</span>
            <span className="mt-1 block text-sm text-ink/58">
              {orderHistorySummary({
                updateCount: updates.length,
                lastUpdatedLabel:
                  updates.length > 0
                    ? formatRelative(updates[updates.length - 1]?.created_at)
                    : null,
                latestEventLabel:
                  updates.length > 0
                    ? fulfillmentAwareHistoryLabel(updates[updates.length - 1]!, true)
                    : 'No production updates yet',
              })}
            </span>
          </span>
          <ChevronDown
            className="size-5 shrink-0 text-needle transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="grid gap-3 border-t border-ink/8 px-6 pb-6 pt-5">
          {updates.length === 0 ? (
            <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
              No production updates yet. Stage photos and videos appear here after the tailor posts
              them from web or the app.
            </p>
          ) : (
            updates.map((update) => (
              <div key={update.id} className="rounded-[8px] border border-ink/6 bg-white p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-3 w-3 rounded-full bg-needle" />
                  <div>
                    <span className="inline-flex rounded-full bg-needle/8 px-3 py-1 text-xs font-semibold text-needle">
                      {fulfillmentAwareHistoryLabel(update)}
                    </span>
                    <p className="mt-1 text-sm leading-6 text-ink/62">
                      {safeUserText(update.note, 'Stage updated.')}
                    </p>
                    <p className="mt-2 text-xs text-ink/46">{formatRelative(update.created_at)}</p>
                  </div>
                </div>
                {update.photo_url ? (
                  <div className="mt-3 max-w-64">
                    <PhotoTile src={update.photo_url} label="Stage media" />
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
        {proofMediaUrls.length > 0 ? (
          <div className="mt-5 border-t border-ink/6 pt-5">
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold text-ink">Proof media</h3>
              <p className="text-xs font-semibold text-ink/48">
                {proofMediaUrls.length} item{proofMediaUrls.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {proofMediaUrls.slice(0, 6).map((src, index) => (
                <PhotoTile
                  key={src + '-' + index}
                  src={src}
                  label={'Production proof ' + (index + 1)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </details>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm">
          <h2 className="text-2xl font-semibold text-ink">Payments</h2>
          <div className="mt-5 grid gap-3">
            {payments.length === 0 ? (
              <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
                No payment record loaded for this order yet.
              </p>
            ) : (
              payments.map((payment) => (
                <SummaryLine
                  key={payment.id}
                  label={cleanLabel(payment.phase, 'Payment')}
                  value={
                    <span className="flex flex-wrap items-center gap-2">
                      {formatMoney(payment.amount, payment.currency)}{' '}
                      <StatusChip status={payment.status} fallback="Pending" />
                    </span>
                  }
                />
              ))
            )}
          </div>
        </div>
        <div
          id="order-messages"
          className="scroll-mt-24 rounded-[8px] border border-ink/8 bg-white/84 p-6 shadow-sm"
        >
          <h2 className="text-2xl font-semibold text-ink">Messages</h2>
          <div className="mt-5 grid gap-3">
            {messages.length === 0 ? (
              <p className="rounded-[8px] bg-bone/70 p-4 text-sm leading-6 text-ink/62">
                No messages on this order yet.
              </p>
            ) : (
              messages.slice(0, 4).map((message) => (
                <div key={message.id} className="rounded-[8px] border border-ink/6 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-needle/76">
                    {message.sender_id === data.userId ? 'You' : 'Other party'} ·{' '}
                    {formatMessageRelative(message.created_at)}
                  </p>
                  <MessageContent message={message} />
                  {message.sender_id === data.userId ? (
                    <p className="mt-3 text-xs font-semibold text-ink/42">
                      {message.read_at
                        ? `✓✓ Read ${formatMessageRelative(message.read_at)}`
                        : '✓ Sent'}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <div className="mt-5">
            <MessageComposer
              order={order}
              consultationBooking={data.consultationBooking}
              onRefresh={onRefresh}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
