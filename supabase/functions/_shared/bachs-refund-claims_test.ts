import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BachsRequestError } from "./bachs.ts";
import {
  type BachsRefundAttempt,
  requestBachsRefund,
} from "./bachs-refund-claims.ts";

function makeFixture(options: { failSuccessfulAttemptRecord?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const attemptRows: BachsRefundAttempt[] = [];
  let claimStatus = "RESERVED";
  let failedSuccessfulAttemptRecord = false;
  const supabase = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "current_ops_environment") {
        return { data: "DEVELOPMENT", error: null };
      }
      if (name === "reserve_order_payment_refund_claim") {
        return {
          data: {
            outcome: claimStatus === "RESERVED" ? "RESERVED" : "EXISTING",
            claim_id: "claim-1",
          },
          error: null,
        };
      }
      if (name === "reserve_bachs_payment_refund_attempt") {
        let row = attemptRows.at(-1);
        if (!row || row.status === "FAILED_RECONCILED") {
          row = {
            id: `attempt-${attemptRows.length + 1}`,
            refund_claim_id: "claim-1",
            attempt_number: attemptRows.length + 1,
            provider_reference: `refund_claim1_${attemptRows.length + 1}`,
            idempotency_key: `drapeon-refund:claim1:${attemptRows.length + 1}`,
            provider_charge_id: "ch_test1",
            provider_refund_id: null,
            status: "RESERVED",
            created_at: "2026-10-28T04:00:00.000Z",
          };
          attemptRows.push(row);
        }
        return {
          data: {
            outcome: row.status === "RESERVED" ? "RESERVED" : "EXISTING",
            attempt_id: row.id,
          },
          error: null,
        };
      }
      if (name === "record_bachs_payment_refund_attempt_outcome") {
        if (
          options.failSuccessfulAttemptRecord &&
          args.p_next_status === "SUCCEEDED" &&
          !failedSuccessfulAttemptRecord
        ) {
          failedSuccessfulAttemptRecord = true;
          return {
            data: null,
            error: new Error("simulated persistence failure"),
          };
        }
        const row = attemptRows.find((item) => item.id === args.p_attempt_id)!;
        row.status = String(args.p_next_status) as BachsRefundAttempt["status"];
        row.provider_refund_id = typeof args.p_provider_refund_id === "string"
          ? args.p_provider_refund_id
          : null;
        if (row.status === "SUCCEEDED") claimStatus = "SUCCEEDED";
        return {
          data: { outcome: "RECORDED", attempt_id: row.id, status: row.status },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: string) {
      if (table === "ops_issues") {
        const query: any = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
          insert() {
            return query;
          },
          single() {
            return Promise.resolve({
              data: {
                id: "ops-issue-1",
                issue_number: 1,
                case_number: "OPS-DEV-1",
              },
              error: null,
            });
          },
        };
        return query;
      }
      if (table === "ops_audit_logs") {
        return { insert: async () => ({ data: null, error: null }) };
      }
      if (table !== "order_payment_refund_attempts") {
        throw new Error(`Unexpected table ${table}`);
      }
      const filters: Record<string, unknown> = {};
      const query: any = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        order() {
          return Promise.resolve({
            data: attemptRows.filter((row) =>
              row.refund_claim_id === filters.refund_claim_id
            ),
            error: null,
          });
        },
        maybeSingle() {
          return Promise.resolve({
            data: attemptRows.find((row) => row.id === filters.id) ?? null,
            error: null,
          });
        },
      };
      return query;
    },
  };
  return { supabase, calls, attemptRows };
}

const payment = {
  id: "payment-1",
  order_id: "order-1",
  phase: "INITIAL_ORDER",
  currency: "NGN",
  amount: 5000,
  refunded_amount: 0,
  provider_payment_id: "chk_test1",
  provider_charge_id: "ch_test1",
};
const refund = {
  refund_id: "rfnd_test1",
  charge_id: "ch_test1",
  reference: "refund_claim1_1",
  status: "success" as const,
  requested_amount: "50.00",
  refunded_amount: "50.00",
};

