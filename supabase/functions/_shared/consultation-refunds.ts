import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createOrRefreshOpsIssue } from "./ops-issues.ts";

type ConsultationPayment = {
  id: string;
  order_id: string;
  phase: string;
  amount: number;
  currency: string;
  consultation_booking_id?: string | null;
  consultation_booking_link_source?:
    | "PREPARED"
    | "BACKFILL"
    | "LEGACY_VERIFIED"
    | "REVIEW"
    | null;
  refunded_amount?: number | null;
};

type ConsultationRefundOperationContext =
  | {
    kind: "ORDER_CANCELLATION";
    moneyDeskRequestId: string;
    disputeId: string;
  }
  | {
    kind: "CONSULTATION_POST_PAYOUT";
    moneyDeskRequestId: string;
    bookingId: string;
  };

export async function reserveConsultationRefund(
  supabase: SupabaseClient,
  payment: ConsultationPayment,
  operationContext?: ConsultationRefundOperationContext,
  requestedRefundAmount?: number,
) {
  const openCase = async (reason: "unlinked" | "mismatch" | "claim") => {
    await createOrRefreshOpsIssue(supabase, {
      issueType: "REFUND_FAILED",
      severity: "HIGH",
      source: "consultation-refund-reservation",
      actorRole: "SYSTEM",
      orderId: payment.order_id,
      title: reason === "unlinked"
        ? "Consultation refund has no exact booking link"
        : reason === "mismatch"
        ? "Consultation refund booking link needs review"
        : "Consultation refund is waiting for payout review",
      description: reason === "unlinked"
        ? "The consultation payment has no exact booking link. No provider refund was sent."
        : reason === "mismatch"
        ? "The linked booking does not match the consultation charge. No provider refund was sent."
        : "The payout claim already won or another refund is in progress. No provider refund was sent.",
      recommendedAction:
        "Match the exact charge and booking, then resolve the consultation refund through Money Desk. Do not create a second provider refund.",
      dedupeKey: `consultation-refund-reservation:${payment.id}:${reason}`,
      queueKey: "money-desk",
      persistWhenRoutineDisabled: true,
      relatedEntityType: "order_payment",
      relatedEntityId: payment.id,
      metadata: {
        payment_id: payment.id,
        booking_id: payment.consultation_booking_id ?? null,
        reason,
      },
    });
  };

  if (!payment.consultation_booking_id) {
    await openCase("unlinked");
    return { reserved: false, status: "PAYMENT_LINK_REQUIRED" };
  }
  if (
    !["PREPARED", "BACKFILL", "LEGACY_VERIFIED"].includes(
      String(payment.consultation_booking_link_source ?? ""),
    )
  ) {
    await openCase("mismatch");
    return { reserved: false, status: "PAYMENT_LINK_REVIEW" };
  }
  const { data: booking, error } = await supabase.from("consultation_bookings")
    .select("id,order_id,fee_amount,fee_currency")
    .eq("id", payment.consultation_booking_id).maybeSingle();
  if (error) throw error;
  if (
    !booking?.id ||
    String(booking.order_id) !== String(payment.order_id) ||
    booking.fee_amount !== payment.amount ||
    String(booking.fee_currency ?? "").toUpperCase() !==
      String(payment.currency).toUpperCase()
  ) {
    await openCase("mismatch");
    return { reserved: false, status: "PAYMENT_LINK_MISMATCH" };
  }
  if (operationContext?.kind === "CONSULTATION_POST_PAYOUT") {
    if (operationContext.bookingId !== booking.id) {
      await openCase("mismatch");
      return { reserved: false, status: "MONEY_DESK_BOOKING_MISMATCH" };
    }
    const { data: claim, error: postPayoutError } = await supabase.rpc(
      "claim_consultation_post_payout_refund",
      {
        p_booking_id: booking.id,
        p_payment_id: payment.id,
        p_money_desk_request_id: operationContext.moneyDeskRequestId,
        p_amount: requestedRefundAmount ?? 0,
      },
    );
    if (postPayoutError) throw postPayoutError;
    const result = claim && typeof claim === "object"
      ? claim as Record<string, unknown>
      : {};
    if (
      typeof result.claimId === "string" &&
      typeof result.idempotencyKey === "string"
    ) {
      if (typeof result.payoutId !== "string") {
        await openCase("claim");
        return { reserved: false, status: "PAYOUT_REFERENCE_MISSING" };
      }
      return {
        reserved: result.created === true,
        status: String(result.status ?? "CLAIM_CONFLICT"),
        created: result.created === true,
        bookingId: booking.id,
        postPayoutClaimId: result.claimId,
        idempotencyKey: result.idempotencyKey,
        payoutId: result.payoutId,
        providerReference: typeof result.providerReference === "string"
          ? result.providerReference
          : null,
        providerResponse:
          result.providerResponse && typeof result.providerResponse === "object"
            ? result.providerResponse as Record<string, unknown>
            : null,
      };
    }
    await openCase("claim");
    return {
      reserved: false,
      status: String(result.status ?? "CLAIM_CONFLICT"),
    };
  }
  const { data: result, error: claimError } = await supabase.rpc(
    "claim_consultation_money_action",
    {
      p_booking_id: booking.id,
      p_action: "REFUND",
    },
  );
  if (claimError) throw claimError;
  if (result !== "CLAIMED") {
    await openCase("claim");
    return { reserved: false, status: String(result ?? "CLAIM_CONFLICT") };
  }
  return { reserved: true, status: "CLAIMED", bookingId: booking.id };
}

