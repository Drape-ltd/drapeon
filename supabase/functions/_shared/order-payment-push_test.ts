import { assertEquals } from "jsr:@std/assert@1";
import {
  buildOrderPaymentPushes,
  enqueueOrderPaymentPushes,
} from "./order-payment-push.ts";

Deno.test("ready-made payment notifies both customer and tailor with order deep links", () => {
  const pushes = buildOrderPaymentPushes({
    orderId: "order-1",
    orderKind: "READY_MADE",
    itemTitle: "Indigo kaftan",
    customerId: "customer-1",
    tailorId: "tailor-1",
    providerPaymentId: "pi_1",
  });

  assertEquals(pushes.map(({ audience }) => audience), ["CUSTOMER", "TAILOR"]);
  assertEquals(
    pushes[0].notification.communication?.deduplicationKey,
    "payment-confirmed:order-1:pi_1:customer",
  );
  assertEquals(pushes[1], {
    audience: "TAILOR",
    userId: "tailor-1",
    idempotencyKey: "payment-confirmed:order-1:pi_1:tailor",
    notification: {
      title: "New paid ready-made order",
      body:
        "Indigo kaftan was purchased. Open the order to prepare it for the customer.",
      preferenceKey: "newOrders",
      data: { orderId: "order-1", target: "order-detail" },
      communication: {
        category: "ORDER",
        purpose: "TRANSACTIONAL",
        severity: "NOTICE",
        mandatory: true,
        inApp: true,
        destinationKey: "ORDER_DETAIL",
        destinationParams: { orderId: "order-1" },
        deduplicationKey: "payment-confirmed:order-1:pi_1:tailor",
      },
    },
  });
});

Deno.test("custom-order payment keeps the customer-only payment confirmation", () => {
  const pushes = buildOrderPaymentPushes({
    orderId: "order-2",
    orderKind: "CUSTOM",
    customerId: "customer-2",
    tailorId: "tailor-2",
    providerPaymentId: "pi_2",
  });
  assertEquals(pushes.length, 1);
  assertEquals(pushes[0].audience, "CUSTOMER");
  assertEquals(pushes[0].notification.preferenceKey, "paymentConfirmations");
});

Deno.test("ready-made payment without a tailor does not invent a recipient", () => {
  const pushes = buildOrderPaymentPushes({
    orderId: "order-3",
    orderKind: "READY_MADE",
    customerId: "customer-3",
    providerPaymentId: "pi_3",
  });
  assertEquals(pushes.map(({ audience }) => audience), ["CUSTOMER"]);
});

Deno.test("payment pushes use durable jobs for both recipients", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const outcomes = await enqueueOrderPaymentPushes(
    {} as never,
    {
      orderId: "order-4",
      orderKind: "READY_MADE",
      customerId: "customer-4",
      tailorId: "tailor-4",
      providerPaymentId: "pi_4",
      source: "stripe-webhook",
    },
    ((_client: unknown, input: Record<string, unknown>) => {
      calls.push(input);
      return Promise.resolve(true);
    }) as never,
  );

  assertEquals(outcomes, [true, true]);
  assertEquals(
    calls.map((call) => ({
      userId: call.userId,
      orderId: call.orderId,
      source: call.source,
      idempotencyKey: call.idempotencyKey,
    })),
    [
      {
        userId: "customer-4",
        orderId: "order-4",
        source: "stripe-webhook",
        idempotencyKey: "payment-confirmed:order-4:pi_4:customer",
      },
      {
        userId: "tailor-4",
        orderId: "order-4",
        source: "stripe-webhook",
        idempotencyKey: "payment-confirmed:order-4:pi_4:tailor",
      },
    ],
  );
});
