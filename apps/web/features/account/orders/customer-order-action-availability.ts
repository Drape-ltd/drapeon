'use client'

import {
  FABRIC_FUNDING_POLICY_V2_VERSION,
  isCompletedOrderStage,
  latestFabricApprovalEvidence,
  styleAlignmentChangeFeedbackFromUpdates,
} from '@drape/shared'
import { supportMetaWithConsultationBooking } from '../messages/message-foundation'
import { isTerminalOrder, stringList } from '../shared/account-data-queries'

import {
  CUSTOMER_AFTERCARE_STAGES,
  CUSTOMER_CANCELLATION_REVIEW_STAGES,
  CUSTOMER_COMPLETE_STAGES,
  CUSTOMER_DISPUTE_STAGES,
  CUSTOMER_FABRIC_TRACKING_STAGES,
  CUSTOMER_RECEIPT_STAGES,
  CUSTOMER_SELF_CANCEL_STAGES,
  orderNeedsMeasurementConfirmation,
  type CustomerOrderActionsProps,
} from './customer-order-action-config'
import {
  PRE_CUTTING_STAGES,
  SCOPE_CHANGE_STAGES,
  productionEvidenceFor,
  stageUpdatesFor,
} from './order-action-helpers'

export function customerOrderActionAvailability({
  order,
  data,
}: Pick<CustomerOrderActionsProps, 'order' | 'data'>) {
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
  return {
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
  }
}
