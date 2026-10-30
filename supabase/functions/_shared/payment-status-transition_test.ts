import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  PAYMENT_STATUSES,
  paymentStatusTransitionDisposition,
  type ForwardPaymentStatus,
} from './payment-status-transition.ts'

const normalTransitions = new Set([
  'INITIATED>PENDING', 'INITIATED>SUCCEEDED', 'INITIATED>FAILED', 'INITIATED>CANCELED',
  'PENDING>SUCCEEDED', 'PENDING>FAILED', 'PENDING>CANCELED',
  'SUCCEEDED>PARTIAL_REFUND', 'SUCCEEDED>REFUNDED',
  'PARTIAL_REFUND>REFUNDED',
])

for (const from of PAYMENT_STATUSES) {
  for (const to of PAYMENT_STATUSES) {
    Deno.test(`PAY-003 matrix ${from} -> ${to}`, () => {
      const expected = from === to ? 'noop' : normalTransitions.has(`${from}>${to}`) ? 'transition' : 'reject'
      assertEquals(paymentStatusTransitionDisposition({ from, to }), expected)
    })
  }
}

Deno.test('provider-evidenced current FAILED attempt may succeed', () => {
  assertEquals(paymentStatusTransitionDisposition({
    from: 'FAILED', to: 'SUCCEEDED', evidencedLateSuccess: true,
  }), 'transition')
})

for (const unsafe of [
  { superseded: true },
  { hasNewerAttempt: true },
  { refundedAmount: 1 },
]) {
  Deno.test(`FAILED late success is rejected with ${Object.keys(unsafe)[0]}`, () => {
    assertEquals(paymentStatusTransitionDisposition({
      from: 'FAILED', to: 'SUCCEEDED', evidencedLateSuccess: true, ...unsafe,
    }), 'reject')
  })
}

Deno.test('local CANCELED never returns to SUCCEEDED', () => {
  assertEquals(paymentStatusTransitionDisposition({
    from: 'CANCELED', to: 'SUCCEEDED', evidencedLateSuccess: true,
  }), 'reject')
})

// Compile-time coverage: the matrix must remain exhaustive when a status is added.
const _allStatuses: readonly ForwardPaymentStatus[] = PAYMENT_STATUSES
void _allStatuses
