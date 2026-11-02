import { assertEquals } from 'jsr:@std/assert@1'
import { runZiptaxSynthetic } from './ziptax-health.ts'

Deno.test('ZipTax synthetic retries once and reports recovery without provider details', async () => {
  let attempts = 0
  let waits = 0
  const result = await runZiptaxSynthetic({
    lookup: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('private provider failure')
      return { rateBps: 887, reason: 'New York' }
    },
    wait: async () => { waits += 1 },
    now: () => 10,
  })

  assertEquals(result.ok, true)
  assertEquals(result.status, 'ok')
  assertEquals(result.details.attempts, 2)
  assertEquals(attempts, 2)
  assertEquals(waits, 1)
  assertEquals(JSON.stringify(result).includes('private provider failure'), false)
})

Deno.test('ZipTax synthetic fails closed after the bounded retry', async () => {
  let attempts = 0
  const result = await runZiptaxSynthetic({
    lookup: async () => {
      attempts += 1
      throw new Error('dns provider detail')
    },
    wait: async () => {},
    now: () => 10,
  })

  assertEquals(result.ok, false)
  assertEquals(result.status, 'fail')
  assertEquals(result.details.attempts, 2)
  assertEquals(attempts, 2)
  assertEquals(JSON.stringify(result).includes('dns provider detail'), false)
})
