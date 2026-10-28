import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  type BachsCollectionSucceeded,
  bachsFollowupCollectionReviewReason,
  bachsInitialCollectionReviewReason,
  matchBachsCollection,
} from "../_shared/bachs-collection.ts";
import {
  getBachsWebhookSecrets,
  getServiceRoleKey,
  getSupabaseUrl,
} from "../_shared/env.ts";
import { audit, log } from "../_shared/logger.ts";
import {
  getClientIp,
  RATE_LIMITS,
  rateLimit,
  rateLimitExceededResponse,
} from "../_shared/rateLimit.ts";
import { authorizeCronRequest } from "../_shared/cron.ts";
import {
  enqueueVerifiedPaymentWebhook,
  loadQueuedPaymentWebhook,
  recordRejectedWebhook,
} from "../_shared/payment-webhook.ts";
import {
  findPaymentAttemptByProviderPaymentId,
  markPaymentAttemptStatus,
  markWebhookEventProcessed,
} from "../_shared/payment-ledger.ts";
import {
  createOrRefreshOpsIssue,
  resolveOpsIssueByDedupeKey,
} from "../_shared/ops-issues.ts";
import { verifyBachsWebhookSignature } from "../_shared/bachs-webhook-signature.ts";
import { enqueueOrderConfirmationEmailJob } from "../_shared/payment-side-effects.ts";
import {
  paymentConfirmedStageNote,
  fulfillmentPaymentConfirmedStageNote,
  tailorFulfillmentPaymentConfirmedNotification,
  tailorPaymentConfirmedNotification,
} from "../_shared/payment-copy.ts";
import { sendPushToUser } from "../_shared/notify.ts";
import { getBachsClient } from "../_shared/bachs.ts";
import { getBachsAccount } from "../_shared/bachs-operations.ts";
import { syncBachsPayoutDestination } from "../_shared/bachs-payout-destination.ts";
import { parseOrderSupportMeta, serializeOrderSupportMeta } from "../_shared/order-support.ts";
import { finalizeDispatchShortfallFunding } from "../_shared/drapeon-dispatch.ts";
import {
  matchBachsRefundClaim,
  parseBachsRefundLifecycleEvent,
} from "../_shared/bachs-refund-events.ts";
import {
  matchBachsDisputePayment,
  parseBachsDisputeLifecycleEvent,
} from "../_shared/bachs-dispute-events.ts";
import { resolveDisputeAssociation } from "../_shared/payment-webhook-attempt.ts";
import {
  finalizeRefundOnAttempt,
  recordPendingRefundRequest,
  type RefundablePaymentAttemptRow,
} from "../_shared/payment-refunds.ts";
import {
  type BachsConnectEvent,
  parseBachsAccountRefreshEvent,
  parseBachsWithdrawalEvent,
} from "../_shared/bachs-connect-events.ts";

const FN = "bachs-webhook";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type BachsEvent = BachsConnectEvent;

type BachsOrder = {
  id: string;
  reference: string | null;
  stage: string;
  order_kind: string | null;
  customer_id: string | null;
  tailor_id: string | null;
  payment_provider: string | null;
  payment_intent_id: string | null;
  charge_provider_snapshot: string | null;
  charge_currency_snapshot: string | null;
  accepted_route_snapshot_at: string | null;
  currency: string | null;
  special_note: string | null;
  consultation_fee: number | null;
  delivery_method: string | null;
  fulfillment_fee: number | null;
  fulfillment_payment_requested_at: string | null;
  fulfillment_payment_paid_at: string | null;
  fulfillment_payment_provider: string | null;
  fulfillment_payment_intent_id: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function eventShape(value: unknown): value is BachsEvent {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as BachsEvent).id === "string" &&
    /^evt_[A-Za-z0-9]+$/.test((value as BachsEvent).id) &&
    typeof (value as BachsEvent).type === "string" &&
    (value as BachsEvent).type.length > 0 &&
    typeof (value as BachsEvent).data === "object" &&
    !!(value as BachsEvent).data && !Array.isArray((value as BachsEvent).data);
}

async function issueForEvent(
  supabase: SupabaseClient,
  input: {
    event: BachsEvent;
    orderId?: string | null;
    paymentId?: string | null;
    reason: string;
  },
) {
  await createOrRefreshOpsIssue(supabase, {
    issueType: "PAYMENT_BLOCKED",
    severity: "HIGH",
    source: FN,
    actorRole: "SYSTEM",
    provider: "BACHS",
    orderId: input.orderId ?? null,
    relatedEntityType: input.paymentId
      ? "order_payment"
      : "payment_webhook_event",
    relatedEntityId: input.paymentId ?? input.event.id,
    title: "Bachs payment needs Ops review",
    description:
      `Signed Bachs event ${input.event.type} was saved, but the payment cannot be safely completed automatically (${input.reason}).`,
    recommendedAction:
      "Compare the signed Bachs event, saved payment attempt, accepted route snapshot and current order. Do not create another checkout or payout.",
    dedupeKey: `bachs-webhook-review:${input.event.id}`,
    queueKey: "money-desk",
    persistWhenRoutineDisabled: true,
    metadata: {
      provider_event_id: input.event.id,
      provider_event_type: input.event.type,
      review_reason: input.reason,
    },
  });
}

const BACHS_DISPUTE_ID_PATTERN = /^dsp_[A-Za-z0-9_-]+$/u;

