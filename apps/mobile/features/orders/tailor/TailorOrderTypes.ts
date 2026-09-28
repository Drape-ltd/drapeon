import type { CurrencyCode } from '@/lib/currency'
import type { MeasurementSnapshotMeta, OrderSupportMeta } from '@/lib/order-support'
import type { OrderStage } from '@drape/shared/order-machine'

export type StageUpdate = {
  id: string
  stage: string
  note: string | null
  photoUrl: string | null
  createdAt: string
}

export type OrderDetail = {
  id: string
  reference: string
  garmentType: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  fulfillmentOption: string | null
  itemTitle: string | null
  itemSize: string | null
  itemQuantity: number
  itemSubtotal: number | null
  fulfillmentFee: number
  garmentDescription: string | null
  stage: OrderStage
  customerId: string
  customerName: string
  tailorProfileId: string | null
  quotedAmount: number | null
  quotedCurrency: string
  quotedCompletionDate: string | null
  activeQuoteId: string | null
  activeQuoteVersion: number | null
  negotiationRoundLimit: number
  negotiationRoundsUsed: number
  sourceAmount: number | null
  subtotalAmount: number
  taxAmount: number
  taxRateBps: number
  taxRegion: string | null
  taxFallback: boolean
  shippingAmount: number
  totalAmount: number
  fulfillmentPaymentRequestedAt: string | null
  fulfillmentPaymentPaidAt: string | null
  fulfillmentPaymentProvider: string | null
  fulfillmentPaymentIntentId: string | null
  fulfillmentPaymentCheckoutUrl: string | null
  fabricSource: string
  deliveryMethod: string
  deliveryAddress: string | null
  fabricFundingPolicyVersion: string | null
  recipientName: string | null
  recipientPhone: string | null
  trackingNumber: string | null
  carrier: string | null
  fulfillmentProvider: string | null
  fulfillmentReference: string | null
  fulfillmentContactName: string | null
  fulfillmentContactPhone: string | null
  referencePhotos: string[]
  fitNote: string | null
  measurements: Measurement | null
  supportMeta: OrderSupportMeta
  customDetail: {
    garmentTypeOther: string | null
    genderPresentation: string | null
    socialReferenceLinks: string[]
    styleNotes: string | null
    bodyNote: string | null
    fabricDescription: string | null
    fabricBudgetAmount: number | null
    fabricBudgetCurrency: string | null
    fabricSourcingDeadlineDays: number | null
    fabricSourcingDeadlineAt: string | null
    fabricApprovalStatus: string | null
    shippingPreference: string | null
    deliveryInstructions: string | null
    targetDeliveryDate: string | null
  } | null
  collectionCode: string | null
  videoCallUrl: string | null
  occasion: string | null
  deadline: string | null
  createdAt: string
  stageUpdates: StageUpdate[]
}

export type Measurement = {
  [key: string]: unknown
  chest: number | null
  waist: number | null
  hips: number | null
  shoulderWidth: number | null
  inseam: number | null
  sleeveLength: number | null
  neckCircumference: number | null
  height: number | null
  unit: string
  backLength?: number | null
  outseam?: number | null
  thighCircumference?: number | null
  kneeCircumference?: number | null
  torsoLength?: number | null
  fitStyle: string | null
  garmentContext: string | null
  bodyShape: string | string[] | null
  fitFlags: string[]
  bodyNote: string | null
} & MeasurementSnapshotMeta

export type MaterialAdvanceStatus =
  | 'REQUESTED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'PAID'
  | 'OPS_REVIEW'
  | 'RELEASED'
  | 'BLOCKED'
  | 'DECLINED'
  | 'CANCELLED'

export type MaterialAdvance = {
  id: string
  title: string
  description: string
  amount: number
  currency: CurrencyCode
  status: MaterialAdvanceStatus
  releaseStatus: string | null
  receiptUrl: string | null
  receiptStorageBucket: string | null
  receiptStoragePath: string | null
  acquiredStorageBucket: string | null
  acquiredStoragePath: string | null
  receiptNote: string | null
  actualSpent: number | null
  reconciliationStatus: string | null
  reconciliationOutcome: string | null
  reconciliationResolution: string | null
  customerRefundAmount: number
  unapprovedOverageAmount: number
  reconciledAt: string | null
  customerResponseReason: string | null
  customerResponseNote: string | null
  customerApprovedAt: string | null
  customerDeclinedAt: string | null
  createdAt: string
  fundingSource: 'LEGACY_SEPARATE_PAYMENT' | 'FUNDED_FABRIC_ALLOWANCE'
  providerReleaseStatus: string | null
}
