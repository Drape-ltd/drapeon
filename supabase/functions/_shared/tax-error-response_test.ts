import { assertEquals } from 'jsr:@std/assert@1'
import { TaxProviderUnavailableError, TaxRateUnavailableError, TaxResolutionError } from './tax.ts'
import { mapTaxProviderUnavailableError, mapTaxRateUnavailableError, mapTaxResolutionError } from './tax-error-response.ts'

Deno.test('every structured delivery tax error maps to a coded 409', () => {
  const cases = [
    ['DELIVERY_POSTAL_CODE_REQUIRED', 'add a ZIP or postal code'],
    ['DELIVERY_POSTAL_CODE_INVALID', 'add a valid ZIP or postal code'],
    ['DELIVERY_POSTAL_REGION_MISMATCH', 'matches the selected state or province'],
  ] as const

  for (const [code, copy] of cases) {
    const result = mapTaxResolutionError(new TaxResolutionError(code, 'provider detail'))
    assertEquals(result.status, 409)
    assertEquals(result.code, code)
    assertEquals(result.message.includes(copy), true)
    assertEquals(result.message.includes('provider detail'), false)
  }
})

Deno.test('provider network failure maps to a coded safe 503', () => {
  const result = mapTaxProviderUnavailableError(new TaxProviderUnavailableError())
  assertEquals(result, {
    status: 503,
    code: 'TAX_PROVIDER_UNAVAILABLE',
    message: 'Tax is temporarily unavailable. Please try sending the quote again in a moment.',
  })
  assertEquals(JSON.stringify(result).includes('dns'), false)
  assertEquals(JSON.stringify(result).includes('provider detail'), false)
})

Deno.test('no provider rate maps to non-retry copy with no provider details', () => {
  const result = mapTaxRateUnavailableError(new TaxRateUnavailableError())
  assertEquals(result, {
    status: 422,
    code: 'TAX_RATE_UNAVAILABLE_FOR_ADDRESS',
    message: 'Tax is unavailable for this delivery address. Check the delivery details or contact support.',
  })
  assertEquals(result.message.includes('try again'), false)
})
