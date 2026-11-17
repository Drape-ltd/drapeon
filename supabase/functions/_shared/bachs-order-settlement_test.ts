import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { refreshBachsInitialOrderSettlement } from "./bachs-order-settlement.ts";

Deno.test("Bachs initial-order success refreshes its staged settlement plan", async () => {
  const calls: unknown[] = [];
  const result = await refreshBachsInitialOrderSettlement({
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({
        data: { plan_id: "plan-1", status: "ACTIVE" },
        error: null,
      });
    },
  } as never, { orderId: "order-1", phase: "INITIAL_ORDER" });
  assertEquals(result.refreshed, true);
  assertEquals(calls, [{
    name: "refresh_order_settlement",
    args: { p_order_id: "order-1" },
  }]);
});

Deno.test("non-initial Bachs collection never creates an order settlement plan", async () => {
  const result = await refreshBachsInitialOrderSettlement({
    rpc() {
      throw new Error("must not be called");
    },
  } as never, { orderId: "order-1", phase: "FULFILLMENT" });
  assertEquals(result, { refreshed: false });
});

Deno.test("Bachs initial-order confirmation fails closed when settlement refresh fails", async () => {
  await assertRejects(
    () =>
      refreshBachsInitialOrderSettlement({
        rpc() {
          return Promise.resolve({
            data: null,
            error: new Error("plan unavailable"),
          });
        },
      } as never, { orderId: "order-1", phase: "INITIAL_ORDER" }),
    Error,
    "plan unavailable",
  );
});
