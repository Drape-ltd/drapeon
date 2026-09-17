import {
  PHONE_STORAGE_HINT,
  validateDispatchPhoneForProfile,
  normalizePhoneForStorage,
  validatePhoneForProfile,
} from '../src/phone'

describe('normalizePhoneForStorage', () => {
  it('treats an unprefixed ten-digit number as a US national number', () => {
    expect(normalizePhoneForStorage('7375550123')).toBe('+17375550123')
  })

  it('strips formatting from local numbers', () => {
    expect(normalizePhoneForStorage('080 1234 5678')).toBe('+2348012345678')
  })

  it('uses the US fallback for unprefixed ten-digit values', () => {
    expect(normalizePhoneForStorage('8012345678')).toBe('+18012345678')
  })

  it('keeps explicit E.164 numbers canonical', () => {
    expect(normalizePhoneForStorage('+234 801 234 5678')).toBe('+2348012345678')
  })

  it('normalizes 00-prefixed international numbers', () => {
    expect(normalizePhoneForStorage('0044 7700 900123')).toBe('+447700900123')
  })

  it('adds a leading plus to long international-looking numbers', () => {
    expect(normalizePhoneForStorage('2348012345678')).toBe('+2348012345678')
  })
})

describe('validatePhoneForProfile', () => {
  it('accepts a valid local number', () => {
    expect(validatePhoneForProfile('08012345678')).toBeNull()
  })

  it('accepts a valid international number', () => {
    expect(validatePhoneForProfile('+447700900123')).toBeNull()
  })

  it('accepts a ten-digit US national number', () => {
    expect(validatePhoneForProfile('6159642154')).toBeNull()
  })

  it('rejects very short values', () => {
    expect(validatePhoneForProfile('123')).toBe('Enter a valid phone number.')
  })
})

describe('validateDispatchPhoneForProfile', () => {
  it('accepts a valid international dispatch number', () => {
    expect(validateDispatchPhoneForProfile('+254712345678')).toBeNull()
  })

  it('rejects ambiguous dispatch numbers without a country code', () => {
    expect(validateDispatchPhoneForProfile('712345678')).toBe('Enter a valid phone number.')
  })
})

describe('PHONE_STORAGE_HINT', () => {
  it('nudges users toward a country code', () => {
    expect(PHONE_STORAGE_HINT).toContain('calling code')
  })
})
