import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bachsAmountMinor, BachsRequestError } from "./bachs.ts";
import {
  type BachsRefund,
  createBachsRefund,
  getBachsRefundByCharge,
} from "./bachs-operations.ts";
import { createOrRefreshOpsIssue } from "./ops-issues.ts";

type BachsClient = Parameters<typeof createBachsRefund>[0];

export type BachsRefundClaimPayment = {
  id: string;
  order_id: string;
  phase: string;
  currency: string;
  amount: number;
  refunded_amount?: number | null;
  provider_payment_id: string;
  provider_charge_id: string;
};

export type BachsRefundAttempt = {
  id: string;
  refund_claim_id: string;
  attempt_number: number;
  provider_reference: string;
  idempotency_key: string;
  provider_charge_id: string;
  provider_refund_id: string | null;
  status:
    | "RESERVED"
    | "PROVIDER_UNKNOWN"
    | "PROVIDER_PENDING"
    | "SUCCEEDED"
    | "FAILED_RECONCILED";
  created_at: string;
};

export type BachsRefundClaimResult = {
  status: "SUCCEEDED" | "PENDING" | "FAILED" | "OPS_REVIEW";
  response?: BachsRefund;
  claimId: string | null;
  attemptId: string | null;
  lateSuccess?: boolean;
};

function resultObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rpcOutcome(value: unknown) {
  return typeof resultObject(value).outcome === "string"
    ? String(resultObject(value).outcome)
    : "";
}

function isNotFound(error: unknown): error is BachsRequestError {
  return error instanceof BachsRequestError && error.status === 404 &&
    error.code === "NOT_FOUND";
}

function statusForProvider(
  status: BachsRefund["status"],
): BachsRefundClaimResult["status"] {
  return status === "success"
    ? "SUCCEEDED"
    : status === "failed"
    ? "FAILED"
    : "PENDING";
}

function sameRefund(
  response: BachsRefund,
  payment: BachsRefundClaimPayment,
  attempt: BachsRefundAttempt,
  refundAmount: number,
) {
  try {
    return response.charge_id === payment.provider_charge_id &&
      response.reference === attempt.provider_reference &&
      (!attempt.provider_refund_id ||
        attempt.provider_refund_id === response.refund_id) &&
      bachsAmountMinor(response.requested_amount, payment.currency) ===
        refundAmount;
  } catch {
    return false;
  }
}

