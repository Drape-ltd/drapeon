import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertCommercialPaymentRefundReady,
  recordCommercialPaymentRefund,
} from "./commercial-ledger.ts";
import { Sentry } from "./sentry.ts";
import { audit } from "./logger.ts";
import { markPaymentAttemptStatus } from "./payment-ledger.ts";
import { createOrRefreshOpsIssue } from "./ops-issues.ts";
import {
  failConsultationRefundReservation,
  finalizeConsultationPostPayoutRefundClaim,
  findConsultationPostPayoutRefundClaim,
  markConsultationPostPayoutRefundOpsReview,
  recordConsultationPostPayoutRefundProviderResult,
  recordConsultationRefundOutcome,
  reserveConsultationRefund,
} from "./consultation-refunds.ts";
import { type PaystackRefund, refundPaystackTransaction } from "./paystack.ts";
import {
  listStripeRefundsForPaymentIntent,
  refundStripePaymentIntent,
  type StripeRefund,
} from "./stripe.ts";
import { getBachsClient } from "./bachs.ts";
import type { BachsRefund } from "./bachs-operations.ts";
import {
  type BachsRefundClaimResult,
  requestBachsRefund,
} from "./bachs-refund-claims.ts";

type PaymentProvider = "STRIPE" | "PAYSTACK" | "BACHS";
type PaymentPhase =
  | "INITIAL_ORDER"
  | "CONSULTATION"
  | "FULFILLMENT"
  | "MATERIAL_ADVANCE";
type PaymentStatus =
  | "INITIATED"
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "PARTIAL_REFUND"
  | "REFUNDED";
type ActorRole = "OPS" | "CUSTOMER" | "TAILOR" | "SYSTEM";
export type ExactRefundRestoration = {
  refundResolutionId: string;
  tailorWorkAmount: number;
  platformFeeAmount: number;
  taxAmount: number;
  fulfillmentAmount: number;
  consultationAmount: number;
  promotionAmount: number;
  drapeonFundedAmount: number;
};

export type RefundOperationContext =
  | {
    kind: "ORDER_CANCELLATION";
    moneyDeskRequestId: string;
    disputeId: string;
  }
  | {
      kind: 'CONSULTATION_POST_PAYOUT'
      moneyDeskRequestId: string
      bookingId: string
    }
  | {
      kind: 'BACHS_REFUND_RETRY'
      moneyDeskRequestId: string
      refundClaimId: string
      failedAttemptId: string
      paymentAttemptId: string
    }

export type RefundablePaymentAttemptRow = {
  id: string;
  order_id: string;
  phase: PaymentPhase;
  provider: PaymentProvider;
  currency: string;
  amount: number;
  status: PaymentStatus;
  provider_payment_id: string | null;
  provider_charge_id?: string | null;
  provider_response?: Record<string, unknown> | null;
  refunded_amount?: number | null;
  partial_refund_count?: number | null;
  consultation_booking_id?: string | null;
  consultation_booking_link_source?:
    | "PREPARED"
    | "BACKFILL"
    | "LEGACY_VERIFIED"
    | "REVIEW"
    | null;
};

export type RefundedAttemptSummary = {
  id: string;
  provider: PaymentProvider;
  providerPaymentId: string;
  phase: PaymentPhase;
  amount: number;
  currency: string;
  remainingRefundableAmount: number;
  totalRefundedAmount: number;
  partial: boolean;
  providerRefundId?: string | null;
};

export type PendingRefundSummary = {
  id: string;
  provider: PaymentProvider;
  providerPaymentId: string;
  providerRefundId: string | null;
  phase: PaymentPhase;
  amount: number;
  currency: string;
  status: string;
};

export type RefundSettledOrderPaymentsResult = {
  refundedAttempts: RefundedAttemptSummary[];
  pendingAttempts: PendingRefundSummary[];
  alreadyRefundedAttemptIds: string[];
};

export type AcceptedRefundRoute = {
  provider: string;
  currency: string;
};

export function acceptedRefundRouteMismatch(
  attempt: Pick<RefundablePaymentAttemptRow, "provider" | "currency">,
  route: AcceptedRefundRoute | null | undefined,
) {
  if (!route) return null;
  if (attempt.provider !== route.provider) return "provider_mismatch";
  if (
    attempt.currency.trim().toUpperCase() !==
      route.currency.trim().toUpperCase()
  ) return "currency_mismatch";
  return null;
}

export function refundProviderSupported(
  provider: string,
): provider is PaymentProvider {
  return provider === "STRIPE" || provider === "PAYSTACK" ||
    provider === "BACHS";
}

function providerLabel(provider: string) {
  if (provider === "STRIPE") return "Stripe";
  if (provider === "PAYSTACK") return "Paystack";
  if (provider === "BACHS") return "Bachs";
  return "configured payment provider";
}

async function assertAttemptsMatchAcceptedRoute(
  supabase: SupabaseClient,
  attempts: RefundablePaymentAttemptRow[],
  route: AcceptedRefundRoute | null | undefined,
  context: { orderId: string; actorRole: ActorRole; actorId?: string | null },
) {
  if (!route) return;
  for (const attempt of attempts) {
    const mismatch = acceptedRefundRouteMismatch(attempt, route);
    if (!mismatch) continue;
    await createOrRefreshOpsIssue(supabase, {
      issueType: "REFUND_FAILED",
      severity: "CRITICAL",
      source: "payment-refunds",
      actorId: context.actorId ?? null,
      actorRole: context.actorRole,
      orderId: context.orderId,
      provider: attempt.provider,
      title: "Refund blocked by accepted route mismatch",
      description:
        `A settled payment attempt does not match the order's immutable accepted route (${mismatch}). No refund provider was called.`,
      recommendedAction:
        "Reconcile the accepted order snapshot with the original charge attempt before retrying this refund.",
      dedupeKey: `refund-route-mismatch:${attempt.id}`,
      metadata: {
        payment_id: attempt.id,
        attempt_provider: attempt.provider,
        attempt_currency: attempt.currency,
        accepted_provider: route.provider,
        accepted_currency: route.currency,
        mismatch,
      },
    });
    throw new Error(
      "A settled payment does not match the order's accepted route. The refund was not sent and needs Money Desk review.",
    );
  }
}

export type PartialRefundOrderPaymentsResult = {
  refundedAttempts: RefundedAttemptSummary[];
  pendingAttempts: PendingRefundSummary[];
  alreadyRefundedAttemptIds: string[];
  totalRefundedAmount: number;
  remainingRefundableAmount: number;
};

function paystackRefundId(response: PaystackRefund) {
  return typeof response.id === "number" ? String(response.id) : null;
}

function paystackRefundIsTerminal(response: PaystackRefund) {
  return response.status?.trim().toLowerCase() === "processed";
}

