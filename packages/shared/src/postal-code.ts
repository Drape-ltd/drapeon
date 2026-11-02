export type PostalCountryCode = 'US' | 'CA'

const US_POSTAL_CODE = /^\d{5}(-\d{4})?$/u
const CA_POSTAL_CODE = /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJKLMNPRSTVWXYZ] ?\d[ABCEGHJKLMNPRSTVWXYZ]\d$/u

const CA_PROVINCE_PREFIXES: Record<string, readonly string[]> = {
  A: ['NL'], B: ['NS'], C: ['PE'], E: ['NB'],
  G: ['QC'], H: ['QC'], J: ['QC'],
  K: ['ON'], L: ['ON'], M: ['ON'], N: ['ON'], P: ['ON'],
  R: ['MB'], S: ['SK'], T: ['AB'], V: ['BC'], X: ['NT', 'NU'], Y: ['YT'],
}

const CA_REGION_CODES: Record<string, string> = {
  ALBERTA: 'AB', 'BRITISH COLUMBIA': 'BC', MANITOBA: 'MB', 'NEW BRUNSWICK': 'NB',
  'NEWFOUNDLAND AND LABRADOR': 'NL', 'NOVA SCOTIA': 'NS', 'NORTHWEST TERRITORIES': 'NT',
  NUNAVUT: 'NU', ONTARIO: 'ON', 'PRINCE EDWARD ISLAND': 'PE', QUEBEC: 'QC',
  SASKATCHEWAN: 'SK', YUKON: 'YT',
}

export function normalizePostalCode(
  value: string | null | undefined,
  countryCode: PostalCountryCode,
): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toUpperCase()
  if (countryCode === 'US') return US_POSTAL_CODE.test(trimmed) ? trimmed : null
  if (!CA_POSTAL_CODE.test(trimmed)) return null
  const compact = trimmed.replace(' ', '')
  return `${compact.slice(0, 3)} ${compact.slice(3)}`
}

export function postalCodeLabel(countryCode: string | null | undefined) {
  return countryCode?.trim().toUpperCase() === 'US' ? 'ZIP code' : 'Postal code'
}

export function postalCodeError(countryCode: string | null | undefined) {
  return countryCode?.trim().toUpperCase() === 'US'
    ? 'Enter a valid 5-digit US ZIP code (ZIP+4 is also accepted).'
    : 'Enter a valid Canadian postal code, for example K1A 0B1.'
}

export function postalCodeMatchesRegion(
  postalCode: string,
  countryCode: PostalCountryCode,
  regionCode: string | null | undefined,
): boolean {
  const normalized = normalizePostalCode(postalCode, countryCode)
  if (!normalized) return false
  const rawRegion = regionCode?.trim().normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
  const region = rawRegion ? (CA_REGION_CODES[rawRegion] ?? rawRegion) : ''
  if (!region) return true
  if (countryCode === 'US') {
    // Deferred: the repository has no authoritative, versioned ZIP-prefix-to-state
    // dataset. Hand-maintained ranges have exceptions and would reject valid money
    // flows. Exact ZIP/state validation belongs at the provider lookup boundary.
    return true
  }
  return CA_PROVINCE_PREFIXES[normalized.charAt(0)]?.includes(region) ?? false
}

export type DeliveryPostalValidation =
  | { ok: true; normalized: string | null }
  | {
    ok: false
    code: 'DELIVERY_POSTAL_CODE_REQUIRED' | 'DELIVERY_POSTAL_CODE_INVALID' | 'DELIVERY_POSTAL_REGION_MISMATCH'
    message: string
    normalized: null
  }

export function validateDeliveryPostal(
  countryCode: string | null | undefined,
  postalCode: string | null | undefined,
  regionCode: string | null | undefined,
): DeliveryPostalValidation {
  const country = countryCode?.trim().toUpperCase()
  if (country !== 'US' && country !== 'CA') {
    return { ok: true, normalized: postalCode?.trim() || null }
  }
  if (!postalCode?.trim()) {
    return {
      ok: false,
      code: 'DELIVERY_POSTAL_CODE_REQUIRED',
      message: postalCodeError(country),
      normalized: null,
    }
  }
  const normalized = normalizePostalCode(postalCode, country)
  if (!normalized) {
    return { ok: false, code: 'DELIVERY_POSTAL_CODE_INVALID', message: postalCodeError(country), normalized: null }
  }
  if (!postalCodeMatchesRegion(normalized, country, regionCode)) {
    return {
      ok: false,
      code: 'DELIVERY_POSTAL_REGION_MISMATCH',
      message: 'The postal code does not match the selected province.',
      normalized: null,
    }
  }
  return { ok: true, normalized }
}
