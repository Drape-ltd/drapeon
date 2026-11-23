import { bachsAmountMinor } from "./bachs.ts";
import type { BachsConnectEvent } from "./bachs-connect-events.ts";

const ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9_-]+$/u;
const CHARGE_ID_PATTERN = /^ch_[A-Za-z0-9_-]+$/u;
const DISPUTE_ID_PATTERN = /^dsp_[A-Za-z0-9_-]+$/u;

export type BachsDisputeStatus =
  | "NEEDS_RESPONSE"
  | "UNDER_REVIEW"
  | "WON"
  | "LOST"
  | "UNKNOWN";

export type BachsDisputeLifecycleEvent = {
  eventId: string;
  eventType: "dispute.created" | "dispute.updated";
  organizationId: string;
  disputeId: string;
  chargeId: string;
  disputedAmountMinor: number;
  chargeAmountMinor: number;
  currency: string;
  status: BachsDisputeStatus;
  rawStatus: string;
  reason: string | null;
  responseEditable: boolean;
  responseDeadlineAt: string | null;
  providerUpdatedAt: string;
};

export type BachsDisputePaymentSnapshot = {
  provider: string;
  provider_charge_id: string | null;
  amount: number;
  currency: string;
};

/** The dispute amount may be partial; the dispute's full-charge snapshot must not be. */
export function matchBachsDisputePayment(
  event: BachsDisputeLifecycleEvent,
  payment: BachsDisputePaymentSnapshot | null,
): boolean {
  return !!payment && payment.provider === "BACHS" &&
    payment.provider_charge_id === event.chargeId &&
    payment.currency.toUpperCase() === event.currency &&
    Number.isSafeInteger(payment.amount) && payment.amount > 0 &&
    payment.amount === event.chargeAmountMinor &&
    event.disputedAmountMinor <= payment.amount;
}

export type BachsDisputeEventOrder =
  | "APPLY"
  | "DUPLICATE"
  | "STALE"
  | "CONFLICT";

/** Pure chronology check; the database write must serialize this decision per dispute. */
export function compareBachsDisputeEventOrder(input: {
  incomingAt: string;
  incomingStatus: BachsDisputeStatus;
  previousAt: string | null;
  previousStatus: string | null;
}): BachsDisputeEventOrder {
  if (!input.previousAt || !input.previousStatus) return "APPLY";
  const incoming = Date.parse(input.incomingAt);
  const previous = Date.parse(input.previousAt);
  if (!Number.isFinite(incoming) || !Number.isFinite(previous)) {
    return "CONFLICT";
  }
  if (incoming < previous) return "STALE";
  if (incoming > previous) return "APPLY";
  return input.incomingStatus === input.previousStatus
    ? "DUPLICATE"
    : "CONFLICT";
}

function mapStatus(status: string): BachsDisputeStatus {
  switch (status) {
    case "needs_response":
      return "NEEDS_RESPONSE";
    case "under_review":
      return "UNDER_REVIEW";
    case "won":
      return "WON";
    case "lost":
      return "LOST";
    default:
      // `closed` and `prevented` do not carry enough information to release
      // order money safely; an explicit future mapping needs provider evidence.
      return "UNKNOWN";
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Parse signed Bachs disputes while retaining the disputed amount separately from the full charge. */
export function parseBachsDisputeLifecycleEvent(
  event: BachsConnectEvent,
): BachsDisputeLifecycleEvent | null {
  if (event.type !== "dispute.created" && event.type !== "dispute.updated") {
    return null;
  }
  const data = event.data ?? {};
  const organizationId = event.organization_id;
  const disputeId = data.dispute_id;
  const chargeId = data.charge_id;
  const disputedAmount = data.amount;
  const disputeCurrency = typeof data.currency === "string"
    ? data.currency.toUpperCase()
    : "";
  const rawStatus = data.status;
  const chargeAmount = data.charge_amount;
  const chargeCurrency = typeof data.charge_currency === "string"
    ? data.charge_currency.toUpperCase()
    : "";
  const providerUpdatedAt = validTimestamp(data.updated_at)
    ? data.updated_at
    : event.created_at;

  if (
    typeof organizationId !== "string" ||
    !ACCOUNT_ID_PATTERN.test(organizationId) ||
    (event.account !== undefined && event.account !== organizationId) ||
    typeof disputeId !== "string" || !DISPUTE_ID_PATTERN.test(disputeId) ||
    typeof chargeId !== "string" || !CHARGE_ID_PATTERN.test(chargeId) ||
    typeof disputedAmount !== "string" ||
    typeof chargeAmount !== "string" ||
    !/^[A-Z]{3}$/u.test(disputeCurrency) ||
    !/^[A-Z]{3}$/u.test(chargeCurrency) ||
    disputeCurrency !== chargeCurrency ||
    typeof rawStatus !== "string" || rawStatus.length === 0 ||
    rawStatus.length > 80 ||
    typeof data.is_response_editable !== "boolean" ||
    (data.reason !== null && data.reason !== undefined &&
      typeof data.reason !== "string") ||
    (data.response_deadline_at !== null &&
      data.response_deadline_at !== undefined &&
      !validTimestamp(data.response_deadline_at)) ||
    !validTimestamp(providerUpdatedAt)
  ) {
    throw new Error("BACHS_DISPUTE_EVENT_IDENTITY_INVALID");
  }

  let disputedAmountMinor: number;
  let chargeAmountMinor: number;
  try {
    disputedAmountMinor = bachsAmountMinor(disputedAmount, disputeCurrency);
    chargeAmountMinor = bachsAmountMinor(chargeAmount, chargeCurrency);
  } catch {
    throw new Error("BACHS_DISPUTE_EVENT_AMOUNT_INVALID");
  }
  if (
    !Number.isSafeInteger(disputedAmountMinor) || disputedAmountMinor <= 0 ||
    !Number.isSafeInteger(chargeAmountMinor) || chargeAmountMinor <= 0 ||
    disputedAmountMinor > chargeAmountMinor
  ) {
    throw new Error("BACHS_DISPUTE_EVENT_AMOUNT_INVALID");
  }

  return {
    eventId: event.id,
    eventType: event.type,
    organizationId,
    disputeId,
    chargeId,
    disputedAmountMinor,
    chargeAmountMinor,
    currency: disputeCurrency,
    status: mapStatus(rawStatus),
    rawStatus,
    reason: typeof data.reason === "string" ? data.reason.slice(0, 120) : null,
    responseEditable: data.is_response_editable,
    responseDeadlineAt: validTimestamp(data.response_deadline_at)
      ? new Date(data.response_deadline_at).toISOString()
      : null,
    providerUpdatedAt: new Date(providerUpdatedAt).toISOString(),
  };
}
