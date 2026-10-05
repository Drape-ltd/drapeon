import type { OrderStage } from '@drape/shared/order-machine'
import type { QuoteRevisionReason } from '@drape/shared/order-negotiation'
import type { ReferencePhotoAttribution } from '@drape/shared/reference-photo-attribution'

import type { CurrencyCode } from '@/lib/currency'
import type { MeasurementSnapshotMeta, OrderSupportMeta } from '@/lib/order-support'

export type StageUpdate = {
  id: string
  stage: string
  note: string | null
  photoUrl: string | null
  createdAt: string
}

export type MeasurementSnapshot = Record<string, unknown> & MeasurementSnapshotMeta

export type OrderDetail = {
  id: string
  reference: string
  orderKind: 'CUSTOM' | 'READY_MADE'
  sellerItemId: string | null
  fulfillmentOption: string | null
  garmentType: string
  garmentDescription: string | null
  occasion: string | null
  deadline: string | null
  itemTitle: string | null
  itemSize: string | null
  itemQuantity: number
  itemSubtotal: number | null
  fulfillmentFee: number
  subtotalAmount: number
  platformFeeAmount: number
  taxAmount: number
  importTaxAmount: number
  dutyAmount: number
  taxRateBps: number
  taxRegion: string | null
  taxFallback: boolean
  taxFallbackReason: string | null
  shippingAmount: number
  totalAmount: number
  sourceCurrency: CurrencyCode | null
  sourceAmount: number | null
  stage: OrderStage
  tailorId: string
  tailorName: string
  tailorLocation: string | null
  pickupAddress: string | null
  pickupInstructions: string | null
  quotedAmount: number | null
  quotedCurrency: CurrencyCode
  consultationFee: number | null
  quotedCompletionDate: string | null
  quoteExpiresAt: string | null
  activeQuoteId: string | null
  activeQuoteVersion: number | null
  negotiationRoundLimit: number
  negotiationRoundsUsed: number
  fulfillmentPaymentRequestedAt: string | null
  fulfillmentPaymentPaidAt: string | null
  fulfillmentPaymentProvider: string | null
  fulfillmentPaymentIntentId: string | null
  fulfillmentPaymentCheckoutUrl: string | null
  fabricSource: string
  fabricFundingPolicyVersion: string | null
  deliveryMethod: string
  deliveryAddress: string | null
  recipientName: string | null
  recipientPhone: string | null
  fabricTracking: string | null
  trackingNumber: string | null
  carrier: string | null
  fulfillmentProvider: string | null
  fulfillmentReference: string | null
  fulfillmentContactName: string | null
  fulfillmentContactPhone: string | null
  referencePhotos: string[]
  referencePhotoAttributions?: ReferencePhotoAttribution[]
  collectionCode: string | null
  collectionCodeExpiry: string | null
  videoCallUrl: string | null
  handoffCompletedAt: string | null
  customerHandoffConfirmedAt: string | null
  measurementSnapshot: MeasurementSnapshot | null
  supportMeta: OrderSupportMeta
  customDetail: {
    garmentTypeOther: string | null
    genderPresentation: string | null
    socialReferenceLinks: string[]
    styleNotes: string | null
    bodyNote: string | null
    fabricApprovalRequired: boolean
    fabricApprovalStatus: string | null
    fabricDescription: string | null
    fabricBudgetAmount: number | null
    fabricBudgetCurrency: string | null
    fabricSourcingDeadlineDays: number | null
    fabricSourcingDeadlineAt: string | null
    shippingPreference: string | null
    deliveryInstructions: string | null
    targetDeliveryDate: string | null
  } | null
  stageUpdates: StageUpdate[]
  createdAt: string
}

export type OpenQuoteRevision = {
  id: string
  roundNumber: number
  reasonCodes: QuoteRevisionReason[]
  note: string
  targetAmount: number | null
  currency: string
}

export type GroupMember = {
  id: string
  displayName: string
  status: 'DRAFT' | 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'REMOVED' | string
  inviteCode: string
  invitedUserId: string | null
  acceptedAt: string | null
}

export type GroupMemberListResponse = {
  ok?: boolean
  members?: GroupMember[]
}

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
  estimateStorageBucket: string | null
  estimateStoragePath: string | null
  receiptUrl: string | null
  receiptStorageBucket: string | null
  receiptStoragePath: string | null
  acquiredStorageBucket: string | null
  acquiredStoragePath: string | null
  reconciliationStatus: string | null
  reconciliationOutcome: string | null
  reconciliationResolution: string | null
  customerRefundAmount: number
  unapprovedOverageAmount: number
  receiptNote: string | null
  customerResponseNote: string | null
  customerResponseReason: string | null
  createdAt: string
  fundingSource: 'LEGACY_SEPARATE_PAYMENT' | 'FUNDED_FABRIC_ALLOWANCE'
  providerReleaseStatus: string | null
}
