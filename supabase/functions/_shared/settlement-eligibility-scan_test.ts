import {
  runSettlementEligibilityScan,
  type DueSettlementPlan,
} from './settlement-eligibility-scan.ts'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const plan = (id: string): DueSettlementPlan => ({
  id, order_id: `order-${id}`, tailor_id: `tailor-${id}`,
  customer_id: `customer-${id}`, currency: 'USD', status: 'ACTIVE',
})

Deno.test('due settlement scan refreshes and notifies without any payout callback', async () => {
  const calls: string[] = []
  const result = await runSettlementEligibilityScan({
    listDue: async (limit) => { calls.push(`list:${limit}`); return [plan('a')] },
    markScanned: async (p) => { calls.push(`scan:${p.id}`) },
    refresh: async (p) => { calls.push(`refresh:${p.id}`) },
    listEligible: async (p) => {
      calls.push(`eligible:${p.id}`)
      return [{ id: 'tranche-a', code: 'SHIP_DELIVERY_20', amount: 2400,
        currency: 'USD', status: 'ELIGIBLE', eligible_at: new Date().toISOString() }]
    },
    notify: async (_p, tranche) => { calls.push(`notify:${tranche.id}`) },
    reportFailure: () => { throw new Error('Unexpected failure') },
  })
  assert(JSON.stringify(calls) === JSON.stringify([
    'list:100', 'scan:a', 'refresh:a', 'eligible:a', 'notify:tranche-a',
  ]), `Unexpected calls: ${calls}`)
  assert(result.plansChecked === 1 && result.eligible === 1 && result.errors === 0,
    `Unexpected result: ${JSON.stringify(result)}`)
})

Deno.test('failed refresh leaves the lane on the next plan without notifying', async () => {
  const calls: string[] = []
  const result = await runSettlementEligibilityScan({
    listDue: async () => [plan('bad'), plan('good')],
    markScanned: async (p) => { calls.push(`scan:${p.id}`) },
    refresh: async (p) => {
      calls.push(`refresh:${p.id}`)
      if (p.id === 'bad') throw new Error('ledger rejected')
    },
    listEligible: async (p) => [{ id: `tranche-${p.id}`, code: 'SHIP_DELIVERY_20',
      amount: 2400, currency: 'USD', status: 'ELIGIBLE', eligible_at: null }],
    notify: async (_p, tranche) => { calls.push(`notify:${tranche.id}`) },
    reportFailure: (p) => { calls.push(`error:${p.id}`) },
  })
  assert(!calls.includes('notify:tranche-bad'), 'Failed plan notified')
  assert(calls.includes('notify:tranche-good'), 'Next plan was not processed')
  assert(result.plansChecked === 2 && result.eligible === 1 && result.errors === 1,
    `Unexpected result: ${JSON.stringify(result)}`)
})

Deno.test('scan-marker failure is isolated and cannot refresh the affected plan', async () => {
  const calls: string[] = []
  const result = await runSettlementEligibilityScan({
    listDue: async () => [plan('bad'), plan('good')],
    markScanned: async (p) => {
      if (p.id === 'bad') throw new Error('scan marker write failed')
      calls.push(`scan:${p.id}`)
    },
    refresh: async (p) => { calls.push(`refresh:${p.id}`) },
    listEligible: async () => [],
    notify: async () => { throw new Error('Unexpected notification') },
    reportFailure: (p) => { calls.push(`error:${p.id}`) },
  })
  assert(!calls.includes('refresh:bad'), 'Plan with failed scan marker refreshed')
  assert(calls.includes('refresh:good'), 'Next plan was not processed')
  assert(result.errors === 1 && result.plansChecked === 2,
    `Unexpected result: ${JSON.stringify(result)}`)
})
