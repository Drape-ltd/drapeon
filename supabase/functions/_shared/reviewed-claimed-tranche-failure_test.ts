import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { closeDefiniteReviewedTrancheRetry } from './reviewed-claimed-tranche-failure.ts'

Deno.test('definite rejection closes the exact reviewed request through the guarded RPC', async () => {
  const calls: Array<{ name: string; args: unknown }> = []
  const client = {
    async rpc(name: string, args: unknown) {
      calls.push({ name, args })
      return { data: { outcome: 'CLOSED_DEFINITE_REJECTION' }, error: null }
    },
  } as unknown as SupabaseClient
  await closeDefiniteReviewedTrancheRetry(client, 'request-one')
  assertEquals(calls, [{ name: 'close_unstarted_reviewed_claimed_retry',
    args: { p_request_id: 'request-one' } }])
})

Deno.test('provider operation still possible cannot close the reviewed request', async () => {
  const client = {
    async rpc() {
      return { data: { outcome: 'PROVIDER_OPERATION_POSSIBLE' }, error: null }
    },
  } as unknown as SupabaseClient
  await assertRejects(() => closeDefiniteReviewedTrancheRetry(client, 'request-one'),
    Error, 'could not close its Money Desk attempt')
})
