import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  initialOrderPromotionCustomerDue,
  promotionCustomerDueWithProviderCost,
} from './provider-cost.ts'

Deno.test('a custom-order promotion retry retains the locked Bachs provider cost', () => {
  assertEquals(
    initialOrderPromotionCustomerDue({
      customerDueAmount: 9_000,
      orderKind: 'CUSTOM',
      acceptedRouteSnapshotAt: '2026-11-16T12:00:00.000Z',
      chargeProviderSnapshot: 'BACHS',
      lockedProviderCostAmount: 200,
    }),
    9_200,
  )
})

Deno.test('a ready-made promotion does not add an already-reserved provider cost twice', () => {
  assertEquals(
    initialOrderPromotionCustomerDue({
      customerDueAmount: 9_200,
      orderKind: 'READY_MADE',
      acceptedRouteSnapshotAt: '2026-11-16T12:00:00.000Z',
      chargeProviderSnapshot: 'BACHS',
      lockedProviderCostAmount: 200,
    }),
    9_200,
  )
})

Deno.test('promotion due provider-cost arithmetic rejects invalid minor-unit values', () => {
  assertThrows(
    () => initialOrderPromotionCustomerDue({
      customerDueAmount: 9_000,
      orderKind: 'CUSTOM',
      acceptedRouteSnapshotAt: '2026-11-16T12:00:00.000Z',
      chargeProviderSnapshot: 'BACHS',
      lockedProviderCostAmount: null,
    }),
    Error,
    'locked provider cost must be a non-negative safe integer',
  )
  assertThrows(
    () => promotionCustomerDueWithProviderCost({
      customerDueAmount: 9_000,
      providerCostAmount: -1,
      providerCostAlreadyIncluded: false,
    }),
    Error,
    'providerCostAmount must be a non-negative safe integer',
  )
})
