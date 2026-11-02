import { normalizePostalCode, postalCodeMatchesRegion } from '../src/postal-code'

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
  })

  it('checks Canadian province prefixes', () => {
    expect(postalCodeMatchesRegion('K1A 0B1', 'CA', 'ON')).toBe(true)
    expect(postalCodeMatchesRegion('K1A 0B1', 'CA', 'BC')).toBe(false)
  })
})
