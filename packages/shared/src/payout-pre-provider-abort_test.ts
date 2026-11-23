import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { PAYOUT_BLOCKED_REASONS, payoutBlockRecovery } from './payout-gating.ts'

Deno.test('pre-provider payout abort has safe shared tailor copy', () => {
  const recovery = payoutBlockRecovery(
    PAYOUT_BLOCKED_REASONS.PAYOUT_PRE_PROVIDER_ABORT,
  )
  assertEquals(recovery.headline, 'Payout under review')
  assertEquals(
    recovery.reason,
    'The payout stopped before the provider transfer started.',
  )
  assertEquals(recovery.userActionRequired, false)
  assertEquals(recovery.destination, 'EARNINGS')
  assertEquals(
    recovery.nextStep,
    'Drapeon Ops is reviewing the payout. No action is needed from you.',
  )
  assertEquals(
    JSON.stringify(recovery).includes('PAYOUT_PRE_PROVIDER_ABORT'),
    false,
  )
})
