import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { executeReviewedClaimedTrancheRetry } from './reviewed-claimed-tranche-retry.ts'

const request = {
  id: 'request-1', targetId: 'claim-1',
  actionPayload: { claimId: 'claim-1', trancheId: 'tranche-1' },
}

Deno.test('reviewed retry calls the exact release and awaits monitor finalization', async () => {
  const calls: unknown[] = []
  const result = await executeReviewedClaimedTrancheRetry(request, async (body) => {
    calls.push(body)
    return { ok: true, providerReference: 'tr_test_1' }
  })
  assertEquals(calls, [{ trancheId: 'tranche-1', moneyDeskRequestId: 'request-1' }])
  assertEquals(result, { ok: true, pending: true, providerReference: 'tr_test_1' })
})

Deno.test('lost Edge response leaves the original attempt processing', async () => {
  const result = await executeReviewedClaimedTrancheRetry(request, async () => {
    throw new Error('network timeout')
  })
  assertEquals(result, { ok: true, pending: true })
})

Deno.test('structured Edge failure remains pending for authoritative reconciliation', async () => {
  const result = await executeReviewedClaimedTrancheRetry(request, async () => ({ ok: false }))
  assertEquals(result, { ok: true, pending: true, providerReference: null })
})

Deno.test('a different claim cannot invoke the release', async () => {
  let invoked = false
  const result = await executeReviewedClaimedTrancheRetry({
    ...request, actionPayload: { claimId: 'other', trancheId: 'tranche-1' },
  }, async () => { invoked = true; return { ok: true } })
  assertEquals(invoked, false)
  assertEquals(result.ok, false)
  assertEquals(result.pending, undefined)
})
