import { Colors } from '@/constants/theme'
import { formatConsultationStart } from '@/features/orders/customer/CustomerOrderFormatting'
import type { OrderDetail, StageUpdate } from '@/features/orders/customer/contracts'
import { customerOrderStageLabel, isReadyMadePreparationStage } from '@/lib/order-flow'
import { formatTaxRate } from '@drape/shared'
import { CANCELLATION_REFUND_COMPONENT_LABELS } from '@drape/shared/cancellation-policy'
import { filterContactInfo } from '@drape/shared/contact-filter'
import { decodeDisplayText } from '@drape/shared/display-text'
import { type OrderStage } from '@drape/shared/order-machine'

export const SUPPORT_EMAIL = 'support@drapeon.co'
export const AFTERCARE_WINDOW_DAYS = 14
export const AFTERCARE_WINDOW_MS = AFTERCARE_WINDOW_DAYS * 24 * 60 * 60 * 1000
export const ORDER_DETAIL_POLL_INTERVAL_MS = 60_000
export function asStringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

export function formatReadableDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'the saved date'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function formatTimelineTimestamp(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Time not available'
  const day = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(date)
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
  return `${day} at ${time}`
}

export function formatOrderUpdateNote(value: string) {
  const note = displayText(value)
  return note.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/g, (timestamp) =>
    formatConsultationStart(timestamp)
  )
}

export function timelineStageLabel(
  update: Pick<StageUpdate, 'stage' | 'note'>,
  orderKind: 'CUSTOM' | 'READY_MADE'
) {
  const note = update.note?.toLowerCase() ?? ''
  if (update.stage === 'CONFIRMED' && note.includes('payment confirmed')) {
    return 'Payment confirmed'
  }
  if (
    update.stage === 'CONFIRMED' &&
    (note.includes('guided fit profile') || note.includes('fit intake'))
  ) {
    return 'Measurements reviewed'
  }
  return customerOrderStageLabel(update.stage as OrderStage, orderKind) ?? update.stage
}

export function timelineDotColor(update: Pick<StageUpdate, 'stage' | 'note'>) {
  const note = update.note?.toLowerCase() ?? ''
  if (update.stage === 'PAYMENT_FAILED' || note.includes('failed') || note.includes('cancel')) {
    return Colors.error
  }
  if (
    update.stage === 'PAYMENT_PENDING' ||
    note.includes('checkout started') ||
    note.includes('payment started')
  ) {
    return Colors.statusPending
  }
  if (update.stage === 'IN_DISPUTE' || note.includes('concern') || note.includes('review')) {
    return Colors.kanteRust
  }
  return Colors.needleGreen
}

export function getAftercareStatus(order: OrderDetail) {
  if (!['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(order.stage)) {
    return {
      available: false,
      message: 'Aftercare opens after delivery or collection is confirmed.',
      closesAt: null as string | null,
    }
  }

  const anchor = order.customerHandoffConfirmedAt ?? order.handoffCompletedAt
  if (!anchor) {
    return {
      available: false,
      message:
        'Confirm delivery or collection first, then Drapeon can open the 14-day aftercare window.',
      closesAt: null as string | null,
    }
  }

  const anchorMs = Date.parse(anchor)
  if (!Number.isFinite(anchorMs)) {
    return {
      available: false,
      message:
        'We could not read the delivery confirmation time. Contact support and keep photos in the order thread.',
      closesAt: null as string | null,
    }
  }

  const closesAt = new Date(anchorMs + AFTERCARE_WINDOW_MS).toISOString()
  if (Date.parse(closesAt) < Date.now()) {
    return {
      available: false,
      message: `The ${AFTERCARE_WINDOW_DAYS}-day aftercare window has closed. Contact support if this is a serious safety, fraud, or workmanship concern.`,
      closesAt,
    }
  }

  return {
    available: true,
    message: `Aftercare is open until ${formatReadableDate(closesAt)}. Add photos in the order thread before sending.`,
    closesAt,
  }
}

// The custom production journey is intentionally explicit. Designing and sourcing
// are visible customer milestones, not hidden history entries.
export const CUSTOM_PROGRESS_STAGES: OrderStage[] = [
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'CUTTING',
  'SEWING',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
]
export const READY_MADE_PROGRESS_STAGES: OrderStage[] = [
  'CONFIRMED',
  'FINISHING',
  'READY_FOR_DRAPE_DISPATCH',
  'SHIPPED',
]

// Stages that are before production starts — show a "Waiting" pre-step
export const PRE_PRODUCTION_STAGES: OrderStage[] = [
  'CONSULTATION',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
]
export const PRE_CUTTING_STAGES: OrderStage[] = [
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
]
export const SCOPE_CHANGE_STAGES: OrderStage[] = [
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
]
export const CUSTOM_PROGRESS_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  DESIGNING: 'Design',
  SOURCING: 'Fabric',
  CUTTING: 'Cutting',
  SEWING: 'Sewing',
  FINISHING: 'Finishing',
  READY_FOR_DRAPE_DISPATCH: 'Dispatch',
  SHIPPED: 'Shipped',
}

