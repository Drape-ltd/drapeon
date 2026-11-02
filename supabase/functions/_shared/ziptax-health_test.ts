import { assertEquals } from 'jsr:@std/assert@1'
import { readOrRefreshZiptaxSynthetic, runZiptaxSynthetic, type ZiptaxSyntheticResult } from './ziptax-health.ts'

function memoryCache() {
  let claimedAt = 0
  let stored: ZiptaxSyntheticResult | null = null
  return {
    cache: {
      read: async () => stored,
      claim: async ({ checkedAt, staleBefore }: { checkedAt: string; staleBefore: string }) => {
        const staleBeforeMs = Date.parse(staleBefore)
        if (claimedAt > staleBeforeMs) return false
        claimedAt = Date.parse(checkedAt)
        return true
      },
      write: async (result: ZiptaxSyntheticResult) => { stored = result },
    },
    stored: () => stored,
  }
}

Deno.test('ZipTax synthetic makes one bounded lookup and redacts provider details', async () => {
  let attempts = 0
  const result = await runZiptaxSynthetic({
    lookup: async () => {
      attempts += 1
      throw new Error('dns provider detail')
    },
    now: () => 10,
  })

  assertEquals(result.ok, false)
  assertEquals(result.status, 'fail')
  assertEquals(result.details.attempts, 1)
  assertEquals(attempts, 1)
  assertEquals(JSON.stringify(result).includes('dns provider detail'), false)
})

Deno.test('cached synthetic performs at most one paid lookup per hour', async () => {
  const state = memoryCache()
  let attempts = 0
  const lookup = async () => {
    attempts += 1
    return { rateBps: 887, reason: 'New York' }
  }

  const first = await readOrRefreshZiptaxSynthetic({ cache: state.cache, lookup, now: () => Date.parse('2026-11-02T10:00:00Z') })
  const second = await readOrRefreshZiptaxSynthetic({ cache: state.cache, lookup, now: () => Date.parse('2026-11-02T10:55:00Z') })
  const third = await readOrRefreshZiptaxSynthetic({ cache: state.cache, lookup, now: () => Date.parse('2026-11-02T11:01:00Z') })

  assertEquals(first.status, 'ok')
  assertEquals(second.details.cached, true)
  assertEquals(third.status, 'ok')
  assertEquals(attempts, 2)
  assertEquals(state.stored()?.details.checked_at, '2026-11-02T11:01:00.000Z')
})