async function blockPriorBachsDisputeForReview(
  supabase: SupabaseClient,
  event: BachsEvent,
) {
  const disputeId = event.data?.dispute_id;
  if (
    typeof disputeId !== "string" || !BACHS_DISPUTE_ID_PATTERN.test(disputeId)
  ) return null;
  const { data, error } = await supabase.from("provider_disputes")
    .select(
      "id,order_id,payment_id,customer_id,tailor_id,provider_charge_id,provider_payment_id,amount,currency,reason,evidence_due_at,metadata",
    )
    .eq("provider", "BACHS")
    .eq("provider_dispute_id", disputeId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;
  const providerUpdatedAt = [event.data?.updated_at, event.created_at]
    .find((value): value is string =>
      typeof value === "string" && Number.isFinite(Date.parse(value))
    ) ?? new Date().toISOString();
  const { error: blockError } = await supabase.rpc(
    "record_bachs_provider_dispute_event",
    {
      p_provider_dispute_id: disputeId,
      p_provider_charge_id: data.provider_charge_id,
      p_provider_payment_id: data.provider_payment_id,
      p_payment_id: data.payment_id,
      p_order_id: data.order_id,
      p_customer_id: data.customer_id,
      p_tailor_id: data.tailor_id,
      p_amount: data.amount,
      p_currency: data.currency,
      p_status: "UNKNOWN",
      p_reason: data.reason,
      p_evidence_due_at: data.evidence_due_at,
      p_provider_event_id: event.id,
      p_provider_event_type: event.type,
      p_provider_updated_at: providerUpdatedAt,
      p_raw_status: typeof event.data?.status === "string"
        ? event.data.status
        : "invalid",
      p_metadata: {
        ...(data.metadata && typeof data.metadata === "object"
          ? data.metadata
          : {}),
        review_only: true,
        review_event_id: event.id,
      },
    },
  );
  if (blockError) {
    // Even if the serialized recorder is temporarily unavailable, never leave
    // an existing dispute's settlement gate open after a malformed update.
    const { error: fallbackError } = await supabase.from("provider_disputes")
      .update({
        status: "UNKNOWN",
        money_movement_blocked: true,
        closed_at: null,
        provider_event_id: event.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (fallbackError) throw fallbackError;
  }
  if (data.order_id) {
    const { error: refreshError } = await supabase.rpc(
      "refresh_order_settlement",
      {
        p_order_id: data.order_id,
      },
    );
    if (refreshError) throw refreshError;
  }
  return {
    disputeId,
    orderId: data.order_id as string | null,
    paymentId: data.payment_id as string | null,
  };
}

async function handleBachsDisputeLifecycle(
  supabase: SupabaseClient,
  event: BachsEvent,
  webhookEventId: string,
) {
  const openReview = async (
    reason: string,
    linkage?: {
      disputeId?: string;
      orderId?: string | null;
      paymentId?: string | null;
    },
  ) => {
    const disputeId = linkage?.disputeId;
    // Invalid or unmatched payloads may not satisfy provider_disputes' amount
    // and identity constraints. Preserve the blocked state if a row exists and
    // always create an Ops case; never fabricate charge facts.
    await createOrRefreshOpsIssue(supabase, {
      issueType: "PAYMENT_BLOCKED",
      severity: "CRITICAL",
      source: FN,
      actorRole: "SYSTEM",
      provider: "BACHS",
      orderId: linkage?.orderId ?? null,
      relatedEntityType: disputeId
        ? "provider_dispute"
        : "payment_webhook_event",
      relatedEntityId: disputeId ?? event.id,
      title: "Bachs payment dispute needs Money Desk review",
      description:
        `Signed Bachs dispute event ${event.type} could not be safely reconciled (${reason}). Unreleased settlement remains blocked where a prior dispute record exists.`,
      recommendedAction:
        "Match the Bachs dispute to the exact saved charge and accepted order snapshot. Review the provider deadline and do not release funds based only on event metadata.",
      dedupeKey: `bachs-dispute:${disputeId ?? event.id}`,
      queueKey: "money-desk",
      persistWhenRoutineDisabled: true,
      notifyOps: true,
      metadata: {
        provider_event_id: event.id,
        provider_event_type: event.type,
        reason,
      },
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: linkage?.orderId ?? null,
      paymentId: linkage?.paymentId ?? null,
      processingResult: `dispute_needs_ops:${reason}`,
      reconciliationRequired: true,
    });
    return { reviewRequired: true, reason };
  };

  let dispute: ReturnType<typeof parseBachsDisputeLifecycleEvent>;
  try {
    dispute = parseBachsDisputeLifecycleEvent(event);
  } catch (error) {
    const prior = await blockPriorBachsDisputeForReview(supabase, event);
    return await openReview(
      error instanceof Error ? error.message : "dispute_event_invalid",
      prior ?? undefined,
    );
  }
  if (!dispute) throw new Error("Bachs dispute event classification failed.");

  const platformAccountId = Deno.env.get("BACHS_PLATFORM_ACCOUNT_ID")?.trim() ??
    "";
  if (
    !platformAccountId || dispute.organizationId !== platformAccountId ||
    event.account
  ) {
    const prior = await blockPriorBachsDisputeForReview(supabase, event);
    return await openReview(
      !platformAccountId
        ? "platform_account_id_missing"
        : "dispute_platform_account_mismatch",
      { disputeId: dispute.disputeId, ...prior },
    );
  }

  const { data: paymentData, error: paymentError } = await supabase.from(
    "order_payments",
  )
    .select(
      "id,order_id,provider,phase,currency,amount,status,provider_payment_id,provider_charge_id",
    )
    .eq("provider", "BACHS")
    .eq("provider_charge_id", dispute.chargeId)
    .maybeSingle();
  if (paymentError) throw paymentError;
  const payment = paymentData as {
    id: string;
    order_id: string;
    provider: string;
    phase: string;
    currency: string;
    amount: number;
    status: string;
    provider_payment_id: string | null;
    provider_charge_id: string | null;
  } | null;
  const paymentMatches = matchBachsDisputePayment(dispute, payment) &&
    ["SUCCEEDED", "PARTIAL_REFUND", "REFUNDED"].includes(payment?.status ?? "");
  const { data: orderData, error: orderError } = paymentMatches && payment
    ? await supabase.from("orders")
      .select(
        "id,customer_id,tailor_id,charge_provider_snapshot,charge_currency_snapshot,accepted_route_snapshot_at",
      )
      .eq("id", payment.order_id).maybeSingle()
    : { data: null, error: null };
  if (orderError) throw orderError;
  const order = orderData as {
    id: string;
    customer_id: string | null;
    tailor_id: string | null;
    charge_provider_snapshot: string | null;
    charge_currency_snapshot: string | null;
    accepted_route_snapshot_at: string | null;
  } | null;
  const snapshotMatches = !!paymentMatches && !!order &&
    order.charge_provider_snapshot === "BACHS" &&
    order.charge_currency_snapshot?.toUpperCase() === dispute.currency &&
    !!order.accepted_route_snapshot_at;
  const { data: priorData, error: priorError } = await supabase.from(
    "provider_disputes",
  )
    .select("payment_id,order_id,customer_id,tailor_id")
    .eq("provider", "BACHS")
    .eq("provider_dispute_id", dispute.disputeId)
    .maybeSingle();
  if (priorError) throw priorError;
  const association = resolveDisputeAssociation(
    snapshotMatches && payment ? payment : null,
    snapshotMatches ? order : null,
    {
      paymentId: priorData?.payment_id ?? null,
      orderId: priorData?.order_id ?? null,
      customerId: priorData?.customer_id ?? null,
      tailorId: priorData?.tailor_id ?? null,
      reconciled: false,
    },
  );
  if (
    !association.reconciled && (priorData?.payment_id || priorData?.order_id)
  ) {
    const prior = await blockPriorBachsDisputeForReview(supabase, event);
    return await openReview("dispute_payment_or_order_snapshot_mismatch", {
      disputeId: dispute.disputeId,
      ...prior,
    });
  }
  const persistedAssociation = association.reconciled ? association : {
    paymentId: null,
    orderId: null,
    customerId: null,
    tailorId: null,
    reconciled: false,
  };
  const savedStatus = persistedAssociation.reconciled
    ? dispute.status
    : "UNKNOWN";
  const { data: recordResult, error: recordError } = await supabase.rpc(
    "record_bachs_provider_dispute_event",
    {
      p_provider_dispute_id: dispute.disputeId,
      p_provider_charge_id: dispute.chargeId,
      p_provider_payment_id: payment?.provider_payment_id ?? null,
      p_payment_id: persistedAssociation.paymentId,
      p_order_id: persistedAssociation.orderId,
      p_customer_id: persistedAssociation.customerId,
      p_tailor_id: persistedAssociation.tailorId,
      p_amount: dispute.disputedAmountMinor,
      p_currency: dispute.currency,
      p_status: savedStatus,
      p_reason: dispute.reason,
      p_evidence_due_at: dispute.responseDeadlineAt,
      p_provider_event_id: dispute.eventId,
      p_provider_event_type: dispute.eventType,
      p_provider_updated_at: dispute.providerUpdatedAt,
      p_raw_status: dispute.rawStatus,
      p_metadata: {
        response_editable: dispute.responseEditable,
        charge_amount_minor: dispute.chargeAmountMinor,
        correlation_id: payment?.id ?? null,
      },
    },
  );
  if (recordError) throw recordError;
  const decision = typeof recordResult === "string" ? recordResult : "INVALID";
  if (
    !["INSERTED", "UPDATED", "DUPLICATE", "STALE", "CONFLICT"].includes(
      decision,
    )
  ) {
    throw new Error("Bachs dispute persistence returned an unknown outcome.");
  }
  if (["STALE", "DUPLICATE"].includes(decision)) {
    if (priorData?.order_id) {
      // A prior webhook may have persisted the dispute transition but failed
      // before refreshing the staged plan; retry that derived freeze/release.
      const { error: refreshError } = await supabase.rpc(
        "refresh_order_settlement",
        {
          p_order_id: priorData.order_id,
        },
      );
      if (refreshError) throw refreshError;
    }
    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: priorData?.order_id ?? persistedAssociation.orderId,
      paymentId: priorData?.payment_id ?? persistedAssociation.paymentId,
      processingResult: `dispute_${decision.toLowerCase()}`,
    });
    return { recorded: true, staleOrDuplicate: true, decision };
  }

  const effectiveAssociation = decision === "CONFLICT" && priorData?.order_id
    ? {
      paymentId: priorData.payment_id,
      orderId: priorData.order_id,
      customerId: priorData.customer_id,
      tailorId: priorData.tailor_id,
      reconciled: false,
    }
    : persistedAssociation;
  const movementBlocked = decision === "CONFLICT" ||
    !effectiveAssociation.reconciled || savedStatus !== "WON";
  const linkedOrderId = effectiveAssociation.orderId;
  if (linkedOrderId) {
    const { error: refreshError } = await supabase.rpc(
      "refresh_order_settlement",
      {
        p_order_id: linkedOrderId,
      },
    );
    if (refreshError) throw refreshError;
  }
  const dedupeKey = `bachs-dispute:${dispute.disputeId}`;
  if (
    decision === "CONFLICT" || !association.reconciled || savedStatus !== "WON"
  ) {
    const lost = savedStatus === "LOST";
    await createOrRefreshOpsIssue(supabase, {
      issueType: lost ? "PAYOUT_BLOCKED" : "PAYMENT_BLOCKED",
      severity: lost ? "CRITICAL" : "HIGH",
      source: FN,
      actorRole: "SYSTEM",
      provider: "BACHS",
      orderId: effectiveAssociation.orderId,
      userId: effectiveAssociation.customerId,
      relatedEntityType: "provider_dispute",
      relatedEntityId: dispute.disputeId,
      title: lost
        ? "Bachs dispute was lost"
        : "Bachs payment dispute needs review",
      description: lost
        ? "Bachs reported a lost dispute. Reconcile the provider debit and any already released funds before changing payout or recovery records."
        : "A Bachs payment dispute is open or could not be reconciled. Unreleased settlement remains blocked while Ops reviews the provider evidence.",
      recommendedAction: lost
        ? "Review the dispute outcome, account balance and released transfers. Do not debit tailor earnings; any recovery remains subject to the separately approved fault-based process."
        : "Review the dispute evidence and provider deadline, then verify the saved charge and accepted order snapshot before resolving the case.",
      dedupeKey,
      queueKey: "money-desk",
      persistWhenRoutineDisabled: true,
      notifyOps: lost || decision === "CONFLICT" || !association.reconciled,
      metadata: {
        provider_event_id: dispute.eventId,
        provider_event_type: dispute.eventType,
        provider_dispute_id: dispute.disputeId,
        provider_charge_id: dispute.chargeId,
        raw_status: dispute.rawStatus,
        disputed_amount_minor: dispute.disputedAmountMinor,
        currency: dispute.currency,
        evidence_due_at: dispute.responseDeadlineAt,
        movement_blocked: movementBlocked,
        record_decision: decision,
      },
    });
  } else {
    await resolveOpsIssueByDedupeKey(supabase, dedupeKey, {
      provider_dispute_id: dispute.disputeId,
      terminal_status: savedStatus,
      provider_event_id: dispute.eventId,
    });
  }

  await audit(supabase, {
    event: "payment.bachs_dispute_recorded",
    actor_role: "SYSTEM",
    order_id: effectiveAssociation.orderId,
    severity: movementBlocked ? "error" : "info",
    payload: {
      function: FN,
      provider_event_id: dispute.eventId,
      provider_dispute_id: dispute.disputeId,
      provider_charge_id: dispute.chargeId,
      status: savedStatus,
      amount_minor: dispute.disputedAmountMinor,
      currency: dispute.currency,
      movement_blocked: movementBlocked,
      record_decision: decision,
    },
  });
  await markWebhookEventProcessed(supabase, webhookEventId, {
    orderId: effectiveAssociation.orderId,
    paymentId: effectiveAssociation.paymentId,
    processingResult: `bachs_dispute_${savedStatus.toLowerCase()}`,
    reconciliationRequired: movementBlocked,
  });
  return {
    recorded: true,
    reconciled: effectiveAssociation.reconciled,
    movementBlocked,
    status: savedStatus,
  };
}

async function processQueuedEvent(
  supabase: SupabaseClient,
  webhookEventId: string,
) {
  const queued = await loadQueuedPaymentWebhook(supabase, {
    webhookEventId,
    provider: "BACHS",
  });
  if (queued.processed_at) return { duplicate: true, processed: true };
  const event = queued.payload as unknown as BachsEvent;
  if (
    !eventShape(event) || event.id !== queued.provider_event_id ||
    event.type !== queued.event_type
  ) {
    await issueForEvent(supabase, {
      event: { id: queued.provider_event_id, type: queued.event_type },
      reason: "stored_event_identity_mismatch",
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      processingResult: "event_identity_mismatch",
      reconciliationRequired: true,
    });
    return { reviewRequired: true };
  }

  const data = event.data ?? {};
  if (event.type === "dispute.created" || event.type === "dispute.updated") {
    return await handleBachsDisputeLifecycle(supabase, event, webhookEventId);
  }
  if (
    event.type === "refund.created" || event.type === "refund.paid" ||
    event.type === "refund.failed"
  ) {
    let refundEvent: ReturnType<typeof parseBachsRefundLifecycleEvent>;
    try {
      refundEvent = parseBachsRefundLifecycleEvent(event);
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "refund_event_invalid";
      await issueForEvent(supabase, { event, reason });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        processingResult: "refund_event_needs_ops_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true, reason };
    }
    if (!refundEvent) {
      throw new Error("Bachs refund event classification failed.");
    }
    const platformAccountId =
      Deno.env.get("BACHS_PLATFORM_ACCOUNT_ID")?.trim() ?? "";
    if (
      !platformAccountId || refundEvent.organizationId !== platformAccountId ||
      event.account
    ) {
      const reason = !platformAccountId
        ? "platform_account_id_missing"
        : "refund_platform_account_mismatch";
      await issueForEvent(supabase, { event, reason });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        processingResult: "refund_account_needs_ops_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true, reason };
    }

    const { data: refundAttemptData, error: refundAttemptError } = await supabase
      .from('order_payment_refund_attempts')
      .select(
        'id,refund_claim_id,attempt_number,provider_reference,idempotency_key,provider_charge_id,provider_refund_id,money_desk_request_id,status'
      )
      .eq('provider_reference', refundEvent.reference)
      .maybeSingle()
    if (refundAttemptError) throw refundAttemptError
    const refundAttempt = refundAttemptData as {
      id: string
      refund_claim_id: string
      attempt_number: number
      provider_reference: string
      idempotency_key: string
      provider_charge_id: string
      provider_refund_id: string | null
      money_desk_request_id: string | null
      status: string
    } | null
    const completeReviewedRefundRetry = async (
      status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED',
      failureCode?: string | null,
      failureSummary?: string | null
    ) => {
      if (!refundAttempt?.money_desk_request_id) return
      const { data: executionAttempt, error: executionAttemptError } = await supabase
        .from('money_desk_execution_attempts')
        .select('id')
        .eq('request_id', refundAttempt.money_desk_request_id)
        .eq('status', 'PROCESSING')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (executionAttemptError) throw executionAttemptError
      if (!executionAttempt?.id) return
      const { error: completionError } = await supabase.rpc('complete_money_desk_execution', {
        p_attempt_id: executionAttempt.id,
        p_status: status,
        p_provider_reference: refundEvent.refundId,
        p_failure_code: failureCode ?? null,
        p_failure_summary: failureSummary ?? null,
      })
      if (completionError) throw completionError
    }
    const { data: refundClaimData, error: refundClaimError } = refundAttempt
      ? await supabase.from("order_payment_refund_claims")
        .select(
          "id,payment_id,order_id,phase,provider,currency,charged_amount,refunded_before,refund_amount,provider_payment_id,status,provider_refund_id",
        )
        .eq("id", refundAttempt.refund_claim_id).maybeSingle()
      : { data: null, error: null };
    if (refundClaimError) throw refundClaimError;
    const refundClaim = refundClaimData as {
      id: string;
      payment_id: string;
      order_id: string;
      phase: string;
      provider: string;
      currency: string;
      charged_amount: number;
      refunded_before: number;
      refund_amount: number;
      provider_payment_id: string;
      status: string;
      provider_refund_id: string | null;
    } | null;
    const matchedRefund = matchBachsRefundClaim({
      event: refundEvent,
      claim: refundClaim,
      attempt: refundAttempt,
    });
    if (!matchedRefund.matches || !refundClaim || !refundAttempt) {
      await completeReviewedRefundRetry(
        'BLOCKED',
        'REFUND_IDENTITY_MISMATCH',
        'A terminal Bachs refund event did not match the reviewed refund attempt.'
      )
      await issueForEvent(supabase, {
        event,
        orderId: refundClaim?.order_id ?? null,
        paymentId: refundClaim?.payment_id ?? null,
        reason: matchedRefund.reason ?? "refund_attempt_missing",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: refundClaim?.order_id ?? null,
        paymentId: refundClaim?.payment_id ?? null,
        processingResult: "refund_identity_needs_ops_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true, reason: matchedRefund.reason };
    }

    const nextAttemptStatus = refundEvent.status === "success"
      ? "SUCCEEDED"
      : refundEvent.status === "failed"
      ? "FAILED_RECONCILED"
      : "PROVIDER_PENDING";
    const { data: outcomeData, error: outcomeError } = await supabase.rpc(
      "record_bachs_payment_refund_attempt_outcome",
      {
        p_attempt_id: refundAttempt.id,
        p_next_status: nextAttemptStatus,
        p_provider_refund_id: refundEvent.refundId,
        p_provider_evidence: {
          provider_event_id: refundEvent.eventId,
          provider_event_type: refundEvent.eventType,
          status: refundEvent.status,
          requested_amount: refundEvent.requestedAmount,
          refunded_amount: refundEvent.refundedAmount,
          charge_id: refundEvent.chargeId,
          reference: refundEvent.reference,
        },
      },
    );
    if (outcomeError) throw outcomeError;
    const outcome = asRecord(outcomeData);
    const outcomeCode = typeof outcome.outcome === "string"
      ? outcome.outcome
      : "INVALID_OUTCOME";
    if (
      outcomeCode === "TERMINAL_CONFLICT" &&
      refundAttempt.status === "SUCCEEDED" &&
      refundAttempt.provider_refund_id === refundEvent.refundId
    ) {
      await completeReviewedRefundRetry(
        'BLOCKED',
        'REFUND_TERMINAL_CONFLICT',
        'Bachs sent a conflicting terminal refund event; Ops reconciliation is required.'
      )
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: refundClaim.order_id,
        paymentId: refundClaim.payment_id,
        processingResult: "stale_refund_event_after_success",
      });
      return { recorded: true, staleEvent: true };
    }
    if (
      !["RECORDED", "EXISTING", "LATE_SUCCESS", "SECOND_SUCCESS_NEEDS_OPS"]
        .includes(outcomeCode)
    ) {
      await completeReviewedRefundRetry(
        'BLOCKED',
        'REFUND_ATTEMPT_OUTCOME_REJECTED',
        'The terminal refund event could not be reconciled to its attempt.'
      )
      await issueForEvent(supabase, {
        event,
        orderId: refundClaim.order_id,
        paymentId: refundClaim.payment_id,
        reason: `refund_attempt_${outcomeCode.toLowerCase()}`,
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: refundClaim.order_id,
        paymentId: refundClaim.payment_id,
        processingResult: "refund_attempt_outcome_needs_ops_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true, reason: outcomeCode };
    }

    const { data: paymentData, error: paymentError } = await supabase.from(
      "order_payments",
    )
      .select(
        "id,order_id,phase,provider,currency,amount,status,provider_payment_id,provider_charge_id,provider_response,refunded_amount,partial_refund_count,consultation_booking_id,consultation_booking_link_source",
      )
      .eq("id", refundClaim.payment_id).maybeSingle();
    if (paymentError) throw paymentError;
    const payment = paymentData as RefundablePaymentAttemptRow | null;
    if (
      !payment || payment.provider !== "BACHS" ||
      payment.provider_payment_id !== refundClaim.provider_payment_id ||
      payment.provider_charge_id !== refundEvent.chargeId ||
      payment.order_id !== refundClaim.order_id ||
      payment.currency !== refundClaim.currency ||
      payment.amount !== refundClaim.charged_amount ||
      !["SUCCEEDED", "PARTIAL_REFUND", "REFUNDED"].includes(payment.status)
    ) {
      await completeReviewedRefundRetry(
        'BLOCKED',
        'REFUND_PAYMENT_SNAPSHOT_MISMATCH',
        'The terminal refund event did not match the payment snapshot.'
      )
      await issueForEvent(supabase, {
        event,
        orderId: refundClaim.order_id,
        paymentId: refundClaim.payment_id,
        reason: "refund_payment_snapshot_mismatch",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: refundClaim.order_id,
        paymentId: refundClaim.payment_id,
        processingResult: "refund_payment_needs_ops_review",
        reconciliationRequired: true,
      });
      return {
        reviewRequired: true,
        reason: "refund_payment_snapshot_mismatch",
      };
    }
    const refundResponse = {
      refund_id: refundEvent.refundId,
      charge_id: refundEvent.chargeId,
      reference: refundEvent.reference,
      status: refundEvent.status,
      requested_amount: refundEvent.requestedAmount,
      refunded_amount: refundEvent.refundedAmount,
    };

    if (refundEvent.status === 'success') {
      if (outcomeCode === 'SECOND_SUCCESS_NEEDS_OPS') {
        await completeReviewedRefundRetry(
          'BLOCKED',
          'SECOND_REFUND_SUCCESS_NEEDS_OPS',
          'A second provider refund succeeded and requires Ops reconciliation.'
        )
        await issueForEvent(supabase, {
          event,
          orderId: refundClaim.order_id,
          paymentId: refundClaim.payment_id,
          reason: "second_provider_refund_succeeded",
        });
        await markWebhookEventProcessed(supabase, webhookEventId, {
          orderId: refundClaim.order_id,
          paymentId: refundClaim.payment_id,
          processingResult: "second_refund_success_needs_ops",
          reconciliationRequired: true,
        });
        return {
          reviewRequired: true,
          reason: "second_provider_refund_succeeded",
        };
      }
      const expectedBefore = refundClaim.refunded_before;
      const paymentRefunded = payment.status === "REFUNDED"
        ? payment.amount
        : payment.refunded_amount ?? 0;
      if (paymentRefunded >= expectedBefore + refundClaim.refund_amount) {
        await completeReviewedRefundRetry('SUCCEEDED')
        await markWebhookEventProcessed(supabase, webhookEventId, {
          orderId: refundClaim.order_id,
          paymentId: refundClaim.payment_id,
          processingResult: "refund_already_finalized",
        });
        return { recorded: true, duplicateFinalization: true };
      }
      if (paymentRefunded !== expectedBefore) {
        await completeReviewedRefundRetry(
          'BLOCKED',
          'REFUND_POSITION_MISMATCH',
          'The payment refund position changed before the provider event was finalized.'
        )
        await issueForEvent(supabase, {
          event,
          orderId: refundClaim.order_id,
          paymentId: refundClaim.payment_id,
          reason: "refund_position_mismatch",
        });
        await markWebhookEventProcessed(supabase, webhookEventId, {
          orderId: refundClaim.order_id,
          paymentId: refundClaim.payment_id,
          processingResult: "refund_position_needs_ops_review",
          reconciliationRequired: true,
        });
        return { reviewRequired: true, reason: "refund_position_mismatch" };
      }
      await finalizeRefundOnAttempt(supabase, {
        attempt: payment,
        refundAmount: refundClaim.refund_amount,
        providerResponse: refundResponse,
        actorRole: "SYSTEM",
        reason: "Confirmed by Bachs refund.paid webhook",
      });
      if (outcomeCode === "LATE_SUCCESS") {
        await issueForEvent(supabase, {
          event,
          orderId: refundClaim.order_id,
          paymentId: refundClaim.payment_id,
          reason: "late_provider_refund_success_after_failure",
        });
      }
    } else {
      await recordPendingRefundRequest(supabase, {
        attempt: payment,
        refundAmount: refundClaim.refund_amount,
        providerResponse: refundResponse,
        actorRole: "SYSTEM",
        reason: `Confirmed by Bachs ${refundEvent.eventType} webhook`,
      })
      if (refundEvent.status === 'failed') {
        await createOrRefreshOpsIssue(supabase, {
          issueType: 'REFUND_FAILED',
          severity: 'CRITICAL',
          source: 'bachs-refund-claims',
          actorRole: 'SYSTEM',
          orderId: refundClaim.order_id,
          provider: 'BACHS',
          title: 'Bachs refund needs reconciliation',
          description:
            'Bachs confirmed this refund attempt failed terminally. Review the platform balance before submitting a new independently approved retry.',
          recommendedAction:
            'Confirm the refund failure, verify available platform balance, then request a new Money Desk retry for this exact attempt. Do not change the accepted earning or payment amount.',
          dedupeKey: `bachs-refund-review:${refundClaim.id}`,
          queueKey: 'money-desk',
          persistWhenRoutineDisabled: true,
          relatedEntityType: 'order_payment',
          relatedEntityId: refundClaim.payment_id,
          metadata: {
            payment_id: refundClaim.payment_id,
            refund_claim_id: refundClaim.id,
            refund_attempt_id: refundAttempt.id,
            safe_reason: 'provider_confirmed_refund_failure',
            retry_eligible: Boolean(refundEvent.refundId),
          },
        })
        await issueForEvent(supabase, {
          event,
          orderId: refundClaim.order_id,
          paymentId: refundClaim.payment_id,
          reason: "provider_confirmed_refund_failure_balance_or_policy",
        });
      }
    }

    if (refundEvent.status === 'success' || refundEvent.status === 'failed') {
      const isUnresolvedSuccess =
        outcomeCode === 'LATE_SUCCESS' || outcomeCode === 'SECOND_SUCCESS_NEEDS_OPS'
      await completeReviewedRefundRetry(
        refundEvent.status === 'failed' ? 'FAILED' : isUnresolvedSuccess ? 'BLOCKED' : 'SUCCEEDED',
        refundEvent.status === 'failed' ? 'PROVIDER_REFUND_FAILED' : null,
        refundEvent.status === 'failed'
          ? 'Bachs reported that the reviewed refund retry failed.'
          : isUnresolvedSuccess
            ? 'A late or duplicate refund success requires Ops reconciliation.'
            : null
      )
      if (refundEvent.status === 'success' && !isUnresolvedSuccess) {
        await resolveOpsIssueByDedupeKey(supabase, `bachs-refund-review:${refundClaim.id}`, {
          refund_claim_id: refundClaim.id,
          provider_refund_id: refundEvent.refundId,
        })
      }
    }

    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: refundClaim.order_id,
      paymentId: refundClaim.payment_id,
      processingResult: `refund_${
        refundEvent.status === "success" ? "paid" : refundEvent.status
      }`,
      reconciliationRequired: refundEvent.status === "failed" ||
        outcomeCode === "LATE_SUCCESS",
    });
    return {
      recorded: true,
      refundStatus: refundEvent.status,
      lateSuccess: outcomeCode === "LATE_SUCCESS",
    };
  }

  if (event.type === "account.updated" || event.type === "capability.updated") {
    let refresh: ReturnType<typeof parseBachsAccountRefreshEvent>;
    try {
      refresh = parseBachsAccountRefreshEvent(event);
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "connected_account_event_invalid";
      await issueForEvent(supabase, { event, reason });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        processingResult: "connected_account_event_needs_ops_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true, reason };
    }
    if (!refresh) {
      throw new Error("Bachs connected-account event classification failed.");
    }

    const { data: claim, error: claimError } = await supabase
      .from("bachs_account_setup_claims")
      .select(
        "tailor_profile_id,route_id,route_version,state,provider_account_ref",
      )
      .eq("provider_account_ref", refresh.accountId)
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claim || !["BOUND", "REVIEW"].includes(claim.state)) {
      await issueForEvent(supabase, {
        event,
        reason: "connected_account_has_no_bound_setup_claim",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        processingResult: "connected_account_claim_missing",
        reconciliationRequired: true,
      });
      return { reviewRequired: true };
    }

    const account = await getBachsAccount(getBachsClient(), refresh.accountId);
    const destination = await syncBachsPayoutDestination(supabase, {
      tailorProfileId: claim.tailor_profile_id,
      routeId: claim.route_id,
      routeVersion: claim.route_version,
      account,
      checkedAt: new Date().toISOString(),
    });
    if (!destination.persisted) {
      await issueForEvent(supabase, {
        event,
        reason:
          `connected_account_destination_not_persisted:${destination.reason}`,
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        processingResult: "connected_account_destination_needs_ops_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true };
    }
    await audit(supabase, {
      event: "payout.bachs_connected_account_refreshed",
      actor_role: "SYSTEM",
      order_id: null,
      severity: "info",
      payload: {
        function: FN,
        provider: "BACHS",
        provider_event_id: event.id,
        provider_event_type: event.type,
        provider_account_id: refresh.accountId,
        destination_id: destination.destinationId,
        active: destination.active,
        first_payout_release_review: destination.firstWithdrawalReviewStatus,
      },
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      processingResult: refresh.kind === "CAPABILITY"
        ? "connected_account_capabilities_refreshed_from_provider"
        : "connected_account_onboarding_progress_refreshed_from_provider",
    });
    return {
      recorded: true,
      connectedAccountRefreshed: true,
      destinationActive: destination.active,
    };
  }

  if (
    event.type === "payout.created" || event.type === "payout.paid" ||
    event.type === "payout.failed"
  ) {
    let withdrawal: ReturnType<typeof parseBachsWithdrawalEvent>;
    try {
      withdrawal = parseBachsWithdrawalEvent(event);
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "payout_event_invalid";
      await issueForEvent(supabase, { event, reason });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        processingResult: "account_withdrawal_event_needs_ops_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true, reason };
    }
    if (!withdrawal) {
      throw new Error("Bachs payout event classification failed.");
    }
    const { data: destination, error: destinationError } = await supabase
      .from("payout_destinations")
      .select("id,tailor_profile_id,currency,provider_account_ref")
      .eq("provider", "BACHS")
      .eq("provider_account_ref", withdrawal.accountId)
      .maybeSingle();
    if (destinationError) throw destinationError;
    if (!destination || destination.currency !== withdrawal.currency) {
      await issueForEvent(supabase, {
        event,
        reason: "account_withdrawal_destination_or_currency_mismatch",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        processingResult: "account_withdrawal_destination_needs_ops_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true };
    }

    const occurredAt = typeof event.created_at === "string" &&
        Number.isFinite(Date.parse(event.created_at))
      ? new Date(event.created_at).toISOString()
      : null;
    const { error: movementError } = await supabase.from(
      "provider_payout_events",
    ).upsert({
      provider: "BACHS",
      provider_event_id: event.id,
      event_type: event.type,
      provider_destination_id: withdrawal.accountId,
      provider_bank_payout_id: withdrawal.withdrawalId,
      // Provider withdrawals combine account balance funds. Never link one to
      // an individual earning or payout claim.
      payout_id: null,
      tailor_profile_id: destination.tailor_profile_id,
      amount: withdrawal.amountMinor,
      currency: withdrawal.currency,
      status: withdrawal.status,
      payload: event,
      occurred_at: occurredAt,
      processed_at: new Date().toISOString(),
    }, { onConflict: "provider,provider_event_id" });
    if (movementError) throw movementError;
    await audit(supabase, {
      event: "payout.account_settlement_update",
      actor_role: "SYSTEM",
      order_id: null,
      severity: withdrawal.status === "FAILED" ? "error" : "info",
      payload: {
        function: FN,
        provider: "BACHS",
        provider_event_id: event.id,
        provider_event_type: event.type,
        provider_account_id: withdrawal.accountId,
        provider_withdrawal_id: withdrawal.withdrawalId,
        amount_minor: withdrawal.amountMinor,
        currency: withdrawal.currency,
        status: withdrawal.status,
        payout_id: null,
      },
    });
    if (withdrawal.status === "FAILED") {
      await createOrRefreshOpsIssue(supabase, {
        issueType: "PAYOUT_FAILED",
        severity: "HIGH",
        source: FN,
        actorRole: "SYSTEM",
        provider: "BACHS",
        title: "Bachs account withdrawal needs review",
        description:
          "A Bachs account-level bank withdrawal failed. The event is not tied to an individual earning transfer.",
        recommendedAction:
          "Review the Bachs withdrawal event and the tailor’s current account balance. Do not alter individual earning or payout claims from this event.",
        dedupeKey: `bachs-account-withdrawal:${withdrawal.withdrawalId}`,
        relatedEntityType: "provider_payout_event",
        relatedEntityId: withdrawal.withdrawalId,
        queueKey: "money-desk",
        persistWhenRoutineDisabled: true,
        metadata: {
          provider_event_id: event.id,
          amount_minor: withdrawal.amountMinor,
          currency: withdrawal.currency,
        },
      });
    }
    await markWebhookEventProcessed(supabase, webhookEventId, {
      processingResult:
        `bachs_account_withdrawal:${withdrawal.status.toLowerCase()}`,
    });
    return {
      recorded: true,
      accountLevelWithdrawal: true,
      status: withdrawal.status,
    };
  }

  if (event.type === "collection.failed") {
    // Bachs documents this as an attempt-level failure; the checkout remains
    // open and can still succeed after a later payment-method retry.
    const platformAccountId =
      Deno.env.get("BACHS_PLATFORM_ACCOUNT_ID")?.trim() ?? "";
    if (
      !platformAccountId || event.organization_id !== platformAccountId ||
      event.account
    ) {
      await issueForEvent(supabase, {
        event,
        reason: !platformAccountId
          ? "platform_account_id_missing"
          : "collection_event_account_mismatch",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        processingResult: "failed_collection_account_needs_review",
        reconciliationRequired: true,
      });
      return {
        reviewRequired: true,
        reason: "collection_event_account_mismatch",
      };
    }
    const checkoutId = typeof data.checkout_id === "string"
      ? data.checkout_id
      : null;
    const attempt = checkoutId
      ? await findPaymentAttemptByProviderPaymentId(
        supabase,
        "BACHS",
        checkoutId,
      )
      : null;
    if (
      !attempt || !["INITIAL_ORDER", "CONSULTATION", "FULFILLMENT"].includes(attempt.phase) ||
      attempt.idempotency_key !== data.reference
    ) {
      await issueForEvent(supabase, {
        event,
        orderId: attempt?.order_id ?? null,
        paymentId: attempt?.id ?? null,
        reason: "failed_collection_has_no_exact_checkout_attempt",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: attempt?.order_id ?? null,
        paymentId: attempt?.id ?? null,
        processingResult: "failed_collection_needs_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true };
    }
    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: attempt.order_id,
      paymentId: attempt.id,
      processingResult: "collection_attempt_failed_checkout_remains_open",
    });
    return { recorded: true, checkoutRemainsOpen: true };
  }

  if (event.type !== "collection.succeeded") {
    await issueForEvent(supabase, {
      event,
      reason: "event_type_not_yet_implemented",
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      processingResult: "event_type_needs_ops_review",
      reconciliationRequired: true,
    });
    return { reviewRequired: true, unsupported: event.type };
  }

  const checkoutId = typeof data.checkout_id === "string"
    ? data.checkout_id
    : null;
  const attempt = checkoutId
    ? await findPaymentAttemptByProviderPaymentId(supabase, "BACHS", checkoutId)
    : null;
  const platformAccountId = Deno.env.get("BACHS_PLATFORM_ACCOUNT_ID")?.trim() ??
    "";
  const matched = matchBachsCollection({
    event: event as unknown as BachsCollectionSucceeded,
    attempt,
    platformAccountId,
  });
  if (!attempt || matched.outcome !== "MATCH") {
    const reason = !platformAccountId
      ? "platform_account_id_missing"
      : matched.outcome.toLowerCase();
    await issueForEvent(supabase, {
      event,
      orderId: attempt?.order_id ?? null,
      paymentId: attempt?.id ?? null,
      reason,
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: attempt?.order_id ?? null,
      paymentId: attempt?.id ?? null,
      processingResult: `collection_${reason}`,
      reconciliationRequired: true,
    });
    return { reviewRequired: true, reason };
  }

  if (
    attempt.provider_response && typeof attempt.provider_response === "object"
  ) {
    const previousChargeId =
      typeof attempt.provider_response.bachs_charge_id === "string"
        ? attempt.provider_response.bachs_charge_id
        : null;
    if (previousChargeId && previousChargeId !== matched.chargeId) {
      await issueForEvent(supabase, {
        event,
        orderId: attempt.order_id,
        paymentId: attempt.id,
        reason: "attempt_already_bound_to_another_charge",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: attempt.order_id,
        paymentId: attempt.id,
        processingResult: "charge_id_conflict",
        reconciliationRequired: true,
      });
      return { reviewRequired: true };
    }
  }

  if (attempt.status === "SUCCEEDED") {
    const { data: existingCharge, error: chargeError } = await supabase.from(
      "order_payments",
    )
      .select("provider_charge_id").eq("id", attempt.id).maybeSingle();
    if (chargeError) throw chargeError;
    if (
      existingCharge?.provider_charge_id &&
      existingCharge.provider_charge_id !== matched.chargeId
    ) {
      await issueForEvent(supabase, {
        event,
        orderId: attempt.order_id,
        paymentId: attempt.id,
        reason: "saved_charge_id_conflict",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: attempt.order_id,
        paymentId: attempt.id,
        processingResult: "charge_id_conflict",
        reconciliationRequired: true,
      });
      return { reviewRequired: true };
    }
  }

  const { data: chargeBinding, error: bindError } = await supabase.from(
    "order_payments",
  )
    .update({ provider_charge_id: matched.chargeId })
    .eq("id", attempt.id).eq("provider", "BACHS").eq(
      "provider_payment_id",
      checkoutId,
    )
    .or(`provider_charge_id.is.null,provider_charge_id.eq.${matched.chargeId}`)
    .select("id").maybeSingle();
  if (bindError) throw bindError;
  if (!chargeBinding?.id) {
    await issueForEvent(supabase, {
      event,
      orderId: attempt.order_id,
      paymentId: attempt.id,
      reason: "charge_id_bind_conflict",
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: attempt.order_id,
      paymentId: attempt.id,
      processingResult: "charge_id_bind_conflict",
      reconciliationRequired: true,
    });
    return { reviewRequired: true };
  }

  const { data: orderData, error: orderError } = await supabase.from("orders")
    .select(
      "id,reference,stage,order_kind,customer_id,tailor_id,payment_provider,payment_intent_id,charge_provider_snapshot,charge_currency_snapshot,accepted_route_snapshot_at,currency,special_note,consultation_fee,delivery_method,fulfillment_fee,fulfillment_payment_requested_at,fulfillment_payment_paid_at,fulfillment_payment_provider,fulfillment_payment_intent_id",
    )
    .eq("id", attempt.order_id).maybeSingle();
  if (orderError) throw orderError;
  const order = orderData as BachsOrder | null;
  const wasTerminal = attempt.status === "FAILED" ||
    attempt.status === "CANCELED";
  // Record the accepted charge in the shared commercial ledger. The shared
  // status helper also updates phase-linked commercial records idempotently.
  const succeededAttempt = await markPaymentAttemptStatus(supabase, {
    provider: "BACHS",
    providerPaymentId: checkoutId!,
    status: "SUCCEEDED",
    providerResponse: {
      ...asRecord(attempt.provider_response),
      bachs_charge_id: matched.chargeId,
      bachs_event_id: event.id,
      id: event.id,
      type: event.type,
      data,
    },
  });
  if (!succeededAttempt) {
    throw new Error(
      "Bachs collection matched but its payment attempt could not be advanced.",
    );
  }
  const { error: settlementCheckError } = await supabase.rpc(
    "register_bachs_payment_settlement_check",
    {
      p_payment_id: attempt.id,
      p_provider_checkout_id: checkoutId,
      p_provider_charge_id: matched.chargeId,
    },
  );
  if (settlementCheckError) throw settlementCheckError;
  const { data: settlementEvidence, error: settlementEvidenceError } = await supabase.rpc(
    "record_bachs_payment_settlement_event_evidence",
    {
      p_payment_id: attempt.id,
      p_provider_event_id: event.id,
      p_settlement_amount: matched.settledMinor,
      p_settlement_currency: matched.settledMinor === null ? null : attempt.currency,
      p_processing_fee_amount: matched.feeMinor,
      p_processing_fee_currency: matched.feeMinor === null ? null : attempt.currency,
    },
  );
  if (settlementEvidenceError) throw settlementEvidenceError;
  if (
    settlementEvidence && typeof settlementEvidence === "object" &&
    ["REVIEW", "SETTLED_CONFLICT"].includes(
      String((settlementEvidence as Record<string, unknown>).outcome),
    )
  ) {
    await issueForEvent(supabase, {
      event,
      orderId: attempt.order_id,
      paymentId: attempt.id,
      reason: "settlement_event_evidence_conflict",
    });
  }

  if (!order) {
    await issueForEvent(supabase, {
      event,
      orderId: attempt.order_id,
      paymentId: attempt.id,
      reason: "order_missing",
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: attempt.order_id,
      paymentId: attempt.id,
      processingResult: "late_or_conflicting_success_needs_ops_review",
      reconciliationRequired: true,
    });
    return {
      reviewRequired: true,
      reason: "order_missing",
      moneyRecorded: true,
    };
  }

  const reviewReason = attempt.phase === "INITIAL_ORDER"
    ? bachsInitialCollectionReviewReason({
      attemptOrderId: attempt.order_id,
      orderId: order.id,
      attemptPhase: attempt.phase,
      attemptStatus: wasTerminal ? "FAILED" : attempt.status,
      orderStage: order.stage,
      paymentProvider: order.payment_provider,
      paymentCheckoutId: order.payment_intent_id,
      succeededCheckoutId: checkoutId!,
      acceptedSnapshotAt: order.accepted_route_snapshot_at,
      snapshotProvider: order.charge_provider_snapshot,
      snapshotCurrency: order.charge_currency_snapshot,
      paymentCurrency: attempt.currency,
    })
    : attempt.phase === "CONSULTATION"
      // Keep this non-null until consultation has claim-backed payout AND
      // refund paths. This returns signed successes to Money Desk before the
      // legacy confirmation block below can run.
      ? "consultation_payout_path_not_ready"
      : bachsFollowupCollectionReviewReason({
      attemptOrderId: attempt.order_id,
      orderId: order.id,
      attemptPhase: attempt.phase,
      attemptStatus: wasTerminal ? "FAILED" : attempt.status,
      orderStage: order.stage,
      paymentProvider: order.payment_provider,
      paymentCheckoutId: order.payment_intent_id,
      succeededCheckoutId: checkoutId!,
      acceptedSnapshotAt: order.accepted_route_snapshot_at,
      snapshotProvider: order.charge_provider_snapshot,
      snapshotCurrency: order.charge_currency_snapshot,
      paymentCurrency: attempt.currency,
      paymentAmount: attempt.amount,
      expectedAmount: attempt.phase === "FULFILLMENT"
        ? order.fulfillment_fee
        : null,
      phasePaymentProvider: attempt.phase === "FULFILLMENT"
        ? order.fulfillment_payment_provider
        : null,
      phasePaymentCheckoutId: attempt.phase === "FULFILLMENT"
        ? order.fulfillment_payment_intent_id
        : null,
      fulfillmentPaymentRequestedAt: order.fulfillment_payment_requested_at,
      fulfillmentDeliveryMethod: order.delivery_method,
      fulfillmentPaymentPaidAt: order.fulfillment_payment_paid_at,
    });

  if (reviewReason) {
    await issueForEvent(supabase, {
      event,
      orderId: order?.id ?? attempt.order_id,
      paymentId: attempt.id,
      reason: reviewReason,
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: order?.id ?? attempt.order_id,
      paymentId: attempt.id,
      processingResult: "late_or_conflicting_success_needs_ops_review",
      reconciliationRequired: true,
    });
    await audit(supabase, {
      event: "payment.provider_state_requires_ops_review",
      actor_role: "SYSTEM",
      order_id: order?.id ?? attempt.order_id,
      severity: "error",
      payload: {
        function: FN,
        provider: "BACHS",
        provider_event_id: event.id,
        provider_checkout_id: checkoutId,
        provider_charge_id: matched.chargeId,
        reason: reviewReason,
      },
    });
    return { reviewRequired: true, reason: reviewReason, moneyRecorded: true };
  }

  if (attempt.phase === "CONSULTATION") {
    const bookingId = attempt.consultation_booking_id;
    const { data: booking, error: bookingError } = bookingId
      ? await supabase.from("consultation_bookings")
        .select("id,order_id,status,fee_mode,fee_amount,fee_currency,payment_status,paid_at")
        .eq("id", bookingId)
        .maybeSingle()
      : { data: null, error: null };
    if (bookingError) throw bookingError;
    if (
      !booking || booking.order_id !== order.id || booking.status !== "CONFIRMED" ||
      booking.fee_mode !== "PAID" || booking.fee_amount !== attempt.amount ||
      String(booking.fee_currency ?? "").toUpperCase() !== attempt.currency ||
      !["PENDING", "PAID"].includes(booking.payment_status)
    ) {
      await issueForEvent(supabase, {
        event,
        orderId: order.id,
        paymentId: attempt.id,
        reason: "consultation_booking_snapshot_mismatch",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: order.id,
        paymentId: attempt.id,
        processingResult: "consultation_booking_needs_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true, reason: "consultation_booking_snapshot_mismatch", moneyRecorded: true };
    }

    const supportMeta = parseOrderSupportMeta(order.special_note);
    const existingConsultation = supportMeta.consultation;
    const alreadyConfirmed = !!existingConsultation?.paidAt &&
      existingConsultation.paymentProvider === "BACHS" &&
      existingConsultation.paymentIntentId === checkoutId;
    if (existingConsultation?.paidAt && !alreadyConfirmed) {
      await issueForEvent(supabase, {
        event,
        orderId: order.id,
        paymentId: attempt.id,
        reason: "consultation_paid_by_different_checkout",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: order.id,
        paymentId: attempt.id,
        processingResult: "consultation_payment_conflict_needs_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true, reason: "consultation_paid_by_different_checkout", moneyRecorded: true };
    }

    const paidAt = existingConsultation?.paidAt ?? new Date().toISOString();
    if (!alreadyConfirmed) {
      const nextSpecialNote = serializeOrderSupportMeta({
        ...supportMeta,
        consultation: existingConsultation
          ? {
              ...existingConsultation,
              paymentProvider: "BACHS",
              paymentIntentId: checkoutId,
              paymentCheckoutUrl: null,
              paidAt,
              status: existingConsultation.scheduledStartAt ? "SCHEDULED" : existingConsultation.status,
            }
          : existingConsultation,
      });
      let updateQuery = supabase.from("orders")
        .update({ special_note: nextSpecialNote })
        .eq("id", order.id)
        .eq("stage", "CONSULTATION");
      updateQuery = order.special_note == null
        ? updateQuery.is("special_note", null)
        : updateQuery.eq("special_note", order.special_note);
      const { data: updatedOrder, error: updateError } = await updateQuery
        .select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!updatedOrder?.id) {
        await issueForEvent(supabase, {
          event,
          orderId: order.id,
          paymentId: attempt.id,
          reason: "consultation_confirmation_compare_and_set_lost",
        });
        await markWebhookEventProcessed(supabase, webhookEventId, {
          orderId: order.id,
          paymentId: attempt.id,
          processingResult: "consultation_confirmation_needs_review",
          reconciliationRequired: true,
        });
        return { reviewRequired: true, reason: "consultation_confirmation_compare_and_set_lost", moneyRecorded: true };
      }
    }

    if (booking.payment_status === "PENDING") {
      const { data: updatedBooking, error: updateBookingError } = await supabase
        .from("consultation_bookings")
        .update({ payment_status: "PAID", paid_at: paidAt, settlement_status: "HELD" })
        .eq("id", booking.id)
        .eq("order_id", order.id)
        .eq("status", "CONFIRMED")
        .eq("payment_status", "PENDING")
        .select("id").maybeSingle();
      if (updateBookingError) throw updateBookingError;
      if (!updatedBooking?.id) {
        const { data: latestBooking, error: latestBookingError } = await supabase
          .from("consultation_bookings")
          .select("id,payment_status,paid_at")
          .eq("id", booking.id).maybeSingle();
        if (latestBookingError) throw latestBookingError;
        if (latestBooking?.payment_status !== "PAID" || !latestBooking.paid_at) {
          await issueForEvent(supabase, {
            event,
            orderId: order.id,
            paymentId: attempt.id,
            reason: "consultation_booking_payment_update_lost",
          });
          await markWebhookEventProcessed(supabase, webhookEventId, {
            orderId: order.id,
            paymentId: attempt.id,
            processingResult: "consultation_booking_update_needs_review",
            reconciliationRequired: true,
          });
          return { reviewRequired: true, reason: "consultation_booking_payment_update_lost", moneyRecorded: true };
        }
      }
    }

    const consultationStageNote = "Consultation fee paid. The consultation can start at the scheduled time.";
    const { data: priorStageNote, error: priorStageNoteError } = await supabase
      .from("order_stage_updates").select("id").eq("order_id", order.id)
      .eq("stage", order.stage).eq("note", consultationStageNote).limit(1).maybeSingle();
    if (priorStageNoteError) throw priorStageNoteError;
    if (!priorStageNote?.id) {
      const { error: stageError } = await supabase.from("order_stage_updates").insert({
        order_id: order.id,
        stage: order.stage,
        note: consultationStageNote,
      });
      if (stageError) throw stageError;
    }
    if (order.tailor_id) {
      EdgeRuntime.waitUntil(sendPushToUser(supabase, order.tailor_id, {
        title: "Consultation fee paid",
        body: "The customer paid the consultation fee. The call can start at the scheduled time.",
        preferenceKey: "paymentConfirmations",
        data: { orderId: order.id, target: "order-detail" },
        communication: {
          category: "PAYMENT", purpose: "TRANSACTIONAL", severity: "NOTICE", inApp: true,
          destinationKey: "ORDER_DETAIL", destinationParams: { orderId: order.id },
          deduplicationKey: `consultation-fee-paid:${order.id}:${checkoutId}:tailor`,
        },
      }));
    }
    if (order.customer_id) {
      EdgeRuntime.waitUntil(sendPushToUser(supabase, order.customer_id, {
        title: "Consultation payment confirmed",
        body: "Your consultation fee is paid and protected until attendance is verified.",
        preferenceKey: "paymentConfirmations",
        data: { orderId: order.id, target: "order-detail" },
        communication: {
          category: "PAYMENT", purpose: "TRANSACTIONAL", severity: "NOTICE", mandatory: true,
          inApp: true, destinationKey: "ORDER_DETAIL", destinationParams: { orderId: order.id },
          deduplicationKey: `consultation-fee-paid:${order.id}:${checkoutId}:customer`,
        },
      }));
    }
    await enqueueOrderConfirmationEmailJob(supabase, {
      order,
      phase: "CONSULTATION",
      source: FN,
      provider: "BACHS",
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: order.id,
      paymentId: attempt.id,
      processingResult: alreadyConfirmed ? "consultation_already_confirmed" : "consultation_confirmed",
    });
    await audit(supabase, {
      event: "payment.consultation_confirmed",
      actor_role: "SYSTEM",
      order_id: order.id,
      payload: {
        function: FN, provider: "BACHS", event_id: event.id,
        checkout_id: checkoutId, booking_id: booking.id, already_confirmed: alreadyConfirmed,
      },
    });
    return { confirmed: true, phase: "CONSULTATION", alreadyConfirmed };
  }

  if (attempt.phase === "FULFILLMENT") {
    let changed = false;
    if (order.fulfillment_payment_paid_at) {
      if (order.fulfillment_payment_provider !== "BACHS" || order.fulfillment_payment_intent_id !== checkoutId) {
        await issueForEvent(supabase, {
          event, orderId: order.id, paymentId: attempt.id,
          reason: "fulfillment_already_paid_by_different_checkout",
        });
        await markWebhookEventProcessed(supabase, webhookEventId, {
          orderId: order.id, paymentId: attempt.id,
          processingResult: "fulfillment_payment_conflict_needs_review",
          reconciliationRequired: true,
        });
        return { reviewRequired: true, reason: "fulfillment_already_paid_by_different_checkout", moneyRecorded: true };
      }
    } else {
      const { data: updatedOrder, error: updateError } = await supabase.from("orders")
        .update({
          fulfillment_payment_provider: "BACHS",
          fulfillment_payment_intent_id: checkoutId,
          fulfillment_payment_checkout_url: null,
          fulfillment_payment_paid_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("fulfillment_payment_provider", "BACHS")
        .eq("fulfillment_payment_intent_id", checkoutId)
        .not("fulfillment_payment_requested_at", "is", null)
        .is("fulfillment_payment_paid_at", null)
        .select("id").maybeSingle();
      if (updateError) throw updateError;
      changed = !!updatedOrder?.id;
      if (!changed) {
        const { data: latestOrder, error: latestOrderError } = await supabase.from("orders")
          .select("fulfillment_payment_provider,fulfillment_payment_intent_id,fulfillment_payment_paid_at")
          .eq("id", order.id).maybeSingle();
        if (latestOrderError) throw latestOrderError;
        if (latestOrder?.fulfillment_payment_provider !== "BACHS" ||
          latestOrder.fulfillment_payment_intent_id !== checkoutId ||
          !latestOrder.fulfillment_payment_paid_at) {
          await issueForEvent(supabase, {
            event, orderId: order.id, paymentId: attempt.id,
            reason: "fulfillment_confirmation_compare_and_set_lost",
          });
          await markWebhookEventProcessed(supabase, webhookEventId, {
            orderId: order.id, paymentId: attempt.id,
            processingResult: "fulfillment_confirmation_needs_review",
            reconciliationRequired: true,
          });
          return { reviewRequired: true, reason: "fulfillment_confirmation_compare_and_set_lost", moneyRecorded: true };
        }
      }
    }

    await finalizeDispatchShortfallFunding(supabase, {
      orderId: order.id,
      actorRole: "SYSTEM",
      provider: "BACHS",
      providerPaymentId: checkoutId!,
    });
    const fulfillmentStageNote = fulfillmentPaymentConfirmedStageNote(order.delivery_method);
    const { data: priorStageNote, error: priorStageNoteError } = await supabase
      .from("order_stage_updates").select("id").eq("order_id", order.id)
      .eq("stage", order.stage).eq("note", fulfillmentStageNote).limit(1).maybeSingle();
    if (priorStageNoteError) throw priorStageNoteError;
    if (!priorStageNote?.id) {
      const { error: stageError } = await supabase.from("order_stage_updates").insert({
        order_id: order.id,
        stage: order.stage,
        note: fulfillmentStageNote,
      });
      if (stageError) throw stageError;
    }
    if (order.tailor_id) {
      EdgeRuntime.waitUntil(sendPushToUser(supabase, order.tailor_id, {
        ...tailorFulfillmentPaymentConfirmedNotification(order.delivery_method),
        preferenceKey: "newOrders",
        data: { orderId: order.id },
        communication: {
          category: "PAYMENT", purpose: "TRANSACTIONAL", severity: "NOTICE", inApp: true,
          destinationKey: "ORDER_DETAIL", destinationParams: { orderId: order.id },
          deduplicationKey: `fulfillment-payment-confirmed:${order.id}:${checkoutId}:tailor`,
        },
      }));
    }
    if (order.customer_id) {
      EdgeRuntime.waitUntil(sendPushToUser(supabase, order.customer_id, {
        title: "Delivery payment confirmed",
        body: "Your delivery payment is confirmed. We’ll update the order as it moves forward.",
        preferenceKey: "paymentConfirmations",
        data: { orderId: order.id, target: "order-detail" },
        communication: {
          category: "PAYMENT", purpose: "TRANSACTIONAL", severity: "NOTICE", mandatory: true,
          inApp: true, destinationKey: "ORDER_DETAIL", destinationParams: { orderId: order.id },
          deduplicationKey: `fulfillment-payment-confirmed:${order.id}:${checkoutId}:customer`,
        },
      }));
    }
    await enqueueOrderConfirmationEmailJob(supabase, {
      order,
      phase: "FULFILLMENT",
      source: FN,
      provider: "BACHS",
    });
    await markWebhookEventProcessed(supabase, webhookEventId, {
      orderId: order.id,
      paymentId: attempt.id,
      processingResult: changed ? "fulfillment_confirmed" : "fulfillment_already_confirmed",
    });
    await audit(supabase, {
      event: "payment.fulfillment_confirmed",
      actor_role: "SYSTEM",
      order_id: order.id,
      payload: {
        function: FN, provider: "BACHS", event_id: event.id,
        checkout_id: checkoutId, changed,
      },
    });
    return { confirmed: true, phase: "FULFILLMENT", changed };
  }

  let changed = false;
  if (order.stage !== "CONFIRMED") {
    const { data: updated, error: updateError } = await supabase.from("orders")
      .update({
        stage: "CONFIRMED",
        stage_updated_at: new Date().toISOString(),
        payment_provider: "BACHS",
        payment_intent_id: checkoutId,
        payment_checkout_url: null,
      }).eq("id", order.id).eq("stage", "PAYMENT_PENDING").eq(
        "payment_provider",
        "BACHS",
      )
      .eq("payment_intent_id", checkoutId).select("id").maybeSingle();
    if (updateError) throw updateError;
    changed = !!updated?.id;
    if (!changed) {
      await issueForEvent(supabase, {
        event,
        orderId: order.id,
        paymentId: attempt.id,
        reason: "order_confirmation_compare_and_set_lost",
      });
      await markWebhookEventProcessed(supabase, webhookEventId, {
        orderId: order.id,
        paymentId: attempt.id,
        processingResult: "payment_succeeded_order_update_requires_review",
        reconciliationRequired: true,
      });
      return { reviewRequired: true };
    }
    const { error: stageError } = await supabase.from("order_stage_updates")
      .insert({
        order_id: order.id,
        stage: "CONFIRMED",
        note: paymentConfirmedStageNote(order.order_kind),
      });
    if (stageError) throw stageError;
    if (order.tailor_id) {
      EdgeRuntime.waitUntil(
        sendPushToUser(supabase, order.tailor_id, {
          ...tailorPaymentConfirmedNotification(order.order_kind),
          preferenceKey: "newOrders",
          data: { orderId: order.id },
        }),
      );
    }
    if (order.customer_id) {
      EdgeRuntime.waitUntil(sendPushToUser(supabase, order.customer_id, {
        title: order.order_kind === "READY_MADE"
          ? "Order confirmed"
          : "Payment confirmed",
        body: order.order_kind === "READY_MADE"
          ? "Your ready-made order is paid and the tailor can prepare it inside Drapeon."
          : "Your order is funded. The tailor can continue production inside Drapeon.",
        preferenceKey: "paymentConfirmations",
        data: { orderId: order.id },
        communication: {
          category: "PAYMENT",
          purpose: "TRANSACTIONAL",
          severity: "NOTICE",
          mandatory: true,
          inApp: true,
          destinationKey: "ORDER_DETAIL",
          destinationParams: { orderId: order.id },
          deduplicationKey:
            `payment-confirmed:${order.id}:${checkoutId}:customer`,
        },
      }));
    }
    await enqueueOrderConfirmationEmailJob(supabase, {
      order,
      phase: "INITIAL_ORDER",
      source: FN,
      provider: "BACHS",
    });
  }

  await markWebhookEventProcessed(supabase, webhookEventId, {
    orderId: order.id,
    paymentId: attempt.id,
    processingResult: changed ? "confirmed" : "already_confirmed",
  });
  await audit(supabase, {
    event: "payment.confirmed",
    actor_role: "SYSTEM",
    order_id: order.id,
    payload: {
      function: FN,
      provider: "BACHS",
      event_id: event.id,
      checkout_id: checkoutId,
      charge_id: matched.chargeId,
      changed,
    },
  });
  return { confirmed: true, changed };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  const supabase: SupabaseClient = createClient(
    getSupabaseUrl(),
    getServiceRoleKey(),
  );
  const queuedWebhookEventId =
    req.headers.get("x-drape-webhook-event-id")?.trim() || null;
  if (queuedWebhookEventId) {
    const unauthorized = await authorizeCronRequest(
      req,
      `${FN}:queued-replay`,
      cors,
    );
    if (unauthorized) return unauthorized;
    try {
      const result = await processQueuedEvent(supabase, queuedWebhookEventId);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (error) {
      log("error", FN, "queued_event.failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return new Response("Webhook replay failed", {
        status: 500,
        headers: cors,
      });
    }
  }

  const clientIp = getClientIp(req);
  const limit = await rateLimit(
    supabase,
    clientIp,
    FN,
    RATE_LIMITS.webhook.limit,
    RATE_LIMITS.webhook.windowMs,
    { ip: clientIp, userAgent: req.headers.get("user-agent") },
  );
  if (!limit.allowed) return rateLimitExceededResponse(cors, limit.retryAfter);
  const rawBody = new Uint8Array(await req.arrayBuffer());
  const bodyText = new TextDecoder().decode(rawBody);
  const signatureHeader = req.headers.get("x-bachs-signature-v2") ??
    req.headers.get("x-bachs-signature");
  let secrets: string[];
  try {
    secrets = getBachsWebhookSecrets();
  } catch (error) {
    log("error", FN, "webhook.secret_unavailable", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return new Response("Webhook verification unavailable", {
      status: 503,
      headers: cors,
    });
  }
  if (
    !signatureHeader ||
    !await verifyBachsWebhookSignature({
      rawBody,
      headers: req.headers,
      secret: secrets,
    })
  ) {
    await recordRejectedWebhook(supabase, {
      provider: "BACHS",
      functionName: FN,
      rawPayload: bodyText,
      reason: signatureHeader ? "invalid_signature" : "missing_signature",
      signatureHeader,
      sourceIp: clientIp,
      userAgent: req.headers.get("user-agent"),
      endpointPath: "/v1/webhooks/bachs",
    });
    return new Response(
      signatureHeader ? "Invalid Bachs signature" : "Missing Bachs signature",
      { status: 401, headers: cors },
    );
  }

  try {
    const event = JSON.parse(bodyText) as unknown;
    if (!eventShape(event)) {
      return new Response("Invalid Bachs event", {
        status: 400,
        headers: cors,
      });
    }
    const queued = await enqueueVerifiedPaymentWebhook(supabase, {
      provider: "BACHS",
      providerEventId: event.id,
      eventType: event.type,
      payload: event as Record<string, unknown>,
      rawPayload: bodyText,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        accepted: true,
        duplicate: queued.duplicate,
        alreadyProcessed: queued.alreadyProcessed,
      }),
      {
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return new Response("Invalid JSON payload", {
        status: 400,
        headers: cors,
      });
    }
    const message = error instanceof Error ? error.message : "unknown";
    log("error", FN, "webhook.enqueue_failed", { error: message });
    return new Response("Webhook intake unavailable", {
      status: 503,
      headers: cors,
    });
  }
});
