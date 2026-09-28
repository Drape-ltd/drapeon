import { Colors } from '@/constants/theme'
import type { OrderDetail } from '@/features/orders/tailor/TailorOrderTypes'
import { isReadyMadePreparationStage, tailorOrderStageLabel } from '@/lib/order-flow'
import { decodeDisplayText } from '@drape/shared/display-text'
import { type OrderStage } from '@drape/shared/order-machine'
import type { StageUpdate } from './TailorOrderTypes'

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

export function normalizeExternalHref(value: string) {
  return /^https?:\/\//iu.test(value) ? value : `https://${value}`
}

export function labelShippingPreference(value: string | null | undefined) {
  if (value === 'EXPRESS') return 'Express'
  if (value === 'STANDARD') return 'Standard'
  return null
}

export function labelFabricApprovalStatus(value: string | null | undefined) {
  if (value === 'PENDING_TAILOR_UPLOAD') return 'Waiting for sourced fabric upload'
  if (value === 'PENDING_CUSTOMER_APPROVAL') return 'Waiting for customer approval'
  if (value === 'APPROVED') return 'Approved by customer'
  if (value === 'CHANGES_REQUESTED') return 'Customer requested changes'
  if (value === 'UNSUITABLE') return 'Marked unsuitable'
  if (value === 'OPS_REVIEW') return 'Ops review needed'
  return null
}

export function linkHostLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./u, '')
  } catch {
    return value
  }
}

export function orderStatusGuidance(
  stage: OrderStage,
  orderKind: 'CUSTOM' | 'READY_MADE'
): string | null {
  if (stage === 'CONSULTATION') {
    return 'Use the consultation to clarify fit, fabric, and expectations before you send a quote. You and the customer are next to align on the brief.'
  }
  if (stage === 'QUOTE_SENT') {
    return 'Your quote is with the customer. They are next to accept, decline, or let it expire.'
  }
  if (stage === 'PAYMENT_PENDING') {
    return orderKind === 'READY_MADE'
      ? 'Checkout is still open. The customer is next to finish payment before fulfilment can start. If they say their bank charged them, ask them not to pay again while Drapeon reconciles it.'
      : 'The customer has started payment. They are next to finish payment before production can start. If they say their bank charged them, ask them not to pay again while Drapeon reconciles it.'
  }
  if (stage === 'PAYMENT_FAILED') {
    return orderKind === 'READY_MADE'
      ? 'Checkout failed. The customer is next to retry within 2 hours before this order is cancelled automatically.'
      : 'Payment failed. The customer is next to retry within 2 hours before this order is cancelled automatically.'
  }
  if (stage === 'CONFIRMED') {
    return orderKind === 'READY_MADE'
      ? 'Payment is confirmed. You are next to start preparing this order for dispatch or pickup.'
      : 'The customer has accepted your quote. You are next to move this order into the first real production stage when work begins.'
  }
  if (orderKind === 'READY_MADE' && isReadyMadePreparationStage(stage)) {
    return 'You are still next. Keep packing and checking this order until it is truly ready for Drapeon dispatch or pickup.'
  }
  if (stage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'This order is packed and waiting for Drapeon ops. Drapeon is next to arrange dispatch from here.'
  }
  if (stage === 'DESIGNING') {
    return 'Design details and pattern decisions are underway. You are next to advance when the design is stable enough to source or cut.'
  }
  if (stage === 'SOURCING') {
    return 'Fabric and materials are being sourced for this order. You are next to advance when cutting can begin.'
  }
  if (stage === 'CUTTING') {
    return 'Cutting is underway. You are next to advance when sewing can begin.'
  }
  if (stage === 'SEWING') {
    return 'Sewing is underway. You are next to advance when the garment is ready for finishing.'
  }
  if (stage === 'FINISHING') {
    return orderKind === 'READY_MADE'
      ? 'Final packing and quality checks are underway. When the order is truly handoff-ready, mark it for Drapeon dispatch or collection.'
      : 'Final touches and quality checks are underway. When the order is truly handoff-ready, mark it for Drapeon dispatch or collection.'
  }
  if (stage === 'OUT_FOR_DELIVERY') {
    return 'This order is with a local delivery partner. Drapeon and the customer are next until the handoff is confirmed.'
  }
  if (stage === 'SHIPPED') {
    return 'This order is on its way to the customer. The customer is next once it arrives, unless a delivery issue opens first.'
  }
  if (stage === 'READY_FOR_COLLECTION') {
    return 'The order is ready to hand over. The customer is next at pickup, and you should confirm the collection code when they arrive. Drapeon may follow up if pickup is delayed.'
  }
  if (stage === 'DELIVERED') {
    return 'Delivery is confirmed. The 72-hour customer review window is open, and payout stays protected until it closes.'
  }
  if (stage === 'COLLECTED') {
    return 'Collection is confirmed. The 72-hour customer review window is open, and payout stays protected until it closes.'
  }
  if (stage === 'COMPLETE') {
    return 'This order is complete. You can still revisit the full brief, measurements, and timeline here any time.'
  }
  if (stage === 'IN_DISPUTE') {
    return 'This order is paused while the customer concern is being reviewed.'
  }
  return null
}

