import { assertEquals } from 'jsr:@std/assert@1'
import { COMMERCIAL_ARCHITECTURE_POLICY_VERSION } from '../../../packages/shared/src/commercial-contracts.ts'
import { initialOrderPromotionCustomerDue } from '../../../packages/shared/src/provider-cost.ts'
import { prepareCommercialPricingReservation } from './commercial-ledger.ts'

Deno.test('an accepted custom Bachs promotion retry with no payment attempt reserves the corrected due amount', async () => {
  const customerDueAmount = initialOrderPromotionCustomerDue({
    customerDueAmount: 9_000,
    orderKind: 'CUSTOM',
    acceptedRouteSnapshotAt: '2026-11-16T12:00:00.000Z',
    chargeProviderSnapshot: 'BACHS',
    lockedProviderCostAmount: 200,
  })
  const reservationCalls: Array<Record<string, unknown>> = []
  const supabase = {
    from(table: string) {
      assertEquals(table, 'orders')
      return {
        select() { return this },
        eq() { return this },
        async single() {
          return {
            data: {
              customer_id: 'customer-1',
              active_quote_id: null,
              commercial_policy_version: COMMERCIAL_ARCHITECTURE_POLICY_VERSION,
              fabric_funding_policy_version: null,
              special_note: null,
              subtotal_amount: 10_000,
              platform_fee_amount: 200,
              tax_amount: 0,
              shipping_amount: 0,
              total_amount: 10_200,
              tax_region: null,
              tax_fallback: false,
              tax_fallback_reason: null,
              tax_decision_snapshot_id: null,
              pricing_invalidated_at: null,
            },
            error: null,
          }
        },
      }
    },
    async rpc(name: string, args: Record<string, unknown>) {
      assertEquals(name, 'create_commercial_pricing_reservation')
      reservationCalls.push(args)
      return {
        data: {
          id: 'pricing-1',
          reservation_token: 'pricing-token',
          expires_at: '2026-11-16T12:30:00.000Z',
          correlation_id: 'pricing-correlation',
          pricing_version: 1,
          policy_version: COMMERCIAL_ARCHITECTURE_POLICY_VERSION,
        },
        error: null,
      }
    },
  }

  const result = await prepareCommercialPricingReservation(supabase as never, {
    idempotencyKey: 'checkout-pricing:bachs-promotion-retry',
    orderId: 'order-1',
    phase: 'INITIAL_ORDER',
    currency: 'NGN',
    amount: customerDueAmount,
    benefit: {
      reservationToken: 'benefit-token',
      totalBenefitAmount: 1_000,
      customerDueAmount,
    },
  })

  assertEquals(result.skipped, false)
  assertEquals(customerDueAmount, 9_200)
  assertEquals(reservationCalls[0]?.p_total_amount, customerDueAmount)
})
