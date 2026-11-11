import { assertEquals } from 'jsr:@std/assert@1'
import { loadProjectedBankPayoutEvents } from './bank-payout-projection.ts'

Deno.test('read gateway projection paginates past repeated events before limiting withdrawals', async () => {
  const base = {
    id: 'row-created', provider: 'STRIPE', provider_bank_payout_id: 'po-one',
    amount: 8000, currency: 'USD', status: 'IN_TRANSIT',
    occurred_at: '2026-11-09T00:53:38Z', processed_at: '2026-11-09T00:53:40Z',
    created_at: '2026-11-09T00:53:40Z',
  }
  const events = Array.from({ length: 101 }, (_, index) => ({
    ...base, id: `row-${index}`, status: index === 0 ? 'PAID' : 'IN_TRANSIT',
    occurred_at: new Date(Date.parse('2026-11-09T01:00:00Z') - index * 1000).toISOString(),
  }))
  events.push({ ...base, id: 'other', provider_bank_payout_id: 'po-other',
    occurred_at: '2026-11-08T00:00:00Z' })
  const ranges: Array<[number, number]> = []
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: async (start: number, end: number) => {
      ranges.push([start, end])
      return { data: events.slice(start, end + 1), error: null }
    },
  }
  const result = await loadProjectedBankPayoutEvents({ from: () => query }, 'profile-dev')
  assertEquals(ranges, [[0, 99], [100, 199]])
  assertEquals(result.length, 2)
  assertEquals(result[0].status, 'PAID')
})