async function recordAttempt(
  supabase: SupabaseClient,
  input: {
    attemptId: string;
    status:
      | "PROVIDER_UNKNOWN"
      | "PROVIDER_PENDING"
      | "SUCCEEDED"
      | "FAILED_RECONCILED";
    refundId?: string | null;
    evidence: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc(
    "record_bachs_payment_refund_attempt_outcome",
    {
      p_attempt_id: input.attemptId,
      p_next_status: input.status,
      p_provider_refund_id: input.refundId ?? null,
      p_provider_evidence: input.evidence,
    },
  );
  if (error) throw error;
  const result = resultObject(data);
  const outcome = rpcOutcome(data);
  if (!["RECORDED", "EXISTING", "LATE_SUCCESS"].includes(outcome)) {
    return { outcome, result };
  }
  return { outcome, result };
}

async function openReview(
  supabase: SupabaseClient,
  payment: BachsRefundClaimPayment,
  claimId: string | null,
  attemptId: string | null,
  reason: string,
) {
  await createOrRefreshOpsIssue(supabase, {
    issueType: "REFUND_FAILED",
    severity: "CRITICAL",
    source: "bachs-refund-claims",
    actorRole: "SYSTEM",
    orderId: payment.order_id,
    provider: "BACHS",
    title: "Bachs refund needs reconciliation",
    description:
      `A Bachs refund could not be safely completed or reconciled (${reason}). No second refund was sent.`,
    recommendedAction:
      "Inspect the refund claim, its fixed provider reference, the Bachs refund-by-charge result and available platform balance. Retry only after a confirmed terminal failure and explicit Ops review.",
    dedupeKey: `bachs-refund-review:${claimId ?? payment.id}`,
    queueKey: "money-desk",
    persistWhenRoutineDisabled: true,
    relatedEntityType: "order_payment",
    relatedEntityId: payment.id,
    metadata: {
      payment_id: payment.id,
      refund_claim_id: claimId,
      refund_attempt_id: attemptId,
      safe_reason: reason.slice(0, 300),
    },
  });
}

/** Reserves the business claim before provider I/O and never blindly resubmits an unknown refund. */
export async function requestBachsRefund(input: {
  supabase: SupabaseClient;
  client: BachsClient;
  payment: BachsRefundClaimPayment;
  refundAmount: number;
  reason?: string | null;
  operationScope?: string | null;
  deps?: {
    createRefund?: typeof createBachsRefund;
    getRefundByCharge?: typeof getBachsRefundByCharge;
    now?: () => Date;
  };
}): Promise<BachsRefundClaimResult> {
  const { supabase, payment, refundAmount } = input;
  const now = input.deps?.now ?? (() => new Date());
  if (!payment.provider_charge_id?.startsWith("ch_")) {
    await openReview(
      supabase,
      payment,
      null,
      null,
      "settled_charge_id_missing",
    );
    return { status: "OPS_REVIEW", claimId: null, attemptId: null };
  }
  const refundedBefore = Math.max(
    0,
    Math.min(payment.refunded_amount ?? 0, payment.amount),
  );
  const scope = input.operationScope?.trim() || "standard";
  if (scope.length > 120 || /[\u0000-\u001f]/u.test(scope)) {
    await openReview(
      supabase,
      payment,
      null,
      null,
      "refund_operation_scope_invalid",
    );
    return { status: "OPS_REVIEW", claimId: null, attemptId: null };
  }
  const operationKey =
    `bachs-refund:${payment.id}:${refundedBefore}:${refundAmount}:${scope}`;
  const { data: claimData, error: claimError } = await supabase.rpc(
    "reserve_order_payment_refund_claim",
    {
      p_payment_id: payment.id,
      p_order_id: payment.order_id,
      p_phase: payment.phase,
      p_provider: "BACHS",
      p_provider_payment_id: payment.provider_payment_id,
      p_operation_key: operationKey,
      p_refund_amount: refundAmount,
    },
  );
  if (claimError) throw claimError;
  const claim = resultObject(claimData);
  const claimOutcome = rpcOutcome(claimData);
  if (
    !["RESERVED", "EXISTING"].includes(claimOutcome) ||
    typeof claim.claim_id !== "string"
  ) {
    await openReview(
      supabase,
      payment,
      typeof claim.claim_id === "string" ? claim.claim_id : null,
      null,
      `claim_${claimOutcome || "invalid"}`,
    );
    return { status: "OPS_REVIEW", claimId: null, attemptId: null };
  }
  const claimId = claim.claim_id;

  const { data: rows, error: rowsError } = await supabase.from(
    "order_payment_refund_attempts",
  )
    .select(
      "id,refund_claim_id,attempt_number,provider_reference,idempotency_key,provider_charge_id,provider_refund_id,status,created_at",
    )
    .eq("refund_claim_id", claimId).order("attempt_number", {
      ascending: true,
    });
  if (rowsError) throw rowsError;
  const priorAttempts =
    (Array.isArray(rows) ? rows : []) as BachsRefundAttempt[];

  let existingRefund: BachsRefund | null = null;
  try {
    existingRefund =
      await (input.deps?.getRefundByCharge ?? getBachsRefundByCharge)(
        input.client,
        payment.provider_charge_id,
      );
  } catch (error) {
    if (!isNotFound(error)) {
      const active = [...priorAttempts].reverse().find((row) =>
        ["RESERVED", "PROVIDER_UNKNOWN", "PROVIDER_PENDING"].includes(
          row.status,
        )
      );
      if (active && active.status !== "PROVIDER_PENDING") {
        await recordAttempt(supabase, {
          attemptId: active.id,
          status: "PROVIDER_UNKNOWN",
          refundId: active.provider_refund_id,
          evidence: { lookup_failed: true },
        });
      }
      await openReview(
        supabase,
        payment,
        claimId,
        active?.id ?? null,
        error instanceof BachsRequestError
          ? `lookup_${error.status ?? "unknown"}_${error.code ?? "error"}`
          : "refund_lookup_failed",
      );
      return { status: "OPS_REVIEW", claimId, attemptId: active?.id ?? null };
    }
  }

  if (existingRefund) {
    const matchingAttempt = priorAttempts.find((row) =>
      row.provider_reference === existingRefund!.reference
    );
    if (
      !matchingAttempt ||
      !sameRefund(existingRefund, payment, matchingAttempt, refundAmount)
    ) {
      await openReview(
        supabase,
        payment,
        claimId,
        matchingAttempt?.id ?? null,
        "provider_refund_does_not_match_reserved_attempt",
      );
      return {
        status: "OPS_REVIEW",
        response: existingRefund,
        claimId,
        attemptId: matchingAttempt?.id ?? null,
      };
    }
    const providerStatus = statusForProvider(existingRefund.status);
    const recorded = await recordAttempt(supabase, {
      attemptId: matchingAttempt.id,
      status: providerStatus === "SUCCEEDED"
        ? "SUCCEEDED"
        : providerStatus === "FAILED"
        ? "FAILED_RECONCILED"
        : "PROVIDER_PENDING",
      refundId: existingRefund.refund_id,
      evidence: {
        source: "refund_by_charge_lookup",
        refund_id: existingRefund.refund_id,
        status: existingRefund.status,
      },
    });
    if (recorded.outcome === "SECOND_SUCCESS_NEEDS_OPS") {
      await openReview(
        supabase,
        payment,
        claimId,
        matchingAttempt.id,
        "second_provider_refund_succeeded",
      );
      return {
        status: "OPS_REVIEW",
        response: existingRefund,
        claimId,
        attemptId: matchingAttempt.id,
      };
    }
    if (recorded.outcome === "LATE_SUCCESS") {
      await openReview(
        supabase,
        payment,
        claimId,
        matchingAttempt.id,
        "late_provider_refund_success_after_failure",
      );
    }
    if (providerStatus !== "FAILED") {
      return {
        status: providerStatus,
        response: existingRefund,
        claimId,
        attemptId: matchingAttempt.id,
        lateSuccess: recorded.outcome === "LATE_SUCCESS",
      };
    }
    await openReview(
      supabase,
      payment,
      claimId,
      matchingAttempt.id,
      "provider_confirmed_refund_failure",
    );
    return {
      status: "FAILED",
      response: existingRefund,
      claimId,
      attemptId: matchingAttempt.id,
    };
  }

  const latest = priorAttempts.at(-1);
  if (latest?.status === "FAILED_RECONCILED") {
    // Automatic cancellation/job retries must not create a fresh provider
    // operation after a terminal refusal. A reviewed retry is a later brick.
    await openReview(
      supabase,
      payment,
      claimId,
      latest.id,
      "terminal_failure_requires_reviewed_retry",
    );
    return { status: "FAILED", claimId, attemptId: latest.id };
  }

  const { data: attemptData, error: attemptError } = await supabase.rpc(
    "reserve_bachs_payment_refund_attempt",
    { p_claim_id: claimId },
  );
  if (attemptError) throw attemptError;
  const reserved = resultObject(attemptData);
  const attemptOutcome = rpcOutcome(attemptData);
  if (
    !["RESERVED", "EXISTING"].includes(attemptOutcome) ||
    typeof reserved.attempt_id !== "string"
  ) {
    await openReview(
      supabase,
      payment,
      claimId,
      typeof reserved.attempt_id === "string" ? reserved.attempt_id : null,
      `attempt_${attemptOutcome || "invalid"}`,
    );
    return { status: "OPS_REVIEW", claimId, attemptId: null };
  }
  const attemptId = reserved.attempt_id;
  const { data: attemptRow, error: attemptRowError } = await supabase.from(
    "order_payment_refund_attempts",
  )
    .select(
      "id,refund_claim_id,attempt_number,provider_reference,idempotency_key,provider_charge_id,provider_refund_id,status,created_at",
    )
    .eq("id", attemptId).maybeSingle();
  if (attemptRowError) throw attemptRowError;
  const attempt = attemptRow as BachsRefundAttempt | null;
  if (!attempt || attempt.provider_charge_id !== payment.provider_charge_id) {
    await openReview(
      supabase,
      payment,
      claimId,
      attemptId,
      "reserved_attempt_charge_identity_mismatch",
    );
    return { status: "OPS_REVIEW", claimId, attemptId };
  }
  if (attempt.status === "PROVIDER_PENDING") {
    await openReview(
      supabase,
      payment,
      claimId,
      attemptId,
      "provider_pending_but_refund_lookup_missing",
    );
    return { status: "OPS_REVIEW", claimId, attemptId };
  }
  const ageMs = now().getTime() - Date.parse(attempt.created_at);
  if (
    attempt.status !== "RESERVED" &&
    (!Number.isFinite(ageMs) || ageMs > 23 * 60 * 60 * 1000)
  ) {
    await recordAttempt(supabase, {
      attemptId,
      status: "PROVIDER_UNKNOWN",
      refundId: attempt.provider_refund_id,
      evidence: {
        lookup_result: "not_found",
        provider_idempotency_window_expired: true,
      },
    });
    await openReview(
      supabase,
      payment,
      claimId,
      attemptId,
      "provider_outcome_unknown_beyond_safe_retry_window",
    );
    return { status: "OPS_REVIEW", claimId, attemptId };
  }

  // Mark the side effect as potentially started before calling Bachs. A crash
  // can then only recover by querying by-charge and reusing this fixed key.
  const started = await recordAttempt(supabase, {
    attemptId,
    status: "PROVIDER_UNKNOWN",
    refundId: attempt.provider_refund_id,
    evidence: {
      provider_call_started_at: now().toISOString(),
      prior_refund_lookup: "not_found",
    },
  });
  if (!["RECORDED", "EXISTING"].includes(started.outcome)) {
    await openReview(
      supabase,
      payment,
      claimId,
      attemptId,
      `attempt_start_${started.outcome}`,
    );
    return { status: "OPS_REVIEW", claimId, attemptId };
  }

  let response: BachsRefund;
  try {
    response = await (input.deps?.createRefund ?? createBachsRefund)(
      input.client,
      {
        chargeId: payment.provider_charge_id,
        amountMinor: refundAmount,
        currency: payment.currency,
        reference: attempt.provider_reference,
        idempotencyKey: attempt.idempotency_key,
        reason: input.reason,
      },
    );
  } catch (error) {
    if (
      error instanceof BachsRequestError && !error.uncertainWrite &&
      error.status !== null && error.status >= 400 && error.status < 500
    ) {
      await recordAttempt(supabase, {
        attemptId,
        status: "FAILED_RECONCILED",
        refundId: null,
        evidence: {
          rejected_status: error.status,
          rejected_code: error.code,
          request_id: error.requestId,
        },
      });
      await openReview(
        supabase,
        payment,
        claimId,
        attemptId,
        `provider_rejected_${error.status}_${error.code ?? "request"}`,
      );
      return { status: "FAILED", claimId, attemptId };
    }
    // The provider may have accepted the write. Recover by charge and exact
    // reference; never issue a new request after an uncertain outcome.
    try {
      const recovered =
        await (input.deps?.getRefundByCharge ?? getBachsRefundByCharge)(
          input.client,
          payment.provider_charge_id,
        );
      if (sameRefund(recovered, payment, attempt, refundAmount)) {
        response = recovered;
      } else {
        await openReview(
          supabase,
          payment,
          claimId,
          attemptId,
          "uncertain_write_lookup_identity_mismatch",
        );
        return {
          status: "OPS_REVIEW",
          response: recovered,
          claimId,
          attemptId,
        };
      }
    } catch {
      await openReview(
        supabase,
        payment,
        claimId,
        attemptId,
        "uncertain_write_requires_webhook_or_manual_reconciliation",
      );
      return { status: "OPS_REVIEW", claimId, attemptId };
    }
  }

  const providerStatus = statusForProvider(response.status);
  let recorded: Awaited<ReturnType<typeof recordAttempt>>;
  try {
    recorded = await recordAttempt(supabase, {
      attemptId,
      status: providerStatus === "SUCCEEDED"
        ? "SUCCEEDED"
        : providerStatus === "FAILED"
        ? "FAILED_RECONCILED"
        : "PROVIDER_PENDING",
      refundId: response.refund_id,
      evidence: {
        refund_id: response.refund_id,
        status: response.status,
        source: "provider_response",
      },
    });
  } catch {
    // The provider may already have moved money. The attempt was committed as
    // PROVIDER_UNKNOWN before the POST, so later recovery must query by-charge.
    await openReview(
      supabase,
      payment,
      claimId,
      attemptId,
      "provider_response_received_but_not_saved",
    );
    return { status: "OPS_REVIEW", response, claimId, attemptId };
  }
  if (recorded.outcome === "SECOND_SUCCESS_NEEDS_OPS") {
    await openReview(
      supabase,
      payment,
      claimId,
      attemptId,
      "second_provider_refund_succeeded",
    );
    return { status: "OPS_REVIEW", response, claimId, attemptId };
  }
  if (!["RECORDED", "EXISTING", "LATE_SUCCESS"].includes(recorded.outcome)) {
    await openReview(
      supabase,
      payment,
      claimId,
      attemptId,
      `provider_result_${recorded.outcome}`,
    );
    return { status: "OPS_REVIEW", response, claimId, attemptId };
  }
  if (recorded.outcome === "LATE_SUCCESS") {
    await openReview(
      supabase,
      payment,
      claimId,
      attemptId,
      "late_provider_refund_success_after_failure",
    );
  }
  if (providerStatus === "FAILED") {
    await openReview(
      supabase,
      payment,
      claimId,
      attemptId,
      "provider_confirmed_refund_failure",
    );
  }
  return {
    status: providerStatus,
    response,
    claimId,
    attemptId,
    lateSuccess: recorded.outcome === "LATE_SUCCESS",
  };
}