const failedRefund = {
  ...refund,
  refund_id: 'rfnd_failed1',
  status: 'failed' as const,
}

function makeReviewedRetryFixture() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const attemptRows: BachsRefundAttempt[] = [
    {
      id: 'attempt-1',
      refund_claim_id: 'claim-1',
      attempt_number: 1,
      provider_reference: 'refund_claim1_1',
      idempotency_key: 'drapeon-refund:claim1:1',
      provider_charge_id: 'ch_test1',
      provider_refund_id: failedRefund.refund_id,
      status: 'FAILED_RECONCILED',
      created_at: '2026-10-28T03:00:00.000Z',
    },
  ]
  let claimStatus = 'FAILED_RECONCILED'
  const claim = {
    id: 'claim-1',
    payment_id: 'payment-1',
    order_id: 'order-1',
    phase: 'INITIAL_ORDER',
    provider: 'BACHS',
    currency: 'NGN',
    refunded_before: 0,
    refund_amount: 5000,
    provider_payment_id: 'chk_test1',
    status: claimStatus,
  }
  const moneyDeskRequest = {
    id: 'md-request-1',
    action_type: 'CUSTOMER_REFUND',
    target_type: 'BACHS_REFUND_RETRY',
    target_id: 'claim-1',
    order_id: 'order-1',
    amount: 5000,
    currency: 'NGN',
    status: 'EXECUTING',
    approved_at: '2026-10-28T04:00:00.000Z',
    approval_count: 2,
    required_approval_count: 2,
    action_payload: {
      refundClaimId: 'claim-1',
      failedAttemptId: 'attempt-1',
      paymentId: 'payment-1',
    },
  }
  const supabase = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      if (name === 'current_ops_environment') {
        return { data: 'DEVELOPMENT', error: null }
      }
      if (name === 'record_bachs_payment_refund_attempt_outcome') {
        const row = attemptRows.find((item) => item.id === args.p_attempt_id)!
        row.status = String(args.p_next_status) as BachsRefundAttempt['status']
        row.provider_refund_id =
          typeof args.p_provider_refund_id === 'string'
            ? args.p_provider_refund_id
            : row.provider_refund_id
        if (args.p_next_status === 'SUCCEEDED') claimStatus = 'SUCCEEDED'
        return {
          data: { outcome: 'RECORDED', attempt_id: row.id, status: row.status },
          error: null,
        }
      }
      if (name === 'reserve_bachs_payment_refund_retry_attempt') {
        const requestId = String(args.p_money_desk_request_id)
        let row = attemptRows.find((item) => item.money_desk_request_id === requestId)
        if (!row) {
          const prior = attemptRows.find((item) => item.id === args.p_failed_attempt_id)
          if (claimStatus !== 'FAILED_RECONCILED' || prior?.status !== 'FAILED_RECONCILED') {
            return {
              data: { outcome: 'FAILED_ATTEMPT_NOT_RECONCILED' },
              error: null,
            }
          }
          row = {
            id: 'attempt-2',
            refund_claim_id: 'claim-1',
            attempt_number: 2,
            provider_reference: 'refund_claim1_2',
            idempotency_key: 'drapeon-refund:claim1:2',
            provider_charge_id: 'ch_test1',
            provider_refund_id: null,
            money_desk_request_id: requestId,
            reviewed_retry_of_attempt_id: String(args.p_failed_attempt_id),
            status: 'RESERVED',
            created_at: '2026-10-28T04:10:00.000Z',
          }
          attemptRows.push(row)
          return {
            data: {
              outcome: 'RESERVED',
              attempt_id: row.id,
              provider_reference: row.provider_reference,
              idempotency_key: row.idempotency_key,
            },
            error: null,
          }
        }
        return {
          data: {
            outcome: 'EXISTING',
            attempt_id: row.id,
            provider_reference: row.provider_reference,
            idempotency_key: row.idempotency_key,
          },
          error: null,
        }
      }
      throw new Error(`Unexpected RPC ${name}`)
    },
    from(table: string) {
      if (table === 'order_payment_refund_claims') {
        const query: any = {
          select() {
            return query
          },
          eq() {
            return query
          },
          maybeSingle() {
            return Promise.resolve({
              data: { ...claim, status: claimStatus },
              error: null,
            })
          },
        }
        return query
      }
      if (table === 'money_desk_requests') {
        const query: any = {
          select() {
            return query
          },
          eq() {
            return query
          },
          maybeSingle() {
            return Promise.resolve({ data: moneyDeskRequest, error: null })
          },
        }
        return query
      }
      if (table === 'ops_issues') {
        const query: any = {
          select() {
            return query
          },
          eq() {
            return query
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null })
          },
          insert() {
            return query
          },
          single() {
            return Promise.resolve({
              data: {
                id: 'ops-issue-1',
                issue_number: 1,
                case_number: 'OPS-DEV-1',
              },
              error: null,
            })
          },
        }
        return query
      }
      if (table === 'ops_audit_logs') {
        return { insert: async () => ({ data: null, error: null }) }
      }
      if (table !== 'order_payment_refund_attempts') {
        throw new Error(`Unexpected table ${table}`)
      }
      const filters: Record<string, unknown> = {}
      const query: any = {
        select() {
          return query
        },
        eq(column: string, value: unknown) {
          filters[column] = value
          return query
        },
        order() {
          return Promise.resolve({
            data: attemptRows.filter((row) => row.refund_claim_id === filters.refund_claim_id),
            error: null,
          })
        },
        maybeSingle() {
          return Promise.resolve({
            data: attemptRows.find((row) => row.id === filters.id) ?? null,
            error: null,
          })
        },
      }
      return query
    },
  }
  return { supabase, calls, attemptRows }
}

