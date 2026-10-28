import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type BachsDisputeLifecycleEvent,
  compareBachsDisputeEventOrder,
  matchBachsDisputePayment,
  parseBachsDisputeLifecycleEvent,
} from "./bachs-dispute-events.ts";
import type { BachsConnectEvent } from "./bachs-connect-events.ts";

function event(overrides: Record<string, unknown> = {}): BachsConnectEvent {
  return {
    id: "evt_dispute1",
    type: "dispute.created",
    created_at: "2026-10-28T00:00:00.000Z",
    organization_id: "acct_platform1",
    data: {
      dispute_id: "dsp_case1",
      charge_id: "ch_charge1",
      amount: "250.00",
      currency: "NGN",
      status: "needs_response",
      is_response_editable: true,
      reason: "fraudulent",
      response_deadline_at: "2026-11-02T00:00:00.000Z",
      updated_at: "2026-10-28T00:00:00.000Z",
      charge_amount: "1000.00",
      charge_currency: "NGN",
      ...overrides,
    },
  };
}

Deno.test("Bachs dispute parser keeps partial disputed amount distinct from charge amount", () => {
  const parsed = parseBachsDisputeLifecycleEvent(event());
  assertEquals(parsed?.disputedAmountMinor, 25000);
  assertEquals(parsed?.chargeAmountMinor, 100000);
  assertEquals(parsed?.status, "NEEDS_RESPONSE");
  assertEquals(parsed?.responseEditable, true);
  assertEquals(parsed?.responseDeadlineAt, "2026-11-02T00:00:00.000Z");
});

Deno.test("Bachs dispute parser maps only documented response and terminal outcomes", () => {
  const cases: Array<[string, BachsDisputeLifecycleEvent["status"]]> = [
    ["under_review", "UNDER_REVIEW"],
    ["won", "WON"],
    ["lost", "LOST"],
    ["closed", "UNKNOWN"],
    ["prevented", "UNKNOWN"],
  ];
  for (const [rawStatus, status] of cases) {
    assertEquals(
      parseBachsDisputeLifecycleEvent(event({ status: rawStatus }))?.status,
      status,
    );
  }
});

Deno.test("Bachs dispute matching accepts partial disputes only against the exact full charge", () => {
  const parsed = parseBachsDisputeLifecycleEvent(event());
  if (!parsed) throw new Error("Expected dispute event.");
  assertEquals(
    matchBachsDisputePayment(parsed, {
      provider: "BACHS",
      provider_charge_id: "ch_charge1",
      amount: 100000,
      currency: "NGN",
    }),
    true,
  );
  assertEquals(
    matchBachsDisputePayment(parsed, {
      provider: "BACHS",
      provider_charge_id: "ch_charge1",
      amount: 99999,
      currency: "NGN",
    }),
    false,
  );
  assertEquals(
    matchBachsDisputePayment(parsed, {
      provider: "BACHS",
      provider_charge_id: "ch_other",
      amount: 100000,
      currency: "NGN",
    }),
    false,
  );
});

Deno.test("Bachs dispute event chronology never lets a stale terminal event win", () => {
  assertEquals(
    compareBachsDisputeEventOrder({
      incomingAt: "2026-10-28T00:00:00Z",
      incomingStatus: "NEEDS_RESPONSE",
      previousAt: "2026-10-29T00:00:00Z",
      previousStatus: "WON",
    }),
    "STALE",
  );
  assertEquals(
    compareBachsDisputeEventOrder({
      incomingAt: "2026-10-29T00:00:00Z",
      incomingStatus: "UNDER_REVIEW",
      previousAt: "2026-10-29T00:00:00Z",
      previousStatus: "WON",
    }),
    "CONFLICT",
  );
  assertEquals(
    compareBachsDisputeEventOrder({
      incomingAt: "2026-10-30T00:00:00Z",
      incomingStatus: "WON",
      previousAt: "2026-10-29T00:00:00Z",
      previousStatus: "UNDER_REVIEW",
    }),
    "APPLY",
  );
});

Deno.test("Bachs dispute parser rejects account, currency, and amount mismatches", () => {
  assertThrows(
    () =>
      parseBachsDisputeLifecycleEvent({ ...event(), account: "acct_other" }),
    Error,
    "BACHS_DISPUTE_EVENT_IDENTITY_INVALID",
  );
  assertThrows(
    () => parseBachsDisputeLifecycleEvent(event({ charge_currency: "USD" })),
    Error,
    "BACHS_DISPUTE_EVENT_IDENTITY_INVALID",
  );
  assertThrows(
    () => parseBachsDisputeLifecycleEvent(event({ amount: "1000.01" })),
    Error,
    "BACHS_DISPUTE_EVENT_AMOUNT_INVALID",
  );
});

Deno.test("Bachs dispute parser ignores unrelated event types", () => {
  assertEquals(
    parseBachsDisputeLifecycleEvent({ ...event(), type: "refund.created" }),
    null,
  );
});
