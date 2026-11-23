import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { queuedDispatchRefundRetryResult } from './dispatch-refund-retry-result.ts'

Deno.test('queued dispatch refund remains PROCESSING with a job reference', () => {
  assertEquals(queuedDispatchRefundRetryResult({ jobId: 'job_1' }),
    { ok: true, pending: true, providerReference: 'job_1' })
  assertEquals(queuedDispatchRefundRetryResult({ outcome: 'BLOCKED' }),
    { ok: false, error: 'BLOCKED' })
})
