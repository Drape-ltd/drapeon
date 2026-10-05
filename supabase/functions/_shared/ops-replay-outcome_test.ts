import { assertEquals } from 'jsr:@std/assert@1'
import { opsReplayFailure, opsReplayOutcome } from './ops-replay-outcome.ts'

Deno.test('only a terminal successful replay can be acknowledged as saved', () => {
  assertEquals(opsReplayOutcome('SUCCEEDED'), 'SUCCEEDED')
  assertEquals(opsReplayFailure('SUCCEEDED'), null)
  assertEquals(opsReplayFailure('PENDING')?.code, 'OPS_RECEIPT_PENDING')
  assertEquals(opsReplayFailure('FAILED')?.code, 'OPS_RECEIPT_FAILED')
  assertEquals(opsReplayFailure(undefined)?.code, 'OPS_RECEIPT_UNVERIFIED')
  assertEquals(opsReplayFailure('CANCELLED')?.status, 502)
})