export function progressStagesForOrder(orderKind: 'CUSTOM' | 'READY_MADE') {
  return orderKind === 'READY_MADE' ? READY_MADE_PROGRESS_STAGES : CUSTOM_PROGRESS_STAGES
}

export function progressLabel(
  stage: OrderStage,
  orderKind: 'CUSTOM' | 'READY_MADE',
  isCollection: boolean,
  currentOrderStage?: OrderStage
) {
  const terminalHandoffLabel =
    currentOrderStage && isHandoffCompleteStage(currentOrderStage)
      ? isCollection
        ? 'Collected'
        : 'Delivered'
      : null

  if (orderKind === 'READY_MADE') {
    if (stage === 'CONFIRMED') return 'Placed'
    if (stage === 'FINISHING') return 'Preparing'
    if (stage === 'READY_FOR_DRAPE_DISPATCH') return 'Dispatch'
    if (stage === 'OUT_FOR_DELIVERY') return 'On the way'
    if (stage === 'SHIPPED' && terminalHandoffLabel) return terminalHandoffLabel
    if (stage === 'SHIPPED') return isCollection ? 'Ready' : 'Shipped'
  }
  if (stage === 'READY_FOR_DRAPE_DISPATCH') return 'Dispatch'
  if (stage === 'OUT_FOR_DELIVERY') return 'On the way'
  if (stage === 'SHIPPED' && terminalHandoffLabel) return terminalHandoffLabel
  if (stage === 'SHIPPED' && currentOrderStage === 'READY_FOR_COLLECTION' && !isCollection) {
    return 'Dispatch'
  }
  return isCollection && stage === 'SHIPPED' ? 'Ready' : CUSTOM_PROGRESS_LABELS[stage]
}

export function isHandoffCompleteStage(stage: OrderStage) {
  return ['DELIVERED', 'COLLECTED', 'COMPLETE'].includes(stage)
}

export function stageIndex(stage: OrderStage, orderKind: 'CUSTOM' | 'READY_MADE'): number {
  // Map READY_FOR_COLLECTION -> same level as SHIPPED.
  // Map delivered / collected / complete -> final shipped-ready milestone in the progress bar.
  const normalised =
    stage === 'READY_FOR_COLLECTION'
      ? 'SHIPPED'
      : stage === 'OUT_FOR_DELIVERY'
        ? 'SHIPPED'
        : stage === 'READY_FOR_DRAPE_DISPATCH'
          ? 'READY_FOR_DRAPE_DISPATCH'
          : orderKind === 'READY_MADE' && isReadyMadePreparationStage(stage)
            ? 'FINISHING'
            : stage === 'DELIVERED' || stage === 'COLLECTED' || stage === 'COMPLETE'
              ? 'SHIPPED'
              : stage
  return progressStagesForOrder(orderKind).indexOf(normalised as OrderStage)
}

export function handoffOpsButtonLabel(deliveryMethod: string, hasOpenIssue: boolean) {
  if (deliveryMethod === 'LOCAL_COLLECTION') {
    return hasOpenIssue ? 'Update pickup help for Drapeon' : 'Log pickup help for Drapeon'
  }
  return hasOpenIssue ? 'Update Drapeon dispatch help' : 'Contact Drapeon dispatch'
}

