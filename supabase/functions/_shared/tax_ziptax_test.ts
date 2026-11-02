import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import { getTaxRateFromZiptax, parseZiptaxV60, ZIPTAX_ENDPOINT } from './tax.ts'

// Copied from ZipTax's documented v60 By Address example:
// https://docs.zip.tax/guides/rest-api/by-address
const documentedUsV60Response = {
  metadata: {
    version: 'v60',
    response: {
      code: 100,
      name: 'RESPONSE_CODE_SUCCESS',
      message: 'Successful API Request.',
      definition: 'http://api.zip-tax.com/request/v60/schema',
    },
  },
  baseRates: [
    { rate: 0.0725, jurType: 'US_STATE_SALES_TAX', jurName: 'CA', jurDescription: 'US State Sales Tax', jurTaxCode: '06' },
    { rate: 0.0725, jurType: 'US_STATE_USE_TAX', jurName: 'CA', jurDescription: 'US State Use Tax', jurTaxCode: '06' },
    { rate: 0.005, jurType: 'US_COUNTY_SALES_TAX', jurName: 'ORANGE', jurDescription: 'US County Sales Tax', jurTaxCode: '30' },
    { rate: 0.005, jurType: 'US_COUNTY_USE_TAX', jurName: 'ORANGE', jurDescription: 'US County Use Tax', jurTaxCode: '30' },
    { rate: 0, jurType: 'US_CITY_SALES_TAX', jurName: 'IRVINE', jurDescription: 'US City Sales Tax', jurTaxCode: null },
    { rate: 0, jurType: 'US_CITY_USE_TAX', jurName: 'IRVINE', jurDescription: 'US City Use Tax', jurTaxCode: null },
  ],
  service: { adjustmentType: 'SERVICE_TAXABLE', taxable: 'N', description: 'Services non-taxable' },
  shipping: { adjustmentType: 'FREIGHT_TAXABLE', taxable: 'N', description: 'Freight non-taxable' },
  sourcingRules: { adjustmentType: 'ORIGIN_DESTINATION', description: 'Destination Based Taxation', value: 'D' },
  taxSummaries: [
    { rate: 0.0775, taxType: 'SALES_TAX', summaryName: 'Total Base Sales Tax', displayRates: [{ name: 'Total Rate', rate: 0.0775 }] },
    { rate: 0.0775, taxType: 'USE_TAX', summaryName: 'Total Base Use Tax', displayRates: [{ name: 'Total Rate', rate: 0.0775 }] },
  ],
  addressDetail: {
    normalizedAddress: '200 Spectrum Center Dr, Irvine, CA 92618-5003, United States',
    incorporated: 'true',
    geoLat: 33.65253,
    geoLng: -117.74794,
  },
}

Deno.test('documented US v60 response selects one sales-tax total and returns 775 bps', () => {
  assertEquals(parseZiptaxV60(documentedUsV60Response, 'US'), {
    rateBps: 775,
    taxRegion: 'CA',
    shippingTaxable: false,
    platformFeeTaxable: false,
  })
})

Deno.test('base-rates-only v60 response fails closed instead of double charging 1550 bps', () => {
  const { taxSummaries: _removed, ...baseRatesOnly } = documentedUsV60Response
  assertThrows(
    () => parseZiptaxV60(baseRatesOnly, 'US'),
    Error,
    'exactly one SALES_TAX summary',
  )
})

Deno.test('live lookup path rejects a documented response when its sales summary is missing', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = Deno.env.get('ZIPTAX_API_KEY')
  const { taxSummaries: _removed, ...baseRatesOnly } = documentedUsV60Response
  Deno.env.set('ZIPTAX_API_KEY', 'test-key')
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(baseRatesOnly), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))) as typeof fetch

  try {
    await assertRejects(
      () => getTaxRateFromZiptax('200 Spectrum Center Dr, Irvine, CA', '92618', 'US'),
      Error,
      'exactly one SALES_TAX summary',
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) Deno.env.delete('ZIPTAX_API_KEY')
    else Deno.env.set('ZIPTAX_API_KEY', originalKey)
  }
})

Deno.test('multiple sales-tax summaries fail closed instead of being added together', () => {
  assertThrows(
    () => parseZiptaxV60({
      ...documentedUsV60Response,
      taxSummaries: [
        { rate: 0.0775, taxType: 'SALES_TAX' },
        { rate: 0.01, taxType: 'SALES_TAX' },
      ],
    }, 'US'),
    Error,
    'exactly one SALES_TAX summary',
  )
})

Deno.test('Canadian v60 response uses the single documented sales summary contract', () => {
  // ZipTax documents countryCode=CAN as returning the same v60 response shape,
  // but does not publish a numeric Canadian example. This fixture exercises
  // that documented schema without deriving a total from baseRates.
  assertEquals(parseZiptaxV60({
    metadata: { version: 'v60', response: { code: 100 } },
    baseRates: [
      { rate: 0.05, jurType: 'CA_FEDERAL_SALES_TAX', jurName: 'GST' },
      { rate: 0.09975, jurType: 'CA_PROVINCE_SALES_TAX', jurName: 'QST' },
    ],
    taxSummaries: [{ rate: 0.14975, taxType: 'SALES_TAX', summaryName: 'GST+QST' }],
    addressDetail: { state: 'Quebec', stateCode: 'QC' },
  }, 'CA'), {
    rateBps: 1498,
    taxRegion: 'Quebec GST+QST',
    shippingTaxable: false,
    platformFeeTaxable: false,
  })
})

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
    assertEquals(calledUrl.searchParams.get('address'), '100 Congress Ave, Austin, TX')
    assertEquals(calledUrl.searchParams.get('countryCode'), 'USA')
    assertEquals(calledUrl.searchParams.has('postalcode'), false)
    assertEquals(calledUrl.searchParams.has('addressDetailExtended'), false)
    assertEquals(calledUrl.searchParams.has('shippingExtended'), false)
    assertEquals(result, { rateBps: 825, reason: 'TX' })
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) Deno.env.delete('ZIPTAX_API_KEY')
    else Deno.env.set('ZIPTAX_API_KEY', originalKey)
  }
})
