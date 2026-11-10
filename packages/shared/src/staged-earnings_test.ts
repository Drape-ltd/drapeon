import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { summarizeStagedEarnings } from './staged-earnings.ts'

const tranches = [
  { id: 'custody', amount: 84, currency: 'USD', status: 'RELEASED' },
  { id: 'delivery', amount: 24, currency: 'USD', status: 'LOCKED' },
  { id: 'completion', amount: 12, currency: 'USD', status: 'LOCKED' },
]
const payout = {
  settlement_tranche_id: 'custody', payout_purpose: 'SETTLEMENT_TRANCHE',
  amount: 84, currency: 'USD', provider: 'STRIPE', status: 'PROCESSING',
  provider_transfer_status: 'AVAILABLE_IN_PROVIDER_BALANCE',
  initiated_at: '2026-11-10T12:00:00Z',
}

Deno.test('a released custody tranche leaves only later tranches pending', () => {
  assertEquals(summarizeStagedEarnings(tranches, [payout]), {
    currency: 'USD', total: 120, pending: 36, available: 0,
    inProviderBalance: 84, paidToBank: 0,
  })
})

Deno.test('eligible tranches are available and failed attempts do not replace a later payout', () => {
  const result = summarizeStagedEarnings(
    [...tranches, { id: 'extra', amount: 10, currency: 'USD', status: 'ELIGIBLE' }],
    [{ ...payout, status: 'FAILED', initiated_at: '2026-11-09T12:00:00Z' }, payout],
  )
  assertEquals(result?.available, 10)
  assertEquals(result?.inProviderBalance, 84)
})

Deno.test('missing or mismatched release evidence fails closed', () => {
  assertThrows(() => summarizeStagedEarnings(tranches, []), Error, 'STAGED_EARNINGS_PAYOUT_MISMATCH')
  assertThrows(() => summarizeStagedEarnings(tranches, [{ ...payout, amount: 85 }]), Error, 'STAGED_EARNINGS_PAYOUT_MISMATCH')
})

Deno.test('cancelled tranches are excluded and currencies cannot mix', () => {
  assertEquals(summarizeStagedEarnings([{ ...tranches[0], status: 'CANCELLED' }], []), null)
  assertThrows(() => summarizeStagedEarnings([...tranches, { id: 'other', amount: 1, currency: 'CAD', status: 'LOCKED' }], [payout]), Error, 'STAGED_EARNINGS_AMOUNT_CONFLICT')
})