export function stageGuidance(
  stage: OrderStage,
  deliveryMethod: string,
  orderKind: 'CUSTOM' | 'READY_MADE'
): string | null {
  if (stage === 'CONSULTATION') {
    return 'Consultation comes before the quote. You and the tailor are next to clarify the work before pricing is final.'
  }
  if (stage === 'PAYMENT_PENDING') {
    return orderKind === 'READY_MADE'
      ? 'You are next. Finish checkout to place this order.'
      : 'You are next. Your quote is accepted, but production cannot start until payment is completed.'
  }
  if (stage === 'PAYMENT_FAILED') {
    return orderKind === 'READY_MADE'
      ? 'Checkout did not complete. You are next to retry payment before this checkout is cancelled automatically.'
      : 'Payment did not complete. You are next to retry payment before this order is cancelled automatically.'
  }
  if (stage === 'CONFIRMED') {
    return orderKind === 'READY_MADE'
      ? deliveryMethod === 'LOCAL_COLLECTION'
        ? 'Your order has been placed. The seller is next to prepare it for pickup.'
        : 'Your payment is confirmed. The seller is next to prepare the order.'
      : 'Your order is confirmed. The tailor is next to begin the first real work stage.'
  }
  if (orderKind === 'READY_MADE' && isReadyMadePreparationStage(stage)) {
    return deliveryMethod === 'LOCAL_COLLECTION'
      ? 'Your seller is packing and checking this order. Once it is truly ready, they will mark it ready for collection.'
      : 'Your seller is packing and checking this order. The next handoff step appears here once it is ready.'
  }
  if (stage === 'READY_FOR_DRAPE_DISPATCH') {
    return deliveryMethod === 'LOCAL_DELIVERY'
      ? 'Your seller has packed the order. Drapeon is next to arrange local delivery now.'
      : 'Your seller has packed the order. Drapeon is next to arrange shipment now.'
  }
  if (stage === 'DESIGNING') {
    return 'The tailor is working through design details and pattern decisions.'
  }
  if (stage === 'SOURCING') {
    return 'The tailor is sourcing the agreed fabric or materials.'
  }
  if (stage === 'CUTTING') {
    return 'Fabric is being cut. This is the point where the garment starts becoming irreversible.'
  }
  if (stage === 'SEWING') {
    return 'Your garment is being sewn.'
  }
  if (stage === 'FINISHING') {
    return 'Final checks and finishing are underway before handoff.'
  }
  if (stage === 'OUT_FOR_DELIVERY') {
    return 'A local delivery partner is bringing your order to you now. Be reachable on the phone tied to this order.'
  }
  if (stage === 'SHIPPED') {
    return 'A courier has accepted the parcel. You are next once it arrives, either to confirm receipt or raise a concern.'
  }
  if (stage === 'DELIVERED') {
    return 'Delivery is confirmed. Your 72-hour review window is open before payout is released to the tailor.'
  }
  if (stage === 'COLLECTED') {
    return 'Collection is confirmed. Your 72-hour review window is open before payout is released to the tailor.'
  }
  if (stage === 'COMPLETE') {
    return 'This order is complete.'
  }
  if (stage === 'IN_DISPUTE') {
    return 'Your concern is under review.'
  }
  if (stage === 'READY_FOR_COLLECTION' && deliveryMethod === 'LOCAL_COLLECTION') {
    return 'Bring your collection code to pickup. Exact pickup details are shown below.'
  }
  return null
}

export function refundCoverageLabel(components: string[]) {
  return components
    .map(
      (component) =>
        CANCELLATION_REFUND_COMPONENT_LABELS[
          component as keyof typeof CANCELLATION_REFUND_COMPONENT_LABELS
        ]
    )
    .join(', ')
}

export function preProductionLabel(stage: OrderStage, orderKind: 'CUSTOM' | 'READY_MADE') {
  if (stage === 'CONSULTATION') return 'Consultation scheduled'
  if (stage === 'PAYMENT_PENDING') {
    return orderKind === 'READY_MADE' ? 'Waiting for payment' : 'Awaiting payment'
  }
  if (stage === 'PAYMENT_FAILED') {
    return orderKind === 'READY_MADE' ? 'Payment failed' : 'Retry payment'
  }
  return 'Awaiting confirmation'
}

export function taxLabelForOrder(
  order: Pick<OrderDetail, 'taxFallback' | 'taxRegion' | 'taxRateBps'>
) {
  const region = order.taxRegion?.trim() || 'Tax'
  const rate = order.taxRateBps > 0 ? ` (${formatTaxRate(order.taxRateBps)})` : ''
  return `${order.taxFallback ? 'Estimated ' : ''}${region}${rate}`
}

export function fulfillmentOptionLabel(
  option: OrderDetail['fulfillmentOption'],
  deliveryMethod: OrderDetail['deliveryMethod']
) {
  if (option === 'PICKUP' || deliveryMethod === 'LOCAL_COLLECTION') return 'Pickup'
  if (option === 'DELIVERY' || deliveryMethod === 'LOCAL_DELIVERY') return 'Delivery'
  if (option === 'SHIPPING') return 'Shipping'
  return option ?? 'Fulfillment'
}

export function pendingFulfillmentPaymentLabel(
  order: Pick<OrderDetail, 'deliveryMethod' | 'fulfillmentOption'>
) {
  if (order.deliveryMethod === 'LOCAL_DELIVERY' || order.fulfillmentOption === 'DELIVERY')
    return 'Delivery payment requested'
  return 'Extra shipping payment requested'
}

export function hasPendingFulfillmentPayment(
  order: Pick<
    OrderDetail,
    | 'deliveryMethod'
    | 'fulfillmentFee'
    | 'fulfillmentPaymentRequestedAt'
    | 'fulfillmentPaymentPaidAt'
  >
) {
  return (
    order.deliveryMethod !== 'LOCAL_COLLECTION' &&
    order.fulfillmentFee > 0 &&
    !!order.fulfillmentPaymentRequestedAt &&
    !order.fulfillmentPaymentPaidAt
  )
}

export function safeOperationalText(value: string | null | undefined, fallback: string) {
  if (!value) return null
  const decoded = decodeDisplayText(value)
  return filterContactInfo(decoded).blocked ? fallback : decoded
}

export function displayText(value: string | null | undefined, fallback = '') {
  const decoded = decodeDisplayText(value ?? '').trim()
  return decoded || fallback
}

export function displayNullableText(value: string | null | undefined) {
  const decoded = displayText(value)
  return decoded || null
}
