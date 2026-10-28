import { bachsAmountMinor } from "./bachs.ts";
import type { BachsConnectEvent } from "./bachs-connect-events.ts";

const ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9_-]+$/u;
const CHARGE_ID_PATTERN = /^ch_[A-Za-z0-9_-]+$/u;
const REFUND_ID_PATTERN = /^rfnd_[A-Za-z0-9_-]+$/u;

export type BachsRefundLifecycleEvent = {
  eventId: string;
  eventType: "refund.created" | "refund.paid" | "refund.failed";
  organizationId: string;
  chargeId: string;
  refundId: string;
  reference: string;
  status: "processing" | "success" | "failed";
  requestedAmount: string;
  refundedAmount: string | null;
};

/** Parse only the documented refund lifecycle fields; amount conversion needs the claim currency. */
export function parseBachsRefundLifecycleEvent(
  event: BachsConnectEvent,
): BachsRefundLifecycleEvent | null {
  if (
    event.type !== "refund.created" && event.type !== "refund.paid" &&
    event.type !== "refund.failed"
  ) return null;

  const data = event.data ?? {};
  const expectedStatus = event.type === "refund.created"
    ? "processing"
    : event.type === "refund.paid"
    ? "success"
    : "failed";
  const organizationId = event.organization_id;
  const chargeId = data.charge_id;
  const refundId = data.refund_id;
  const reference = data.reference;
  const requestedAmount = data.requested_amount;
  const refundedAmount = data.refunded_amount;

  if (
    typeof organizationId !== "string" ||
    !ACCOUNT_ID_PATTERN.test(organizationId) ||
    (event.account !== undefined && event.account !== organizationId) ||
    typeof chargeId !== "string" || !CHARGE_ID_PATTERN.test(chargeId) ||
    typeof refundId !== "string" || !REFUND_ID_PATTERN.test(refundId) ||
    typeof reference !== "string" || reference.length < 1 ||
    reference.length > 128 ||
    /[\u0000-\u001f]/u.test(reference) ||
    typeof requestedAmount !== "string" ||
    (refundedAmount !== null && typeof refundedAmount !== "string") ||
    data.status !== expectedStatus
  ) {
    throw new Error("BACHS_REFUND_EVENT_IDENTITY_INVALID");
  }

  // Validate decimal syntax independent of currency; currency is trusted only
  // from the matched immutable refund claim, never from this webhook payload.
  if (!/^\d+(?:\.\d+)?$/u.test(requestedAmount)) {
    throw new Error("BACHS_REFUND_EVENT_AMOUNT_INVALID");
  }
  if (refundedAmount !== null && !/^\d+(?:\.\d+)?$/u.test(refundedAmount)) {
    throw new Error("BACHS_REFUND_EVENT_AMOUNT_INVALID");
  }
  if (expectedStatus === "success" && refundedAmount === null) {
    throw new Error("BACHS_REFUND_EVENT_AMOUNT_INVALID");
  }

  return {
    eventId: event.id,
    eventType: event.type,
    organizationId,
    chargeId,
    refundId,
    reference,
    status: expectedStatus,
    requestedAmount,
    refundedAmount,
  };
}

export function matchBachsRefundClaim(input: {
  event: BachsRefundLifecycleEvent;
  claim: {
    provider: string;
    provider_refund_id: string | null;
    currency: string;
    refund_amount: number;
  } | null;
  attempt: {
    provider_charge_id: string;
    provider_refund_id: string | null;
    provider_reference: string;
  } | null;
}) {
  const { event, claim, attempt } = input;
  if (!claim) {
    return { matches: false as const, reason: "refund_claim_not_found" };
  }
  if (!attempt) {
    return { matches: false as const, reason: "refund_attempt_not_found" };
  }
  if (claim.provider !== "BACHS") {
    return {
      matches: false as const,
      reason: "refund_claim_provider_mismatch",
    };
  }
  if (attempt.provider_charge_id !== event.chargeId) {
    return { matches: false as const, reason: "refund_charge_mismatch" };
  }
  if (attempt.provider_reference !== event.reference) {
    return { matches: false as const, reason: "refund_reference_mismatch" };
  }
  if (
    (claim.provider_refund_id && claim.provider_refund_id !== event.refundId) ||
    (attempt.provider_refund_id &&
      attempt.provider_refund_id !== event.refundId)
  ) {
    return { matches: false as const, reason: "refund_id_mismatch" };
  }

  try {
    if (
      bachsAmountMinor(event.requestedAmount, claim.currency) !==
        claim.refund_amount
    ) {
      return {
        matches: false as const,
        reason: "refund_requested_amount_mismatch",
      };
    }
    if (
      event.status === "success" &&
      (event.refundedAmount === null ||
        bachsAmountMinor(event.refundedAmount, claim.currency) !==
          claim.refund_amount)
    ) {
      return { matches: false as const, reason: "refund_paid_amount_mismatch" };
    }
  } catch {
    return {
      matches: false as const,
      reason: "refund_amount_invalid_for_claim_currency",
    };
  }

  return { matches: true as const, reason: null };
}
