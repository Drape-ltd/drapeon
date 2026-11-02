import { normalizePostalCode, postalCodeMatchesRegion, validateDeliveryPostal } from '../src/postal-code'
import { normalizeTaxCountryCode } from '../src/tax'

describe('normalizePostalCode', () => {
  it('matches the entire US field', () => {
    expect(normalizePostalCode('12345', 'US')).toBe('12345')
    expect(normalizePostalCode('12345-6789', 'US')).toBe('12345-6789')
    expect(normalizePostalCode('12345 Main St', 'US')).toBeNull()
    expect(normalizePostalCode('Apt 10023', 'US')).toBeNull()
  })

  it('accepts Canadian codes with or without the space', () => {
    expect(normalizePostalCode('k1a 0b1', 'CA')).toBe('K1A 0B1')
    expect(normalizePostalCode('K1A0B1', 'CA')).toBe('K1A 0B1')
    expect(normalizePostalCode('Apt K1A 0B1', 'CA')).toBeNull()
    expect(normalizePostalCode('D1A 0B1', 'CA')).toBeNull()
  })

  it('checks Canadian province prefixes', () => {
    expect(postalCodeMatchesRegion('K1A 0B1', 'CA', 'ON')).toBe(true)
    expect(postalCodeMatchesRegion('K1A 0B1', 'CA', 'BC')).toBe(false)
    for (const region of ['Québec', 'QUÉBEC', 'Quebec', 'QC']) {
      expect(postalCodeMatchesRegion('H2X 1Y4', 'CA', region)).toBe(true)
    }
  })

  it('normalizes country names before clients decide whether postal data is required', () => {
    expect(normalizeTaxCountryCode('United States')).toBe('US')
    expect(normalizeTaxCountryCode('USA')).toBe('US')
    expect(normalizeTaxCountryCode('Canada')).toBe('CA')
  })

  it.each([
    [null, 'DELIVERY_POSTAL_CODE_REQUIRED'],
    ['Apt 10023', 'DELIVERY_POSTAL_CODE_INVALID'],
  ] as const)('rejects US postal value %s with %s', (postal, code) => {
    expect(validateDeliveryPostal('US', postal, 'TX')).toMatchObject({ ok: false, code })
  })

  it('rejects Canadian province mismatches and returns normalized success', () => {
    expect(validateDeliveryPostal('CA', 'H2X 1Y4', 'ON')).toMatchObject({
      ok: false,
      code: 'DELIVERY_POSTAL_REGION_MISMATCH',
    })
    expect(validateDeliveryPostal('CA', 'h2x1y4', 'Québec')).toEqual({ ok: true, normalized: 'H2X 1Y4' })
  })
})
