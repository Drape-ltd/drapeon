const OPTIONAL_POSTCODE_COUNTRIES = new Set(['GH', 'NG'])

export function claimPickupPostcodeRequired(countryCode: string | null | undefined): boolean {
  return !OPTIONAL_POSTCODE_COUNTRIES.has(countryCode?.trim().toUpperCase() ?? '')
}

export function claimPickupPostcodeValid(
  countryCode: string | null | undefined,
  postcode: string
): boolean {
  const length = postcode.trim().length
  return (
    length <= 32 && (length >= 2 || (length === 0 && !claimPickupPostcodeRequired(countryCode)))
  )
}
