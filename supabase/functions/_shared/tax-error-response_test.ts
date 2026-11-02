import { assertEquals } from 'jsr:@std/assert@1'
import { TaxResolutionError } from './tax.ts'
import { mapTaxResolutionError } from './tax-error-response.ts'

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