function reviewedRetryInput(fixture: ReturnType<typeof makeReviewedRetryFixture>) {
  return {
    supabase: fixture.supabase as never,
    client: {} as never,
    payment,
    refundAmount: 5000,
    existingClaimId: 'claim-1',
    reviewedRetry: {
      moneyDeskRequestId: 'md-request-1',
      failedAttemptId: 'attempt-1',
    },
  }
}

Deno.test(
  'reviewed Bachs refund retry reserves a new fixed attempt after a terminal failure',
  async () => {
    const fixture = makeReviewedRetryFixture()
    let createCount = 0
    const result = await requestBachsRefund({
      ...reviewedRetryInput(fixture),
      deps: {
        getRefundByCharge: async () => failedRefund,
        createRefund: async (_client, input) => {
          createCount++
          assertEquals(input.reference, 'refund_claim1_2')
          assertEquals(input.idempotencyKey, 'drapeon-refund:claim1:2')
          return {
            ...refund,
            refund_id: 'rfnd_retry2',
            reference: 'refund_claim1_2',
            status: 'processing',
          }
        },
      },
    })

    assertEquals(result.status, 'PENDING')
    assertEquals(createCount, 1)
    assertEquals(fixture.attemptRows.length, 2)
    assertEquals(fixture.attemptRows[1]?.reviewed_retry_of_attempt_id, 'attempt-1')
    assertEquals(fixture.attemptRows[1]?.money_desk_request_id, 'md-request-1')
  }
)

Deno.test(
  'replaying an approved retry after success retrieves the same refund and never posts again',
  async () => {
    const fixture = makeReviewedRetryFixture()
    let createCount = 0
    const retryRefund = {
      ...refund,
      refund_id: 'rfnd_retry2',
      reference: 'refund_claim1_2',
    }
    const deps = {
      getRefundByCharge: async () => failedRefund,
      createRefund: async () => {
        createCount++
        return retryRefund
      },
    }
    const first = await requestBachsRefund({
      ...reviewedRetryInput(fixture),
      deps,
    })
    assertEquals(first.status, 'SUCCEEDED')

    const retryAttempt = fixture.attemptRows[1]!
    retryAttempt.status = 'SUCCEEDED'
    retryAttempt.provider_refund_id = retryRefund.refund_id
    const replay = await requestBachsRefund({
      ...reviewedRetryInput(fixture),
      deps: { ...deps, getRefundByCharge: async () => retryRefund },
    })

    assertEquals(replay.status, 'SUCCEEDED')
    assertEquals(createCount, 1)
  }
)

