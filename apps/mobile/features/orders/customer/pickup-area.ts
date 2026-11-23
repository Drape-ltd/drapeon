/** The accepted order snapshot wins over a seller profile that may later change. */
export function pickupAreaFromOrderSnapshot(snapshot: unknown, legacyLocation: string | null): string | null {
  if (snapshot == null) return legacyLocation?.trim() || null
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) return null

  const origin = snapshot as Record<string, unknown>
  const city = typeof origin.city === 'string' ? origin.city.trim() : ''
  const region = typeof origin.regionCode === 'string' ? origin.regionCode.trim() : ''
  const country = typeof origin.countryCode === 'string' ? origin.countryCode.trim() : ''
  if (!city || !country) return null
  return region ? `${city}, ${region}` : `${city}, ${country}`
}
