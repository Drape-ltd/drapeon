/** Customer-facing copy derived only from the accepted delivery-country snapshot. */
export function customerDutyDisclosure(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null

  const value = snapshot as Record<string, unknown>
  if (
    typeof value.countryCode !== 'string' ||
    value.countryCode.trim().toUpperCase() !== 'US' ||
    value.dutiesCustomerPays !== true
  ) return null

  return 'Any customs duty not listed in this checkout total is paid by you to customs or the carrier. Drapeon does not add an unlisted duty charge automatically.'
}
