import type { AccountOrder, OrderDetailRenderData } from '../shared/account-data-contracts'
import { measurementSnapshotForOrder } from './order-action-helpers'

export type CustomerOrderActionsProps = {
  order: AccountOrder
  data: OrderDetailRenderData
  onRefresh: () => void
}

export const CUSTOMER_SELF_CANCEL_STAGES = new Set([
  'PENDING_QUOTE',
  'CONSULTATION',
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
])

export const CUSTOMER_CANCELLATION_REVIEW_STAGES = new Set([
  'CONFIRMED',
  'DESIGNING',
  'SOURCING',
  'FINISHING',
])

export const CUSTOMER_DISPUTE_STAGES = new Set([
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

export const CUSTOMER_RECEIPT_STAGES = new Set(['SHIPPED', 'OUT_FOR_DELIVERY'])

export const CUSTOMER_COMPLETE_STAGES = new Set(['DELIVERED', 'COLLECTED'])

export const CUSTOMER_AFTERCARE_STAGES = new Set(['DELIVERED', 'COLLECTED', 'COMPLETE'])

export const CUSTOMER_FABRIC_TRACKING_STAGES = new Set([
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

export const MATERIAL_ISSUE_RESPONSE_OPTIONS = [
  { value: 'REPLACE_FABRIC', label: 'I will replace the fabric' },
  { value: 'ASK_TAILOR_TO_SOURCE', label: 'Ask tailor to source fabric' },
  { value: 'REVISE_DESIGN', label: 'Revise the design' },
  { value: 'CANCEL_ORDER', label: 'Request cancellation review' },
] as const

export function orderNeedsMeasurementConfirmation(order: AccountOrder) {
  return measurementSnapshotForOrder(order)?.needsConfirmation === true
}

export type CustomerOrderActionName =
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

export const CUSTOMER_CANCELLATION_REASON_OPTIONS = [
  { value: 'CUSTOMER_CHANGED_MIND', label: 'Changed my mind' },
  { value: 'NEED_FULFILLMENT_CHANGE', label: 'Need pickup or delivery changed' },
  { value: 'OTHER', label: 'Other' },
] as const

export const CUSTOMER_DELIVERY_REASON_OPTIONS = [
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

export const CUSTOMER_AFTERCARE_OPTIONS = [
  { value: 'FIT_ISSUE', label: 'Fit issue' },
  { value: 'FINISH_ISSUE', label: 'Finish issue' },
  { value: 'DAMAGE_OR_DEFECT', label: 'Damage or defect' },
  { value: 'ALTERATION_FOLLOW_UP', label: 'Alteration follow-up' },
  { value: 'OTHER', label: 'Other' },
] as const