Deno.test(
  'Bachs refund reserves one fixed operation before refunding the exact settled charge',
  async () => {
    const fixture = makeFixture()
    let createCount = 0
    const result = await requestBachsRefund({
      supabase: fixture.supabase as never,
      client: {} as never,
      payment,
      refundAmount: 5000,
      deps: {
        getRefundByCharge: async () => {
          throw new BachsRequestError('missing', 404, 'NOT_FOUND', false, null, null)
        },
        createRefund: async (_client, input) => {
          createCount++
          assertEquals(input.chargeId, 'ch_test1')
          assertEquals(input.amountMinor, 5000)
          assertEquals(input.reference, 'refund_claim1_1')
          assertEquals(input.idempotencyKey, 'drapeon-refund:claim1:1')
          return refund
        },
        now: () => new Date('2026-10-28T04:10:00.000Z'),
      },
    })
    assertEquals(result.status, 'SUCCEEDED')
    assertEquals(createCount, 1)
    assertEquals(fixture.attemptRows[0]?.provider_charge_id, 'ch_test1')
    assertEquals(fixture.attemptRows[0]?.status, 'SUCCEEDED')
    assertEquals(fixture.calls[0]?.args.p_operation_key, 'bachs-refund:payment-1:0:5000:standard')
    assertEquals(
      fixture.calls.map((call) => call.name),
      [
        'reserve_order_payment_refund_claim',
        'reserve_bachs_payment_refund_attempt',
        'record_bachs_payment_refund_attempt_outcome',
        'record_bachs_payment_refund_attempt_outcome',
      ]
    )
  }
)

Deno.test("retry looks up and reuses a confirmed Bachs refund instead of creating a second one", async () => {
  const fixture = makeFixture();
  let createCount = 0;
  const deps = {
    getRefundByCharge: async () => {
      throw new BachsRequestError(
        "missing",
        404,
        "NOT_FOUND",
        false,
        null,
        null,
      );
    },
    createRefund: async () => {
      createCount++;
      return refund;
    },
    now: () => new Date("2026-10-28T04:10:00.000Z"),
  };
  await requestBachsRefund({
    supabase: fixture.supabase as never,
    client: {} as never,
    payment,
    refundAmount: 5000,
    deps,
  });
  const retry = await requestBachsRefund({
    supabase: fixture.supabase as never,
    client: {} as never,
    payment,
    refundAmount: 5000,
    deps: { ...deps, getRefundByCharge: async () => refund },
  });
  assertEquals(retry.status, "SUCCEEDED");
  assertEquals(createCount, 1);
});

Deno.test("provider success with failed outcome persistence opens Ops review and never reports success", async () => {
  const fixture = makeFixture({ failSuccessfulAttemptRecord: true });
  const result = await requestBachsRefund({
    supabase: fixture.supabase as never,
    client: {} as never,
    payment,
    refundAmount: 5000,
    deps: {
      getRefundByCharge: async () => {
        throw new BachsRequestError(
          "missing",
          404,
          "NOT_FOUND",
          false,
          null,
          null,
        );
      },
      createRefund: async () => refund,
      now: () => new Date("2026-10-28T04:10:00.000Z"),
    },
  });

  assertEquals(result.status, "OPS_REVIEW");
  assertEquals(result.response, refund);
  assertEquals(fixture.attemptRows[0]?.status, "PROVIDER_UNKNOWN");
  assertEquals(
    fixture.calls.filter((call) =>
      call.name === "record_bachs_payment_refund_attempt_outcome"
    )
      .map((call) => call.args.p_next_status),
    ["PROVIDER_UNKNOWN", "SUCCEEDED"],
  );
});