function refundProviderReference(response: RefundProviderResponse) {
  const value = (response as Record<string, unknown>).id ??
    (response as Record<string, unknown>).refund_id ??
    (response as Record<string, unknown>).reference ??
    (response as Record<string, unknown>).transaction;
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

async function requireConsultationPostPayoutRefundReview(
  supabase: SupabaseClient,
  input: {
    claimId: string;
    bookingId: string;
    payment: RefundablePaymentAttemptRow;
    reason: string;
  },
) {
  await markConsultationPostPayoutRefundOpsReview(supabase, {
    claimId: input.claimId,
    reason: input.reason,
  });
  await createOrRefreshOpsIssue(supabase, {
    issueType: "REFUND_FAILED",
    severity: "CRITICAL",
    source: "consultation-post-payout-refund",
    actorRole: "SYSTEM",
    orderId: input.payment.order_id,
    provider: input.payment.provider,
    title: "Post-payout consultation refund needs reconciliation",
    description:
      "The post-payout refund did not reach a safely recorded provider outcome. The claim remains reserved; no second provider refund will be sent automatically.",
    recommendedAction:
      "Inspect the existing provider refund by payment and claim metadata. Finalize only a uniquely matched refund; never resubmit while the outcome is uncertain.",
    dedupeKey: `consultation-post-payout-refund-reconcile:${input.claimId}`,
    queueKey: "money-desk",
    persistWhenRoutineDisabled: true,
    relatedEntityType: "CONSULTATION_BOOKING",
    relatedEntityId: input.bookingId,
    metadata: {
      claim_id: input.claimId,
      payment_id: input.payment.id,
      safe_reason: input.reason.slice(0, 400),
    },
  });
}

function stripeRefundIsTerminal(response: StripeRefund) {
  return response.status?.trim().toLowerCase() === "succeeded";
}

function refundProviderSucceeded(
  provider: PaymentProvider,
  response: RefundProviderResponse,
) {
  if (provider === "STRIPE") {
    return stripeRefundIsTerminal(response as StripeRefund);
  }
  if (provider === "PAYSTACK") {
    return paystackRefundIsTerminal(response as PaystackRefund);
  }
  return (response as BachsRefund).status?.trim().toLowerCase() === "success";
}

function refundProviderFailed(
  provider: PaymentProvider,
  response: RefundProviderResponse,
) {
  return provider === "BACHS" &&
    (response as BachsRefund).status?.trim().toLowerCase() === "failed";
}

function refundProviderId(
  provider: PaymentProvider,
  response: RefundProviderResponse,
) {
  if (provider === "BACHS") return (response as BachsRefund).refund_id;
  if (provider === "STRIPE") return (response as StripeRefund).id;
  return paystackRefundId(response as PaystackRefund);
}

function bachsRefundOperationScope(input: {
  operationContext?: RefundOperationContext;
  refundResolutionId?: string | null;
}) {
  if (input.operationContext?.kind === "ORDER_CANCELLATION") {
    return `cancellation:${input.operationContext.moneyDeskRequestId}:${input.operationContext.disputeId}`;
  }
  if (input.operationContext?.kind === "CONSULTATION_POST_PAYOUT") {
    return `consultation:${input.operationContext.moneyDeskRequestId}:${input.operationContext.bookingId}`;
  }
  if (input.refundResolutionId) return `resolution:${input.refundResolutionId}`;
  return "standard";
}

function activeProviderRefundRequest(attempt: RefundablePaymentAttemptRow) {
  if (
    !attempt.provider_response || typeof attempt.provider_response !== "object"
  ) return null;
  const request = attempt.provider_response.latest_refund_request;
  if (!request || typeof request !== "object") return null;
  const response = (request as Record<string, unknown>).response;
  if (!response || typeof response !== "object") return null;
  const status =
    typeof (response as Record<string, unknown>).status === "string"
      ? ((response as Record<string, unknown>).status as string).trim()
        .toLowerCase()
      : "";
  if (
    !["pending", "processing", "needs-attention", "requires_action"].includes(
      status,
    )
  ) return null;
  const refundAmount = (request as Record<string, unknown>).refund_amount;
  const rawId = (response as Record<string, unknown>).id ??
    (response as Record<string, unknown>).refund_id ??
    (response as Record<string, unknown>).refund_reference;
  const operationContext =
    (request as Record<string, unknown>).operation_context;
  return {
    amount: typeof refundAmount === "number" ? refundAmount : null,
    id: typeof rawId === "string" || typeof rawId === "number"
      ? String(rawId)
      : null,
    status: status.toUpperCase(),
    operationContext:
      operationContext && typeof operationContext === "object" &&
        !Array.isArray(operationContext)
        ? operationContext as Record<string, unknown>
        : null,
  };
}

function sameOperationContext(
  existing: Record<string, unknown> | null,
  requested?: RefundOperationContext,
) {
  if (!requested) return existing === null;
  if (
    existing?.kind !== requested.kind ||
    existing.moneyDeskRequestId !== requested.moneyDeskRequestId
  )
    return false
  if (requested.kind === 'ORDER_CANCELLATION') {
    return existing.disputeId === requested.disputeId
  }
  if (requested.kind === 'CONSULTATION_POST_PAYOUT') {
    return existing.bookingId === requested.bookingId
  }
  return (
    existing.refundClaimId === requested.refundClaimId &&
    existing.failedAttemptId === requested.failedAttemptId &&
    existing.paymentAttemptId === requested.paymentAttemptId
  )
}

export async function recordPendingRefundRequest(
  supabase: SupabaseClient,
  input: {
    attempt: RefundablePaymentAttemptRow;
    refundAmount: number;
    providerResponse: RefundProviderResponse;
    actorRole: ActorRole;
    actorId?: string | null;
    reason?: string | null;
    exactRestoration?: ExactRefundRestoration;
    operationContext?: RefundOperationContext;
    consultationFundedRefund?: {
      claimId: string;
      bookingId: string;
      payoutId: string;
    };
  },
) {
  const existing = input.attempt.provider_response &&
      typeof input.attempt.provider_response === "object"
    ? input.attempt.provider_response
    : {};
  const request = {
    requested_at: new Date().toISOString(),
    refund_amount: input.refundAmount,
    currency: input.attempt.currency,
    actor_role: input.actorRole,
    actor_id: input.actorId ?? null,
    reason: input.reason ?? null,
    refund_resolution_id: input.exactRestoration?.refundResolutionId ?? null,
    exact_restoration: input.exactRestoration ?? null,
    operation_context: input.operationContext ?? null,
    response: input.providerResponse,
  };
  const pendingRefunds = Array.isArray(existing.pending_refunds)
    ? existing.pending_refunds
    : [];
  const providerResponse = {
    ...existing,
    latest_refund_request: request,
    pending_refunds: [...pendingRefunds, request],
  };
  const { error } = await supabase.from("order_payments").update({
    provider_response: providerResponse,
  }).eq("id", input.attempt.id);
  if (error) throw new Error(error.message);
  input.attempt.provider_response = providerResponse;
}

type RefundProviderResponse = StripeRefund | PaystackRefund | BachsRefund;

type RefundDependencies = {
  refundStripePaymentIntent: typeof refundStripePaymentIntent;
  refundPaystackTransaction: typeof refundPaystackTransaction;
  requestBachsRefund?: typeof requestBachsRefund;
  getBachsClient?: typeof getBachsClient;
  markPaymentAttemptStatus: typeof markPaymentAttemptStatus;
  recordCommercialPaymentRefund: typeof recordCommercialPaymentRefund;
  assertCommercialPaymentRefundReady?:
    typeof assertCommercialPaymentRefundReady;
  listStripeRefundsForPaymentIntent?: typeof listStripeRefundsForPaymentIntent;
};

const DEFAULT_DEPS: RefundDependencies = {
  refundStripePaymentIntent,
  refundPaystackTransaction,
  requestBachsRefund,
  getBachsClient,
  markPaymentAttemptStatus,
  recordCommercialPaymentRefund,
  assertCommercialPaymentRefundReady,
  listStripeRefundsForPaymentIntent,
};

export class RefundLedgerReconciliationError extends Error {
  readonly paymentId: string;
  readonly providerRefundCompleted = true;

  constructor(paymentId: string, causeMessage: string) {
    super(
      "The provider refund completed, but ledger reconciliation is still pending. Do not retry the provider refund.",
    );
    this.name = "RefundLedgerReconciliationError";
    this.paymentId = paymentId;
    this.cause = new Error(causeMessage);
  }
}

async function assertRefundAttemptReady(
  supabase: SupabaseClient,
  input: {
    attempt: RefundablePaymentAttemptRow;
    refundAmount: number;
    reason?: string | null;
    actorRole: ActorRole;
    actorId?: string | null;
    exactRestoration?: ExactRefundRestoration;
    operationContext?: RefundOperationContext;
    consultationFundedRefund?: {
      claimId: string;
      bookingId: string;
      payoutId: string;
    };
  },
  deps: RefundDependencies,
) {
  if (!deps.assertCommercialPaymentRefundReady) return;
  const beforeRefunded = currentRefundedAmount(input.attempt);
  await deps.assertCommercialPaymentRefundReady(supabase, {
    paymentId: input.attempt.id,
    orderId: input.attempt.order_id,
    refundAmount: input.refundAmount,
    idempotencyKey:
      `payment-refund:${input.attempt.id}:${beforeRefunded}:${input.refundAmount}`,
    metadata: {
      actor_role: input.actorRole,
      actor_id: input.actorId ?? null,
      reason: input.reason ?? null,
    },
    exactRestoration: input.exactRestoration,
    consultationFundedRefund: input.consultationFundedRefund,
  });
}

function currentRefundedAmount(attempt: RefundablePaymentAttemptRow) {
  if (attempt.status === "REFUNDED") return attempt.amount;
  const value = typeof attempt.refunded_amount === "number"
    ? attempt.refunded_amount
    : 0;
  return Math.max(Math.min(value, attempt.amount), 0);
}

function remainingRefundableAmount(attempt: RefundablePaymentAttemptRow) {
  return Math.max(attempt.amount - currentRefundedAmount(attempt), 0);
}

function appendRefundProviderResponse(input: {
  attempt: RefundablePaymentAttemptRow;
  refundAmount: number;
  providerResponse: RefundProviderResponse;
  actorRole: ActorRole;
  actorId?: string | null;
  reason?: string | null;
}) {
  const existingResponse = input.attempt.provider_response &&
      typeof input.attempt.provider_response === "object"
    ? input.attempt.provider_response
    : {};
  const existingPartialRefunds =
    Array.isArray((existingResponse as Record<string, unknown>).partial_refunds)
      ? ((existingResponse as Record<string, unknown>)
        .partial_refunds as unknown[])
      : [];
  const now = new Date().toISOString();
  const refundEntry = {
    refunded_at: now,
    refund_amount: input.refundAmount,
    currency: input.attempt.currency,
    actor_role: input.actorRole,
    actor_id: input.actorId ?? null,
    reason: input.reason ?? null,
    response: input.providerResponse as Record<string, unknown>,
  };

  return {
    ...existingResponse,
    latest_refund: refundEntry,
    partial_refunds: [...existingPartialRefunds, refundEntry],
  };
}

export async function finalizeRefundOnAttempt(
  supabase: SupabaseClient,
  input: {
    attempt: RefundablePaymentAttemptRow;
    refundAmount: number;
    providerResponse: RefundProviderResponse;
    actorRole: ActorRole;
    actorId?: string | null;
    reason?: string | null;
    exactRestoration?: ExactRefundRestoration;
  },
  deps: RefundDependencies = DEFAULT_DEPS,
) {
  const beforeRefunded = currentRefundedAmount(input.attempt);
  const totalRefundedAmount = Math.min(
    input.attempt.amount,
    beforeRefunded + input.refundAmount,
  );
  const remainingAmount = Math.max(
    input.attempt.amount - totalRefundedAmount,
    0,
  );
  const nextStatus: PaymentStatus = remainingAmount <= 0
    ? "REFUNDED"
    : "PARTIAL_REFUND";
  const now = new Date().toISOString();
  const providerResponse = appendRefundProviderResponse({
    attempt: input.attempt,
    refundAmount: input.refundAmount,
    providerResponse: input.providerResponse,
    actorRole: input.actorRole,
    actorId: input.actorId ?? null,
    reason: input.reason ?? null,
  });

  const patch: Record<string, unknown> = {
    status: nextStatus,
    refunded_amount: totalRefundedAmount,
    partial_refund_count: Math.max(input.attempt.partial_refund_count ?? 0, 0) +
      1,
    last_refund_amount: input.refundAmount,
    last_refund_at: now,
    provider_response: providerResponse,
  };

  if (nextStatus === "REFUNDED") patch.refunded_at = now;

  const { error } = await supabase
    .from("order_payments")
    .update(patch)
    .eq("id", input.attempt.id);

  if (error) throw new Error(error.message);

  input.attempt.status = nextStatus;
  input.attempt.refunded_amount = totalRefundedAmount;
  input.attempt.partial_refund_count = patch.partial_refund_count as number;
  input.attempt.provider_response = providerResponse;

  let consultationFundedRefund: {
    claimId: string;
    bookingId: string;
    payoutId: string;
  } | undefined;
  if (input.attempt.phase === "CONSULTATION") {
    const rawReference =
      (input.providerResponse as Record<string, unknown>).id ??
        (input.providerResponse as Record<string, unknown>).refund_id ??
        (input.providerResponse as Record<string, unknown>).reference ??
        (input.providerResponse as Record<string, unknown>).transaction;
    if (typeof rawReference === "string" || typeof rawReference === "number") {
      let claim = await findConsultationPostPayoutRefundClaim(supabase, {
        paymentId: input.attempt.id,
        providerReference: String(rawReference),
        amount: input.refundAmount,
      });
      const terminal = refundProviderSucceeded(
        input.attempt.provider,
        input.providerResponse,
      );
      if (
        claim && claim.status !== "PROVIDER_CONFIRMED" &&
        claim.status !== "SUCCEEDED" && terminal
      ) {
        await recordConsultationPostPayoutRefundProviderResult(supabase, {
          claimId: String(claim.id),
          providerReference: String(rawReference),
          confirmed: true,
          providerResponse: input.providerResponse as Record<string, unknown>,
        });
        claim = await findConsultationPostPayoutRefundClaim(supabase, {
          paymentId: input.attempt.id,
          providerReference: String(rawReference),
          amount: input.refundAmount,
        });
      }
      if (
        claim?.status === "PROVIDER_CONFIRMED" || claim?.status === "SUCCEEDED"
      ) {
        consultationFundedRefund = {
          claimId: String(claim.id),
          bookingId: String(claim.booking_id),
          payoutId: String(claim.payout_id),
        };
      }
    }
  }
  try {
    const rawProviderReference =
      (input.providerResponse as Record<string, unknown>).id ??
        (input.providerResponse as Record<string, unknown>).refund_id;
    const ledgerResult = await deps.recordCommercialPaymentRefund(supabase, {
      paymentId: input.attempt.id,
      orderId: input.attempt.order_id,
      refundAmount: input.refundAmount,
      idempotencyKey:
        `payment-refund:${input.attempt.id}:${beforeRefunded}:${input.refundAmount}`,
      providerReference: typeof rawProviderReference === "string" ||
          typeof rawProviderReference === "number"
        ? String(rawProviderReference)
        : null,
      metadata: {
        actor_role: input.actorRole,
        actor_id: input.actorId ?? null,
        reason: input.reason ?? null,
      },
      exactRestoration: input.exactRestoration,
      consultationFundedRefund,
    });
    if (
      consultationFundedRefund && typeof ledgerResult.transactionId === "string"
    ) {
      await finalizeConsultationPostPayoutRefundClaim(supabase, {
        claimId: consultationFundedRefund.claimId,
        ledgerTransactionId: ledgerResult.transactionId,
      });
    }
  } catch (ledgerError) {
    const ledgerMessage = ledgerError instanceof Error
      ? ledgerError.message
      : String(ledgerError);
    await createOrRefreshOpsIssue(supabase, {
      issueType: "REFUND_FAILED",
      severity: "CRITICAL",
      source: "commercial-ledger",
      actorId: input.actorId ?? null,
      actorRole: input.actorRole,
      orderId: input.attempt.order_id,
      provider: input.attempt.provider,
      title: "Refund completed but ledger reconciliation failed",
      description:
        "The provider refund and payment record succeeded, but Drapeon could not post the balanced refund journal.",
      recommendedAction:
        "Do not retry the provider refund. Reconcile the existing provider refund against the commercial ledger and close this issue only after the journal is posted.",
      dedupeKey:
        `refund-ledger-missing:${input.attempt.id}:${beforeRefunded}:${input.refundAmount}`,
      metadata: {
        payment_id: input.attempt.id,
        refund_amount: input.refundAmount,
        refund_resolution_id: input.exactRestoration?.refundResolutionId ??
          null,
        error: ledgerMessage,
      },
    });
    try {
      await Sentry.captureMessage(
        "Refund completed without a commercial ledger journal",
        {
          level: "error",
          tags: {
            component: "commercial-ledger",
            provider: input.attempt.provider,
          },
          extra: {
            order_id: input.attempt.order_id,
            payment_id: input.attempt.id,
            refund_amount: input.refundAmount,
            error: ledgerMessage,
          },
        },
      );
    } catch {
      // Observability must never hide the reconciliation error that tells Ops not to retry the provider.
    }
    throw new RefundLedgerReconciliationError(input.attempt.id, ledgerMessage);
  }

  return {
    remainingRefundableAmount: remainingAmount,
    totalRefundedAmount,
    partial: nextStatus === "PARTIAL_REFUND",
  };
}

async function loadRefundableAttempts(
  supabase: SupabaseClient,
  input: {
    orderId: string
    allowedPhases: PaymentPhase[]
    paymentAttemptId?: string
  }
) {
  let query = supabase
    .from('order_payments')
    .select(
      "id, order_id, phase, provider, currency, amount, status, provider_payment_id, provider_charge_id, provider_response, refunded_amount, partial_refund_count, consultation_booking_id, consultation_booking_link_source",
    )
    .eq("order_id", input.orderId)
    .in("phase", input.allowedPhases)
    .order("created_at", { ascending: true });

  if (input.paymentAttemptId) query.eq('id', input.paymentAttemptId)

  const { data: attemptsData, error: attemptsError } = await query

  if (attemptsError) {
    throw new Error(attemptsError.message);
  }

  return (attemptsData as RefundablePaymentAttemptRow[] | null) ?? [];
}

export async function refundSettledOrderPayments(
  supabase: SupabaseClient,
  input: {
    orderId: string;
    reason?: string | null;
    actorRole: ActorRole;
    actorId?: string | null;
    allowedPhases?: PaymentPhase[];
    exactRestoration?: ExactRefundRestoration;
    operationContext?: RefundOperationContext;
    acceptedRoute?: AcceptedRefundRoute | null;
  },
  deps: RefundDependencies = DEFAULT_DEPS,
): Promise<RefundSettledOrderPaymentsResult> {
  const allowedPhases = input.allowedPhases ??
    ["INITIAL_ORDER", "CONSULTATION", "FULFILLMENT"];
  const attempts = await loadRefundableAttempts(supabase, {
    orderId: input.orderId,
    allowedPhases,
  });
  const succeededAttempts = attempts.filter((attempt) =>
    attempt.status === "SUCCEEDED" || attempt.status === "PARTIAL_REFUND"
  );
  await assertAttemptsMatchAcceptedRoute(
    supabase,
    succeededAttempts,
    input.acceptedRoute,
    input,
  );
  const alreadyRefundedAttemptIds = attempts
    .filter((attempt) =>
      attempt.status === "REFUNDED" || remainingRefundableAmount(attempt) <= 0
    )
    .map((attempt) => attempt.id);

  const refundedAttempts: RefundedAttemptSummary[] = [];
  const pendingAttempts: PendingRefundSummary[] = [];

  for (const attempt of succeededAttempts) {
    const refundAmount = remainingRefundableAmount(attempt);
    if (refundAmount <= 0) continue;

    if (!attempt.provider_payment_id?.trim()) {
      await audit(supabase, {
        event: "payment.refund_missing_provider_payment_id",
        actor_id: input.actorId ?? null,
        actor_role: input.actorRole,
        order_id: input.orderId,
        severity: "warn",
        payload: {
          payment_id: attempt.id,
          provider: attempt.provider,
          phase: attempt.phase,
        },
      });

      await createOrRefreshOpsIssue(supabase, {
        issueType: "REFUND_FAILED",
        severity: "CRITICAL",
        source: "payment-refunds",
        actorId: input.actorId ?? null,
        actorRole: input.actorRole,
        orderId: input.orderId,
        provider: attempt.provider,
        title: "Refund could not start",
        description:
          `A settled ${attempt.provider.toLowerCase()} payment is missing its provider reference and cannot be refunded safely.`,
        recommendedAction:
          "Inspect the payment ledger, recover the provider payment reference, and only retry the refund when the original charge can be matched confidently.",
        dedupeKey: `refund-failed:${attempt.id}:missing-provider-reference`,
        metadata: {
          payment_id: attempt.id,
          provider: attempt.provider,
          phase: attempt.phase,
        },
      });

      throw new Error(
        "A settled payment is missing its provider payment reference and cannot be refunded safely.",
      );
    }

    const providerPaymentId = attempt.provider_payment_id.trim();
    let consultationReserved = false;
    try {
      if (!refundProviderSupported(attempt.provider)) {
        throw new Error(
          `Refunds for ${
            providerLabel(attempt.provider)
          } are not configured; no provider was called.`,
        );
      }
      const activeRefund = attempt.provider === "BACHS"
        ? null
        : activeProviderRefundRequest(attempt);
      if (activeRefund) {
        if (
          !sameOperationContext(
            activeRefund.operationContext,
            input.operationContext,
          )
        ) {
          throw new Error(
            "A provider refund is already processing under a different approved operation. Do not create a second refund.",
          );
        }
        if (activeRefund.amount !== refundAmount) {
          throw new Error(
            `A different ${
              providerLabel(attempt.provider)
            } refund is already processing for this payment. Do not create a second refund.`,
          );
        }
        pendingAttempts.push({
          id: attempt.id,
          provider: attempt.provider,
          providerPaymentId,
          providerRefundId: activeRefund.id,
          phase: attempt.phase,
          amount: refundAmount,
          currency: attempt.currency,
          status: activeRefund.status,
        });
        continue;
      }
      await assertRefundAttemptReady(supabase, {
        attempt,
        refundAmount,
        reason: input.reason ?? null,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        exactRestoration: input.exactRestoration,
      }, deps);
      if (attempt.phase === "CONSULTATION") {
        const reservation = await reserveConsultationRefund(
          supabase,
          attempt,
          input.operationContext?.kind === 'BACHS_REFUND_RETRY' ? undefined : input.operationContext
        )
        if (!reservation.reserved) {
          pendingAttempts.push({
            id: attempt.id,
            provider: attempt.provider,
            providerPaymentId,
            providerRefundId: null,
            phase: attempt.phase,
            amount: refundAmount,
            currency: attempt.currency,
            status: reservation.status,
          });
          continue;
        }
        consultationReserved = true;
      }
      let providerResponse: RefundProviderResponse
      if (attempt.provider === 'BACHS') {
        const result: BachsRefundClaimResult = await (
          deps.requestBachsRefund ?? requestBachsRefund
        )({
          supabase,
          client: (deps.getBachsClient ?? getBachsClient)(),
          payment: {
            id: attempt.id,
            order_id: attempt.order_id,
            phase: attempt.phase,
            currency: attempt.currency,
            amount: attempt.amount,
            refunded_amount: attempt.refunded_amount,
            provider_payment_id: providerPaymentId,
            provider_charge_id: attempt.provider_charge_id ?? '',
          },
          refundAmount,
          reason: input.reason ?? null,
          operationScope: bachsRefundOperationScope({
            operationContext: input.operationContext,
            refundResolutionId: input.exactRestoration?.refundResolutionId,
          }),
          existingClaimId:
            input.operationContext?.kind === 'BACHS_REFUND_RETRY'
              ? input.operationContext.refundClaimId
              : undefined,
          reviewedRetry:
            input.operationContext?.kind === 'BACHS_REFUND_RETRY'
              ? {
                  moneyDeskRequestId: input.operationContext.moneyDeskRequestId,
                  failedAttemptId: input.operationContext.failedAttemptId,
                }
              : undefined,
        })
        if (!result.response || result.status === 'OPS_REVIEW' || result.status === 'FAILED') {
          pendingAttempts.push({
            id: attempt.id,
            provider: attempt.provider,
            providerPaymentId,
            providerRefundId: result.response?.refund_id ?? null,
            phase: attempt.phase,
            amount: refundAmount,
            currency: attempt.currency,
            status: result.status,
          })
          continue
        }
        providerResponse = result.response;
      } else if (attempt.provider === "STRIPE") {
        providerResponse = await deps.refundStripePaymentIntent({
          paymentIntentId: providerPaymentId,
          amount: refundAmount,
          idempotencyKey: `refund:${attempt.id}:${
            currentRefundedAmount(attempt)
          }:${refundAmount}`,
          reasonNote: input.reason ?? null,
          metadata: {
            drapeon_payment_id: attempt.id,
            drapeon_order_id: attempt.order_id,
            refund_resolution_id: input.exactRestoration?.refundResolutionId ??
              null,
            money_desk_request_id: input.operationContext?.moneyDeskRequestId ??
              null,
            cancellation_dispute_id:
              input.operationContext?.kind === "ORDER_CANCELLATION"
                ? input.operationContext.disputeId
                : null,
          },
        });
      } else {
        providerResponse = await deps.refundPaystackTransaction({
          reference: providerPaymentId,
          amount: refundAmount,
          currency: attempt.currency,
          reasonNote: input.reason ?? null,
        });
      }

      const refundTerminal = refundProviderSucceeded(
        attempt.provider,
        providerResponse,
      );
      if (refundProviderFailed(attempt.provider, providerResponse)) {
        pendingAttempts.push({
          id: attempt.id,
          provider: attempt.provider,
          providerPaymentId,
          providerRefundId: refundProviderId(
            attempt.provider,
            providerResponse,
          ),
          phase: attempt.phase,
          amount: refundAmount,
          currency: attempt.currency,
          status: "FAILED",
        });
        continue;
      }
      if (!refundTerminal) {
        await recordPendingRefundRequest(supabase, {
          attempt,
          refundAmount,
          providerResponse,
          actorRole: input.actorRole,
          actorId: input.actorId ?? null,
          reason: input.reason ?? null,
          exactRestoration: input.exactRestoration,
          operationContext: input.operationContext,
        });
        pendingAttempts.push({
          id: attempt.id,
          provider: attempt.provider,
          providerPaymentId,
          providerRefundId: refundProviderId(
            attempt.provider,
            providerResponse,
          ),
          phase: attempt.phase,
          amount: refundAmount,
          currency: attempt.currency,
          status: providerResponse.status?.trim().toUpperCase() || "PENDING",
        });
        continue;
      }

      const recorded = await finalizeRefundOnAttempt(supabase, {
        attempt,
        refundAmount,
        providerResponse,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
        exactRestoration: input.exactRestoration,
      }, deps);
      if (attempt.phase === "CONSULTATION") {
        const rawProviderReference =
          (providerResponse as unknown as Record<string, unknown>).id ??
            (providerResponse as unknown as Record<string, unknown>).refund_id;
        await recordConsultationRefundOutcome(supabase, {
          payment: attempt,
          refundAmount,
          provider: attempt.provider as "STRIPE" | "PAYSTACK" | "BACHS",
          providerReference: typeof rawProviderReference === "string" ||
              typeof rawProviderReference === "number"
            ? String(rawProviderReference)
            : null,
        });
        consultationReserved = false;
      }

      refundedAttempts.push({
        id: attempt.id,
        provider: attempt.provider,
        providerPaymentId,
        phase: attempt.phase,
        amount: refundAmount,
        currency: attempt.currency,
        remainingRefundableAmount: recorded.remainingRefundableAmount,
        totalRefundedAmount: recorded.totalRefundedAmount,
        partial: recorded.partial,
        providerRefundId: refundProviderReference(providerResponse),
      });
    } catch (error) {
      if (error instanceof RefundLedgerReconciliationError) {
        if (consultationReserved) {
          await failConsultationRefundReservation(
            supabase,
            attempt,
            error.message,
          );
        }
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (consultationReserved) {
        await failConsultationRefundReservation(supabase, attempt, message);
      }

      await createOrRefreshOpsIssue(supabase, {
        issueType: "REFUND_FAILED",
        severity: "CRITICAL",
        source: "payment-refunds",
        actorId: input.actorId ?? null,
        actorRole: input.actorRole,
        orderId: input.orderId,
        provider: attempt.provider,
        title: "Refund execution failed",
        description:
          `A ${attempt.provider.toLowerCase()} refund attempt failed and needs manual ops review.`,
        recommendedAction:
          "Check the provider response, confirm whether the charge was already reversed, and retry the refund only when the payment state is clear.",
        dedupeKey: `refund-failed:${attempt.id}`,
        metadata: {
          payment_id: attempt.id,
          provider: attempt.provider,
          phase: attempt.phase,
          provider_payment_id: providerPaymentId,
          error: message,
        },
      });

      throw error;
    }
  }

  await audit(supabase, {
    event: "payment.refund_executed",
    actor_id: input.actorId ?? null,
    actor_role: input.actorRole,
    order_id: input.orderId,
    payload: {
      refunded_attempts: refundedAttempts,
      pending_attempts: pendingAttempts,
      already_refunded_attempt_ids: alreadyRefundedAttemptIds,
      reason: input.reason ?? null,
      allowed_phases: allowedPhases,
    },
  });

  return {
    refundedAttempts,
    pendingAttempts,
    alreadyRefundedAttemptIds,
  };
}

export async function partiallyRefundOrderPayments(
  supabase: SupabaseClient,
  input: {
    orderId: string
    amount: number
    reason?: string | null
    actorRole: ActorRole
    actorId?: string | null
    allowedPhases?: PaymentPhase[]
    exactRestoration?: ExactRefundRestoration
    operationContext?: RefundOperationContext
    paymentAttemptId?: string
    acceptedRoute?: AcceptedRefundRoute | null
  },
  deps: RefundDependencies = DEFAULT_DEPS,
): Promise<PartialRefundOrderPaymentsResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Partial refund amount must be greater than zero.");
  }

  const allowedPhases = input.allowedPhases ??
    ["INITIAL_ORDER", "CONSULTATION", "FULFILLMENT"];
  const attempts = await loadRefundableAttempts(supabase, {
    orderId: input.orderId,
    allowedPhases,
    paymentAttemptId: input.paymentAttemptId,
  })

  let refundableAttempts = attempts.filter((attempt) => {
    if (attempt.status !== "SUCCEEDED" && attempt.status !== "PARTIAL_REFUND") {
      return false;
    }
    return remainingRefundableAmount(attempt) > 0;
  });
  const postPayoutContext =
    input.operationContext?.kind === "CONSULTATION_POST_PAYOUT"
      ? input.operationContext
      : null;
  if (postPayoutContext) {
    const linked = refundableAttempts.filter((attempt) =>
      attempt.phase === "CONSULTATION" &&
      attempt.consultation_booking_id === postPayoutContext.bookingId
    );
    if (linked.length !== 1) {
      await createOrRefreshOpsIssue(supabase, {
        issueType: "REFUND_FAILED",
        severity: "CRITICAL",
        source: "consultation-post-payout-refund",
        actorRole: input.actorRole,
        orderId: input.orderId,
        title: "Post-payout consultation refund has no unique payment link",
        description:
          "The approved Money Desk refund did not resolve to exactly one refundable consultation payment linked to the target booking. No provider was called.",
        recommendedAction:
          "Reconcile the booking, approved refund amount, and exact consultation payment before retrying. Do not infer the link from order metadata.",
        dedupeKey:
          `consultation-post-payout-refund-link:${postPayoutContext.bookingId}:${postPayoutContext.moneyDeskRequestId}`,
        queueKey: "money-desk",
        persistWhenRoutineDisabled: true,
        relatedEntityType: "CONSULTATION_BOOKING",
        relatedEntityId: postPayoutContext.bookingId,
        metadata: {
          booking_id: postPayoutContext.bookingId,
          money_desk_request_id: postPayoutContext.moneyDeskRequestId,
          matching_payment_count: linked.length,
        },
      });
      throw new Error(
        "The approved consultation refund does not match exactly one refundable booking payment.",
      );
    }
    refundableAttempts = linked;
  }
  await assertAttemptsMatchAcceptedRoute(
    supabase,
    refundableAttempts,
    input.acceptedRoute,
    input,
  );
  const alreadyRefundedAttemptIds = attempts
    .filter((attempt) =>
      attempt.status === "REFUNDED" || remainingRefundableAmount(attempt) <= 0
    )
    .map((attempt) => attempt.id);

  const totalRemainingRefundable = refundableAttempts.reduce(
    (sum, attempt) => sum + remainingRefundableAmount(attempt),
    0,
  );
  if (input.amount > totalRemainingRefundable) {
    throw new Error(
      "Requested refund exceeds the remaining refundable amount for this order.",
    );
  }

  let amountLeft = input.amount;
  const refundedAttempts: RefundedAttemptSummary[] = [];
  const pendingAttempts: PendingRefundSummary[] = [];

  for (const attempt of refundableAttempts) {
    if (amountLeft <= 0) break;
    if (!attempt.provider_payment_id?.trim()) {
      throw new Error(
        "A partially refundable payment is missing its provider payment reference and cannot be refunded safely.",
      );
    }

    const refundable = remainingRefundableAmount(attempt);
    if (refundable <= 0) continue;

    const refundAmount = Math.min(amountLeft, refundable);
    const providerPaymentId = attempt.provider_payment_id.trim();
    if (!refundProviderSupported(attempt.provider)) {
      await createOrRefreshOpsIssue(supabase, {
        issueType: "REFUND_FAILED",
        severity: "CRITICAL",
        source: "payment-refunds",
        actorId: input.actorId ?? null,
        actorRole: input.actorRole,
        orderId: input.orderId,
        provider: attempt.provider,
        title: "Refund provider is not configured",
        description: `A ${
          providerLabel(attempt.provider)
        } payment attempt cannot be refunded because its provider adapter is not configured. No provider was called.`,
        recommendedAction:
          "Verify the accepted route and provider payment record, then complete the provider refund through the supported reviewed path.",
        dedupeKey: `refund-provider-unsupported:${attempt.id}`,
        metadata: {
          payment_id: attempt.id,
          provider: attempt.provider,
          phase: attempt.phase,
        },
      });
      throw new Error(
        `Refunds for ${
          providerLabel(attempt.provider)
        } are not configured; no provider was called.`,
      );
    }
    const activeRefund = attempt.provider === "BACHS"
      ? null
      : activeProviderRefundRequest(attempt);
    if (activeRefund) {
      if (
        !sameOperationContext(
          activeRefund.operationContext,
          input.operationContext,
        )
      ) {
        throw new Error(
          "A provider refund is already processing under a different approved operation. Do not create a second refund.",
        );
      }
      if (activeRefund.amount !== refundAmount) {
        throw new Error(
          `A different ${
            providerLabel(attempt.provider)
          } refund is already processing for this payment. Do not create a second refund.`,
        );
      }
      pendingAttempts.push({
        id: attempt.id,
        provider: attempt.provider,
        providerPaymentId,
        providerRefundId: activeRefund.id,
        phase: attempt.phase,
        amount: refundAmount,
        currency: attempt.currency,
        status: activeRefund.status,
      });
      amountLeft -= refundAmount;
      continue;
    }
    let fundedRefundContext: {
      claimId: string;
      bookingId: string;
      payoutId: string;
    } | undefined;
    let postPayoutReservation:
      | Awaited<ReturnType<typeof reserveConsultationRefund>>
      | null = null;
    if (postPayoutContext) {
      const reservation = await reserveConsultationRefund(
        supabase,
        attempt,
        postPayoutContext,
        refundAmount,
      );
      if (!reservation.postPayoutClaimId || !reservation.payoutId) {
        pendingAttempts.push({
          id: attempt.id,
          provider: attempt.provider,
          providerPaymentId,
          providerRefundId: null,
          phase: attempt.phase,
          amount: refundAmount,
          currency: attempt.currency,
          status: reservation.status,
        });
        amountLeft -= refundAmount;
        continue;
      }
      postPayoutReservation = reservation;
      fundedRefundContext = {
        claimId: reservation.postPayoutClaimId,
        bookingId: postPayoutContext.bookingId,
        payoutId: reservation.payoutId,
      };
      if (attempt.provider !== "STRIPE" && attempt.provider !== "BACHS") {
        await requireConsultationPostPayoutRefundReview(supabase, {
          claimId: fundedRefundContext.claimId,
          bookingId: fundedRefundContext.bookingId,
          payment: attempt,
          reason: "Provider lacks a claim-bound idempotent refund adapter.",
        });
        throw new Error(
          "Post-payout consultation refunds require a claim-bound provider idempotency adapter.",
        );
      }
      if (deps.assertCommercialPaymentRefundReady) {
        try {
          await deps.assertCommercialPaymentRefundReady(supabase, {
            paymentId: attempt.id,
            orderId: attempt.order_id,
            refundAmount,
            idempotencyKey: `payment-refund:${attempt.id}:${
              currentRefundedAmount(attempt)
            }:${refundAmount}`,
            metadata: {
              actor_role: input.actorRole,
              actor_id: input.actorId ?? null,
              reason: input.reason ?? null,
            },
            consultationFundedRefund: fundedRefundContext,
          });
        } catch (validationError) {
          await requireConsultationPostPayoutRefundReview(supabase, {
            claimId: fundedRefundContext.claimId,
            bookingId: fundedRefundContext.bookingId,
            payment: attempt,
            reason: validationError instanceof Error
              ? validationError.message
              : String(validationError),
          });
          throw validationError;
        }
      }
    } else {
      await assertRefundAttemptReady(supabase, {
        attempt,
        refundAmount,
        reason: input.reason ?? null,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        exactRestoration: input.exactRestoration,
      }, deps);
      if (attempt.phase === "CONSULTATION") {
        const reservation = await reserveConsultationRefund(
          supabase,
          attempt,
          input.operationContext?.kind === 'BACHS_REFUND_RETRY'
            ? undefined
            : input.operationContext,
          refundAmount
        )
        if (!reservation.reserved) {
          pendingAttempts.push({
            id: attempt.id,
            provider: attempt.provider,
            providerPaymentId,
            providerRefundId: null,
            phase: attempt.phase,
            amount: refundAmount,
            currency: attempt.currency,
            status: reservation.status,
          });
          amountLeft -= refundAmount;
          continue;
        }
      }
    }
    let providerResponse: RefundProviderResponse;
    if (
      fundedRefundContext && postPayoutReservation &&
      !postPayoutReservation.created
    ) {
      const cachedResponse = postPayoutReservation.providerResponse;
      const cachedStatus = typeof cachedResponse?.status === "string"
        ? cachedResponse.status.toLowerCase()
        : "";
      if (cachedResponse && postPayoutReservation.status === "SUCCEEDED") {
        providerResponse = cachedResponse as unknown as RefundProviderResponse;
      } else if (
        cachedResponse && postPayoutReservation.status === "PROVIDER_CONFIRMED"
      ) {
        providerResponse = cachedResponse as unknown as RefundProviderResponse;
      } else if (
        cachedResponse && postPayoutReservation.status === "PROCESSING"
      ) {
        pendingAttempts.push({
          id: attempt.id,
          provider: attempt.provider,
          providerPaymentId,
          providerRefundId: postPayoutReservation.providerReference,
          phase: attempt.phase,
          amount: refundAmount,
          currency: attempt.currency,
          status: cachedStatus.toUpperCase() || "PROCESSING",
        });
        amountLeft -= refundAmount;
        continue;
      } else if (
        postPayoutReservation.status === "CLAIMED" &&
        !postPayoutReservation.providerReference
      ) {
        if (attempt.provider === "BACHS") {
          const result = await (deps.requestBachsRefund ?? requestBachsRefund)({
            supabase,
            client: (deps.getBachsClient ?? getBachsClient)(),
            payment: {
              id: attempt.id,
              order_id: attempt.order_id,
              phase: attempt.phase,
              currency: attempt.currency,
              amount: attempt.amount,
              refunded_amount: attempt.refunded_amount,
              provider_payment_id: providerPaymentId,
              provider_charge_id: attempt.provider_charge_id ?? "",
            },
            refundAmount,
            reason: input.reason ?? null,
            operationScope: bachsRefundOperationScope({
              operationContext: input.operationContext,
              refundResolutionId: input.exactRestoration?.refundResolutionId,
            }),
            existingClaimId:
              input.operationContext?.kind === 'BACHS_REFUND_RETRY'
                ? input.operationContext.refundClaimId
                : undefined,
            reviewedRetry:
              input.operationContext?.kind === 'BACHS_REFUND_RETRY'
                ? {
                    moneyDeskRequestId: input.operationContext.moneyDeskRequestId,
                    failedAttemptId: input.operationContext.failedAttemptId,
                  }
                : undefined,
          })
          if (!result.response || result.status === 'OPS_REVIEW' || result.status === 'FAILED') {
            await requireConsultationPostPayoutRefundReview(supabase, {
              claimId: fundedRefundContext.claimId,
              bookingId: fundedRefundContext.bookingId,
              payment: attempt,
              reason:
                `Bachs refund outcome requires review (${result.status}).`,
            });
            pendingAttempts.push({
              id: attempt.id,
              provider: attempt.provider,
              providerPaymentId,
              providerRefundId: result.response?.refund_id ?? null,
              phase: attempt.phase,
              amount: refundAmount,
              currency: attempt.currency,
              status: result.status,
            })
            amountLeft -= refundAmount
            continue
          }
          providerResponse = result.response;
        } else if (attempt.provider === "STRIPE") {
          let matches: StripeRefund[] = [];
          try {
            matches = await deps.listStripeRefundsForPaymentIntent!(
              providerPaymentId,
            )
              .then((rows) =>
                rows.filter((refund) =>
                  refund.payment_intent === providerPaymentId &&
                  refund.amount === refundAmount &&
                  refund.metadata?.consultation_refund_claim_id ===
                    fundedRefundContext!.claimId &&
                  refund.metadata?.money_desk_request_id ===
                    postPayoutContext!.moneyDeskRequestId
                )
              );
          } catch (lookupError) {
            matches = [];
            await audit(supabase, {
              event: "consultation.post_payout_refund_provider_lookup_failed",
              actor_role: input.actorRole,
              order_id: input.orderId,
              severity: "error",
              payload: {
                claim_id: fundedRefundContext.claimId,
                payment_id: attempt.id,
                error: lookupError instanceof Error
                  ? lookupError.message
                  : String(lookupError),
              },
            });
          }
          if (matches.length === 1 && matches[0].id) {
            providerResponse = matches[0];
            const recoveredTerminal = stripeRefundIsTerminal(
              providerResponse as StripeRefund,
            );
            await recordConsultationPostPayoutRefundProviderResult(supabase, {
              claimId: fundedRefundContext.claimId,
              providerReference: matches[0].id,
              confirmed: recoveredTerminal,
              providerResponse: matches[0] as unknown as Record<
                string,
                unknown
              >,
            });
            if (!recoveredTerminal) {
              await recordPendingRefundRequest(supabase, {
                attempt,
                refundAmount,
                providerResponse,
                actorRole: input.actorRole,
                actorId: input.actorId ?? null,
                reason: input.reason ?? null,
                exactRestoration: input.exactRestoration,
                operationContext: input.operationContext,
              });
              pendingAttempts.push({
                id: attempt.id,
                provider: attempt.provider,
                providerPaymentId,
                providerRefundId: matches[0].id,
                phase: attempt.phase,
                amount: refundAmount,
                currency: attempt.currency,
                status: cachedStatus.toUpperCase() || "PROCESSING",
              });
              amountLeft -= refundAmount;
              continue;
            }
          } else {
            const lookupReason = matches.length > 1
              ? "Stripe returned multiple refunds matching the same claim."
              : "Stripe has no uniquely matching refund for the reserved claim.";
            await markConsultationPostPayoutRefundOpsReview(supabase, {
              claimId: fundedRefundContext.claimId,
              reason: lookupReason,
            });
            await createOrRefreshOpsIssue(supabase, {
              issueType: "REFUND_FAILED",
              severity: "CRITICAL",
              source: "consultation-post-payout-refund",
              actorRole: input.actorRole,
              orderId: input.orderId,
              provider: "STRIPE",
              title: "Post-payout refund needs provider reconciliation",
              description:
                "A reserved consultation refund had no safely recoverable provider reference. The refund was not resubmitted.",
              recommendedAction:
                "Inspect Stripe refunds for the exact payment and claim metadata. If one refund is confirmed, reconcile it to the claim; do not issue a second refund.",
              dedupeKey:
                `consultation-post-payout-refund-reconcile:${fundedRefundContext.claimId}`,
              queueKey: "money-desk",
              persistWhenRoutineDisabled: true,
              relatedEntityType: "CONSULTATION_BOOKING",
              relatedEntityId: fundedRefundContext.bookingId,
              metadata: {
                claim_id: fundedRefundContext.claimId,
                payment_id: attempt.id,
                matching_refund_count: matches.length,
              },
            });
            pendingAttempts.push({
              id: attempt.id,
              provider: attempt.provider,
              providerPaymentId,
              providerRefundId: null,
              phase: attempt.phase,
              amount: refundAmount,
              currency: attempt.currency,
              status: "OPS_REVIEW",
            });
            amountLeft -= refundAmount;
            continue;
          }
        } else {
          await requireConsultationPostPayoutRefundReview(supabase, {
            claimId: fundedRefundContext.claimId,
            bookingId: fundedRefundContext.bookingId,
            payment: attempt,
            reason:
              "Provider refund lookup is not implemented for this consultation claim.",
          });
          pendingAttempts.push({
            id: attempt.id,
            provider: attempt.provider,
            providerPaymentId,
            providerRefundId: null,
            phase: attempt.phase,
            amount: refundAmount,
            currency: attempt.currency,
            status: "OPS_REVIEW",
          });
          amountLeft -= refundAmount;
          continue;
        }
      } else {
        pendingAttempts.push({
          id: attempt.id,
          provider: attempt.provider,
          providerPaymentId,
          providerRefundId: postPayoutReservation.providerReference,
          phase: attempt.phase,
          amount: refundAmount,
          currency: attempt.currency,
          status: postPayoutReservation.status,
        });
        amountLeft -= refundAmount;
        continue;
      }
    } else {
      try {
        if (attempt.provider === "BACHS") {
          const result = await (deps.requestBachsRefund ?? requestBachsRefund)({
            supabase,
            client: (deps.getBachsClient ?? getBachsClient)(),
            payment: {
              id: attempt.id,
              order_id: attempt.order_id,
              phase: attempt.phase,
              currency: attempt.currency,
              amount: attempt.amount,
              refunded_amount: attempt.refunded_amount,
              provider_payment_id: providerPaymentId,
              provider_charge_id: attempt.provider_charge_id ?? "",
            },
            refundAmount,
            reason: input.reason ?? null,
            operationScope: bachsRefundOperationScope({
              operationContext: input.operationContext,
              refundResolutionId: input.exactRestoration?.refundResolutionId,
            }),
          });
          if (
            !result.response || result.status === "OPS_REVIEW" ||
            result.status === "FAILED"
          ) {
            if (fundedRefundContext) {
              await requireConsultationPostPayoutRefundReview(supabase, {
                claimId: fundedRefundContext.claimId,
                bookingId: fundedRefundContext.bookingId,
                payment: attempt,
                reason:
                  `Bachs refund outcome requires review (${result.status}).`,
              });
            }
            pendingAttempts.push({
              id: attempt.id,
              provider: attempt.provider,
              providerPaymentId,
              providerRefundId: result.response?.refund_id ?? null,
              phase: attempt.phase,
              amount: refundAmount,
              currency: attempt.currency,
              status: "OPS_REVIEW",
            });
            amountLeft -= refundAmount;
            continue;
          }
          providerResponse = result.response;
        } else if (attempt.provider === "STRIPE") {
          providerResponse = await deps.refundStripePaymentIntent({
            paymentIntentId: providerPaymentId,
            amount: refundAmount,
            idempotencyKey: postPayoutReservation?.idempotencyKey ??
              `partial-refund:${attempt.id}:${
                currentRefundedAmount(attempt)
              }:${refundAmount}`,
            reasonNote: input.reason ?? null,
            metadata: {
              drapeon_payment_id: attempt.id,
              drapeon_order_id: attempt.order_id,
              refund_resolution_id:
                input.exactRestoration?.refundResolutionId ?? null,
              money_desk_request_id:
                input.operationContext?.moneyDeskRequestId ?? null,
              cancellation_dispute_id:
                input.operationContext?.kind === "ORDER_CANCELLATION"
                  ? input.operationContext.disputeId
                  : null,
              consultation_booking_id: fundedRefundContext?.bookingId ?? null,
              consultation_refund_claim_id: fundedRefundContext?.claimId ??
                null,
            },
          });
        } else {
          providerResponse = await deps.refundPaystackTransaction({
            reference: providerPaymentId,
            amount: refundAmount,
            currency: attempt.currency,
            reasonNote: input.reason ?? null,
          });
        }
      } catch (providerError) {
        if (fundedRefundContext) {
          await requireConsultationPostPayoutRefundReview(supabase, {
            claimId: fundedRefundContext.claimId,
            bookingId: fundedRefundContext.bookingId,
            payment: attempt,
            reason: providerError instanceof Error
              ? providerError.message
              : String(providerError),
          });
        }
        throw providerError;
      }
    }

    const refundTerminal = refundProviderSucceeded(
      attempt.provider,
      providerResponse,
    );
    if (fundedRefundContext) {
      const rawReference = (providerResponse as Record<string, unknown>).id ??
        (providerResponse as Record<string, unknown>).refund_id ??
        (providerResponse as Record<string, unknown>).reference ??
        (providerResponse as Record<string, unknown>).transaction;
      if (
        typeof rawReference !== "string" && typeof rawReference !== "number"
      ) {
        await createOrRefreshOpsIssue(supabase, {
          issueType: "REFUND_FAILED",
          severity: "CRITICAL",
          source: "consultation-post-payout-refund",
          actorRole: input.actorRole,
          orderId: input.orderId,
          title: "Provider refund has no reference to reconcile",
          description:
            "The refund provider returned without a stable refund reference. The claim remains reserved and no second provider request may be sent.",
          recommendedAction:
            "Search the provider by payment intent and the claim metadata; finalize only after matching one refund with certainty.",
          dedupeKey:
            `consultation-post-payout-refund-no-reference:${fundedRefundContext.claimId}`,
          queueKey: "money-desk",
          persistWhenRoutineDisabled: true,
          relatedEntityType: "CONSULTATION_BOOKING",
          relatedEntityId: fundedRefundContext.bookingId,
          metadata: {
            claim_id: fundedRefundContext.claimId,
            payment_id: attempt.id,
          },
        });
        throw new Error(
          "The consultation refund provider response has no stable reference; reconciliation is required.",
        );
      }
      try {
        await recordConsultationPostPayoutRefundProviderResult(supabase, {
          claimId: fundedRefundContext.claimId,
          providerReference: String(rawReference),
          confirmed: refundTerminal,
          providerResponse: providerResponse as Record<string, unknown>,
        });
      } catch (recordError) {
        await requireConsultationPostPayoutRefundReview(supabase, {
          claimId: fundedRefundContext.claimId,
          bookingId: fundedRefundContext.bookingId,
          payment: attempt,
          reason: recordError instanceof Error
            ? recordError.message
            : String(recordError),
        });
        throw recordError;
      }
    }
    if (refundProviderFailed(attempt.provider, providerResponse)) {
      pendingAttempts.push({
        id: attempt.id,
        provider: attempt.provider,
        providerPaymentId,
        providerRefundId: refundProviderId(attempt.provider, providerResponse),
        phase: attempt.phase,
        amount: refundAmount,
        currency: attempt.currency,
        status: "FAILED",
      });
      amountLeft -= refundAmount;
      continue;
    }
    if (!refundTerminal) {
      await recordPendingRefundRequest(supabase, {
        attempt,
        refundAmount,
        providerResponse,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
        exactRestoration: input.exactRestoration,
        operationContext: input.operationContext,
      });
      pendingAttempts.push({
        id: attempt.id,
        provider: attempt.provider,
        providerPaymentId,
        providerRefundId: refundProviderId(attempt.provider, providerResponse),
        phase: attempt.phase,
        amount: refundAmount,
        currency: attempt.currency,
        status: providerResponse.status?.trim().toUpperCase() || "PENDING",
      });
      amountLeft -= refundAmount;
      continue;
    }

    const recorded = await finalizeRefundOnAttempt(supabase, {
      attempt,
      refundAmount,
      providerResponse,
      actorRole: input.actorRole,
      actorId: input.actorId ?? null,
      reason: input.reason ?? null,
      exactRestoration: input.exactRestoration,
    }, deps);

    if (attempt.phase === "CONSULTATION") {
      const rawProviderReference =
        (providerResponse as unknown as Record<string, unknown>).id ??
          (providerResponse as unknown as Record<string, unknown>).refund_id;
      await recordConsultationRefundOutcome(supabase, {
        payment: attempt,
        refundAmount,
        provider: attempt.provider as "STRIPE" | "PAYSTACK" | "BACHS",
        providerReference: typeof rawProviderReference === "string" ||
            typeof rawProviderReference === "number"
          ? String(rawProviderReference)
          : null,
      });
    }

    refundedAttempts.push({
      id: attempt.id,
      provider: attempt.provider,
      providerPaymentId,
      phase: attempt.phase,
      amount: refundAmount,
      currency: attempt.currency,
      remainingRefundableAmount: recorded.remainingRefundableAmount,
      totalRefundedAmount: recorded.totalRefundedAmount,
      partial: recorded.partial,
      providerRefundId: refundProviderReference(providerResponse),
    });

    amountLeft -= refundAmount;
  }

  if (amountLeft > 0) {
    throw new Error(
      "Drapeon could not allocate the requested refund amount safely across the order payments.",
    );
  }

  await audit(supabase, {
    event: "payment.partial_refund_executed",
    actor_id: input.actorId ?? null,
    actor_role: input.actorRole,
    order_id: input.orderId,
    payload: {
      refunded_attempts: refundedAttempts,
      pending_attempts: pendingAttempts,
      already_refunded_attempt_ids: alreadyRefundedAttemptIds,
      requested_amount: input.amount,
      reason: input.reason ?? null,
      allowed_phases: allowedPhases,
    },
  });

  return {
    refundedAttempts,
    pendingAttempts,
    alreadyRefundedAttemptIds,
    totalRefundedAmount: refundedAttempts.reduce(
      (sum, attempt) => sum + attempt.amount,
      0,
    ),
    remainingRefundableAmount: Math.max(
      totalRemainingRefundable - input.amount,
      0,
    ),
  };
}