export async function recordConsultationPostPayoutRefundProviderResult(
  supabase: SupabaseClient,
  input: {
    claimId: string;
    providerReference: string;
    confirmed: boolean;
    providerResponse: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc(
    "record_consultation_post_payout_refund_provider_result",
    {
      p_claim_id: input.claimId,
      p_provider_refund_id: input.providerReference,
      p_provider_status: input.confirmed ? "PROVIDER_CONFIRMED" : "PROCESSING",
      p_provider_response: input.providerResponse,
    },
  );
  if (error) throw error;
  if (
    !["PROVIDER_CONFIRMED", "PROCESSING", "ALREADY_SUCCEEDED"].includes(
      String(data),
    )
  ) {
    throw new Error(
      `Consultation refund claim could not record provider outcome (${
        String(data)
      }).`,
    );
  }
  return String(data);
}

export async function findConsultationPostPayoutRefundClaim(
  supabase: SupabaseClient,
  input: { paymentId: string; providerReference: string; amount: number },
) {
  const { data, error } = await supabase.from(
    "consultation_post_payout_refund_claims",
  )
    .select(
      "id,booking_id,payout_id,money_desk_request_id,amount,currency,status,provider_refund_id,provider_response,ledger_transaction_id",
    )
    .eq("payment_id", input.paymentId)
    .eq("provider_refund_id", input.providerReference)
    .eq("amount", input.amount)
    .in("status", [
      "CLAIMED",
      "PROCESSING",
      "PROVIDER_CONFIRMED",
      "OPS_REVIEW",
      "SUCCEEDED",
    ])
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function finalizeConsultationPostPayoutRefundClaim(
  supabase: SupabaseClient,
  input: { claimId: string; ledgerTransactionId: string },
) {
  const { data, error } = await supabase.rpc(
    "finalize_consultation_post_payout_refund_claim",
    {
      p_claim_id: input.claimId,
      p_ledger_transaction_id: input.ledgerTransactionId,
    },
  );
  if (error) throw error;
  if (!["SUCCEEDED", "ALREADY_SUCCEEDED"].includes(String(data))) {
    throw new Error(
      `Consultation refund claim could not be finalized (${String(data)}).`,
    );
  }
  return String(data);
}

export async function markConsultationPostPayoutRefundOpsReview(
  supabase: SupabaseClient,
  input: { claimId: string; reason: string },
) {
  const { data, error } = await supabase.rpc(
    "mark_consultation_post_payout_refund_ops_review",
    {
      p_claim_id: input.claimId,
      p_reason: input.reason.slice(0, 500),
    },
  );
  if (error) throw error;
  return String(data);
}

export async function failConsultationRefundReservation(
  supabase: SupabaseClient,
  payment: ConsultationPayment,
  failure: string,
) {
  if (payment.consultation_booking_id) {
    const { error } = await supabase.from("consultation_bookings").update({
      settlement_status: "OPS_REVIEW",
      settlement_failure_reason:
        `Consultation refund outcome needs review: ${failure}`.slice(0, 500),
      settlement_eligible_at: null,
    }).eq("id", payment.consultation_booking_id).eq(
      "settlement_status",
      "REFUND_PENDING",
    );
    if (error) throw error;
  }
  await createOrRefreshOpsIssue(supabase, {
    issueType: "REFUND_FAILED",
    severity: "CRITICAL",
    source: "consultation-refund-reservation",
    actorRole: "SYSTEM",
    orderId: payment.order_id,
    title: "Consultation refund outcome is uncertain",
    description:
      "The consultation refund request did not return a confirmed terminal result. The booking remains blocked from automatic payout until provider reconciliation.",
    recommendedAction:
      "Check the original provider refund by its existing request/idempotency reference. Do not release the payout claim or create a new refund until the provider outcome is certain.",
    dedupeKey: `consultation-refund-uncertain:${payment.id}`,
    queueKey: "money-desk",
    persistWhenRoutineDisabled: true,
    relatedEntityType: "order_payment",
    relatedEntityId: payment.id,
    metadata: {
      payment_id: payment.id,
      booking_id: payment.consultation_booking_id ?? null,
      failure,
    },
  });
}

export async function recordConsultationRefundOutcome(
  supabase: SupabaseClient,
  input: {
    payment: ConsultationPayment;
    refundAmount: number;
    provider: "STRIPE" | "PAYSTACK" | "BACHS";
    providerReference: string | null;
  },
) {
  const { payment, refundAmount, provider, providerReference } = input;
  const caseInput = {
    issueType: "REFUND_FAILED",
    severity: "HIGH",
    source: "consultation-refund-outcome",
    actorRole: "SYSTEM",
    orderId: payment.order_id,
    provider,
    title: "Consultation refund needs Money Desk review",
    description:
      "A consultation refund was confirmed by the provider. The booking earning remains blocked until Money Desk reviews the attendance outcome and payout state.",
    recommendedAction:
      "Match the exact payment attempt and booking, review the attendance/remedy evidence, and record any Drapeon-funded refund expense separately. Do not reduce an accepted earning or pay it automatically.",
    dedupeKey: `consultation-refund-review:${payment.id}`,
    queueKey: "money-desk",
    persistWhenRoutineDisabled: true,
    metadata: {
      payment_id: payment.id,
      booking_id: payment.consultation_booking_id ?? null,
      provider_reference: providerReference,
      refund_amount: refundAmount,
    },
  } as const;

  if (!payment.consultation_booking_id) {
    await createOrRefreshOpsIssue(supabase, {
      ...caseInput,
      relatedEntityType: "order_payment",
      relatedEntityId: payment.id,
      title: "Consultation refund has no exact booking link",
      description:
        "The provider confirmed a consultation refund, but the payment attempt has no exact booking link. No booking state or payout was inferred from order-level metadata.",
      recommendedAction:
        "Link the exact booking through the reviewed Money Desk path, then reconcile the refund and any earning. Do not infer the link from provider metadata.",
      dedupeKey: `consultation-refund-unlinked:${payment.id}`,
    });
    return { recorded: false, claim: "PAYMENT_LINK_REQUIRED" };
  }

  const { data: booking, error: bookingError } = await supabase.from(
    "consultation_bookings",
  )
    .select(
      "id,order_id,fee_amount,fee_currency,earned_amount,refunded_amount,payment_status,settlement_status",
    )
    .eq("id", payment.consultation_booking_id)
    .maybeSingle();
  if (bookingError) throw bookingError;
  if (
    !booking?.id ||
    String(booking.order_id) !== String(payment.order_id) ||
    booking.fee_amount !== payment.amount ||
    String(booking.fee_currency ?? "").toUpperCase() !==
      String(payment.currency).toUpperCase()
  ) {
    await createOrRefreshOpsIssue(supabase, {
      ...caseInput,
      relatedEntityType: "order_payment",
      relatedEntityId: payment.id,
      title: "Consultation refund has a mismatched booking link",
      description:
        "The linked consultation booking does not match the payment attempt order, amount, and currency. No booking state or payout was changed.",
      recommendedAction:
        "Review the exact charge and booking in Money Desk. Correct a link only through an audited action; do not infer a replacement from order metadata.",
      dedupeKey: `consultation-refund-link-mismatch:${payment.id}`,
    });
    return { recorded: false, claim: "PAYMENT_LINK_MISMATCH" };
  }

  const { data: claimResult, error: claimError } = await supabase.rpc(
    "claim_consultation_money_action",
    {
      p_booking_id: booking.id,
      p_action: "REFUND",
    },
  );
  if (claimError) throw claimError;

  const { data: latestPayment, error: latestPaymentError } = await supabase
    .from("order_payments")
    .select("amount,refunded_amount")
    .eq("id", payment.id)
    .maybeSingle();
  if (latestPaymentError) throw latestPaymentError;
  const refundedTotal = Math.max(
    latestPayment?.refunded_amount ?? payment.refunded_amount ?? 0,
    0,
  );
  const fullyRefunded =
    refundedTotal >= (latestPayment?.amount ?? payment.amount);
  const protectedPayoutState = ["RELEASE_PENDING", "RELEASED"].includes(
    booking.settlement_status,
  );
  const nextSettlement = protectedPayoutState
    ? booking.settlement_status
    : booking.earned_amount > 0
    ? "OPS_REVIEW"
    : fullyRefunded
    ? "REFUNDED"
    : "PARTIALLY_REFUNDED";

  const { error: updateError } = await supabase.from("consultation_bookings")
    .update({
      payment_status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
      refunded_amount: refundedTotal,
      settlement_status: nextSettlement,
      settlement_eligible_at: null,
      ...(fullyRefunded && nextSettlement === "REFUNDED"
        ? { settled_at: new Date().toISOString() }
        : {}),
    }).eq("id", booking.id);
  if (updateError) throw updateError;

  if (
    booking.earned_amount > 0 || protectedPayoutState ||
    !["CLAIMED", "ALREADY_IN_REVIEW"].includes(String(claimResult))
  ) {
    await createOrRefreshOpsIssue(supabase, {
      ...caseInput,
      relatedEntityType: "CONSULTATION_BOOKING",
      relatedEntityId: booking.id,
      description: protectedPayoutState
        ? "A consultation payment was refunded after the tailor transfer was confirmed. The accepted earning and payout remain unchanged; this refund is Drapeon-funded. Any fault finding or recovery is a separate legal-gated review."
        : caseInput.description,
      recommendedAction: protectedPayoutState
        ? "Confirm the refund and provider balance on the money timeline. Keep the tailor earning unchanged. Record any fault finding separately; do not deduct or recover until the legal-approved recovery policy is active."
        : caseInput.recommendedAction,
      metadata: {
        ...caseInput.metadata,
        claim_result: claimResult,
        payout_state: booking.settlement_status,
        earned_amount: booking.earned_amount,
        refunded_total: refundedTotal,
      },
    });
  }

  return {
    recorded: true,
    claim: claimResult,
    settlementStatus: nextSettlement,
  };
}
