import { assertEquals } from 'jsr:@std/assert@1'
import { getTaxRateFromZiptax, ZIPTAX_ENDPOINT } from './tax.ts'

Deno.test('ZipTax lookup uses the official v60 host and path', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = Deno.env.get('ZIPTAX_API_KEY')
  let calledUrlString = ''
  Deno.env.set('ZIPTAX_API_KEY', 'test-key')
  globalThis.fetch = ((input) => {
    calledUrlString = String(input)
    return Promise.resolve(new Response(JSON.stringify({
      metadata: { version: 'v60', response: { code: 100 } },
      baseRates: [{ rate: 0.0625, jurType: 'US_STATE_SALES_TAX', jurName: 'TX' }],
      taxSummaries: [{ rate: 0.0825, taxType: 'SALES_TAX', summaryName: 'Total Base Sales Tax' }],
      addressDetail: { stateCode: 'TX' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch

  try {
    const result = await getTaxRateFromZiptax('100 Congress Ave, Austin, TX', '78701', 'US')
    const calledUrl = new URL(calledUrlString)
    assertEquals(ZIPTAX_ENDPOINT, 'https://api.zip-tax.com/request/v60')
    assertEquals(calledUrl.origin, 'https://api.zip-tax.com')
    assertEquals(calledUrl.pathname, '/request/v60')
    assertEquals(result, { rateBps: 825, reason: 'TX' })
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) Deno.env.delete('ZIPTAX_API_KEY')
    else Deno.env.set('ZIPTAX_API_KEY', originalKey)
  }
})