export function quotedAmountLabel(
  stage: OrderStage,
  orderKind: 'CUSTOM' | 'READY_MADE',
  fulfillmentPaymentPending = false
): string {
  if (orderKind === 'READY_MADE') {
    if (stage === 'PAYMENT_PENDING') return 'awaiting payment'
    if (stage === 'PAYMENT_FAILED') return 'payment failed'
    if (stage === 'DELIVERED' || stage === 'COLLECTED') return 'review window'
    if (fulfillmentPaymentPending) return 'item paid'
    if (stage === 'COMPLETE') return 'closed out'
    return 'seller amount'
  }
  if (fulfillmentPaymentPending) return 'base quote paid'
  if (stage === 'QUOTE_SENT') return 'quoted'
  if (stage === 'PAYMENT_PENDING') return 'awaiting payment'
  if (stage === 'PAYMENT_FAILED') return 'payment failed'
  if (stage === 'DELIVERED' || stage === 'COLLECTED') return 'awaiting finish'
  if (stage === 'COMPLETE') return 'closed out'
  return 'seller amount'
}

export function formatTimelineDate(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
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

export function displayText(value: string | null | undefined, fallback = '') {
  const decoded = decodeDisplayText(value ?? '').trim()
  return decoded || fallback
}

export function displayNullableText(value: string | null | undefined) {
  const decoded = displayText(value)
  return decoded || null
}

export function hasSuccessfulPaymentEvent(updates: StageUpdate[]) {
  return updates.some((update) => {
    const note = update.note?.toLowerCase() ?? ''
    return update.stage === 'CONFIRMED' && note.includes('payment confirmed')
  })
}

export function isResolvedCheckoutAttempt(
  update: Pick<StageUpdate, 'stage' | 'note'>,
  successfulPaymentExists: boolean
) {
  if (!successfulPaymentExists) return false
  const note = update.note?.toLowerCase() ?? ''
  return (
    update.stage === 'PAYMENT_FAILED' ||
    update.stage === 'PAYMENT_PENDING' ||
    note.includes('checkout started') ||
    note.includes('payment started')
  )
}

export function timelineStageLabel(
  update: Pick<StageUpdate, 'stage' | 'note'>,
  orderKind: 'CUSTOM' | 'READY_MADE',
  successfulPaymentExists = false
) {
  const note = update.note?.toLowerCase() ?? ''
  if (isResolvedCheckoutAttempt(update, successfulPaymentExists)) {
    return update.stage === 'PAYMENT_FAILED' ? 'Earlier checkout failed' : 'Earlier checkout opened'
  }
  if (update.stage === 'CONFIRMED' && note.includes('payment confirmed')) {
    return 'Payment confirmed'
  }
  if (
    update.stage === 'CONFIRMED' &&
    (note.includes('guided fit profile') || note.includes('fit intake'))
  ) {
    return 'Measurements reviewed'
  }
  return tailorOrderStageLabel(update.stage as OrderStage, orderKind)
}

export function timelineDotColor(
  update: Pick<StageUpdate, 'stage' | 'note'>,
  successfulPaymentExists = false
) {
  const note = update.note?.toLowerCase() ?? ''
  if (isResolvedCheckoutAttempt(update, successfulPaymentExists)) {
    return Colors.midGrey
  }
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

export function timelineNoteText(
  update: Pick<StageUpdate, 'stage' | 'note'>,
  successfulPaymentExists: boolean
) {
  if (isResolvedCheckoutAttempt(update, successfulPaymentExists)) {
    return update.stage === 'PAYMENT_FAILED'
      ? 'An earlier checkout attempt failed, then the customer completed payment successfully.'
      : 'An earlier checkout was opened before the successful payment.'
  }
  return update.note
}

export function baseAmount(
  order: Pick<
    OrderDetail,
    | 'orderKind'
    | 'itemSubtotal'
    | 'quotedAmount'
    | 'fulfillmentFee'
    | 'sourceAmount'
    | 'subtotalAmount'
    | 'taxAmount'
  >
) {
  if (typeof order.sourceAmount === 'number' && order.sourceAmount > 0) {
    return order.sourceAmount
  }
  if (typeof order.subtotalAmount === 'number' && order.subtotalAmount > 0) {
    return order.subtotalAmount
  }
  if (order.orderKind === 'READY_MADE') {
    return (
      order.itemSubtotal ??
      (order.quotedAmount != null ? Math.max(order.quotedAmount - order.fulfillmentFee, 0) : null)
    )
  }
  if (order.quotedAmount == null) return null
  return Math.max(order.quotedAmount - order.fulfillmentFee - (order.taxAmount ?? 0), 0)
}

// Linear next stages (one option only)
export const PRODUCTION_NEXT: Partial<Record<OrderStage, OrderStage>> = {
  CUTTING: 'SEWING',
  SEWING: 'FINISHING',
}

// Flexible next stages — tailor chooses which pre-production phase to start
export const FLEXIBLE_NEXT_STAGES: Partial<Record<OrderStage, OrderStage[]>> = {
  CONFIRMED: ['DESIGNING'],
  DESIGNING: ['SOURCING', 'CUTTING'],
  SOURCING: ['CUTTING'],
}

export const PRE_CUTTING_STAGES: OrderStage[] = [
  'PENDING_QUOTE',
  'CONSULTATION',
  'QUOTE_SENT',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
]
export type StageSubmissionPurpose = 'STAGE_PROGRESS' | 'FABRIC_APPROVAL'
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

export const GARMENT_CONTEXT_LABELS: Record<string, string> = {
  MENSWEAR: 'Menswear cuts',
  WOMENSWEAR: 'Womenswear cuts',
  BOTH: 'Both',
  PREFER_NOT: 'Prefer not to say',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
}
export const BODY_SHAPE_LABELS: Record<string, string> = {
  RECTANGLE: 'Rectangle',
  BROAD_SHOULDERS: 'Broad shoulders',
  FULL_HIPS: 'Full hips',
  DEFINED_WAIST: 'Defined waist',
  FULL_MIDSECTION: 'Full midsection',
  ATHLETIC: 'Athletic / muscular',
  PREFER_NOT: 'Prefer not to say',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
}
