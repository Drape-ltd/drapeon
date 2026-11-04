import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { PushPayload } from "./notify.ts";
import { enqueuePushJob } from "./side-effect-jobs.ts";

export type OrderPaymentPush = {
  audience: "CUSTOMER" | "TAILOR";
  userId: string;
  idempotencyKey: string;
  notification: PushPayload;
};

export function buildOrderPaymentPushes(input: {
  orderId: string;
  orderKind?: string | null;
  itemTitle?: string | null;
  customerId?: string | null;
  tailorId?: string | null;
  providerPaymentId: string;
}): OrderPaymentPush[] {
  const pushes: OrderPaymentPush[] = [];

  if (input.customerId) {
    const idempotencyKey =
      `payment-confirmed:${input.orderId}:${input.providerPaymentId}:customer`;
    pushes.push({
      audience: "CUSTOMER",
      userId: input.customerId,
      idempotencyKey,
      notification: {
        title: input.orderKind === "READY_MADE"
          ? "Order confirmed"
          : "Payment confirmed",
        body: input.orderKind === "READY_MADE"
          ? "Your ready-made order is paid and the tailor can prepare it inside Drapeon."
          : "Your order is funded. The tailor can continue production inside Drapeon.",
        preferenceKey: "paymentConfirmations",
        data: { orderId: input.orderId },
        communication: {
          category: "PAYMENT",
          purpose: "TRANSACTIONAL",
          severity: "NOTICE",
          mandatory: true,
          inApp: true,
          destinationKey: "ORDER_DETAIL",
          destinationParams: { orderId: input.orderId },
          deduplicationKey: idempotencyKey,
        },
      },
    });
  }

  if (input.orderKind === "READY_MADE" && input.tailorId) {
    const idempotencyKey =
      `payment-confirmed:${input.orderId}:${input.providerPaymentId}:tailor`;
    const item = input.itemTitle?.trim() || "A ready-made item";
    pushes.push({
      audience: "TAILOR",
      userId: input.tailorId,
      idempotencyKey,
      notification: {
        title: "New paid ready-made order",
        body:
          `${item} was purchased. Open the order to prepare it for the customer.`,
        preferenceKey: "newOrders",
        data: { orderId: input.orderId, target: "order-detail" },
        communication: {
          category: "ORDER",
          purpose: "TRANSACTIONAL",
          severity: "NOTICE",
          mandatory: true,
          inApp: true,
          destinationKey: "ORDER_DETAIL",
          destinationParams: { orderId: input.orderId },
          deduplicationKey: idempotencyKey,
        },
      },
    });
  }

  return pushes;
}

export async function enqueueOrderPaymentPushes(
  supabase: SupabaseClient,
  input: Parameters<typeof buildOrderPaymentPushes>[0] & { source: string },
  enqueue: typeof enqueuePushJob = enqueuePushJob,
): Promise<boolean[]> {
  const pushes = buildOrderPaymentPushes(input);
  const outcomes: boolean[] = [];
  for (const push of pushes) {
    outcomes.push(
      await enqueue(supabase, {
        userId: push.userId,
        orderId: input.orderId,
        source: input.source,
        idempotencyKey: push.idempotencyKey,
        priority: 20,
        notification: push.notification,
      }),
    );
  }
  return outcomes;
}
