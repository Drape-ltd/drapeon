export type TailorSearchQuery = {
  specialty: string
  location: string
  general: string
}

/**
 * Turns the natural-language search patterns we show in Explore into
 * composable filters. Keep this deliberately small and deterministic so the
 * web, mobile, and read gateway agree on what "Suits in Lagos" means.
 */
export function parseTailorSearchQuery(input: string): TailorSearchQuery {
  const trimmed = input.replace(/\s+/gu, ' ').trim().slice(0, 80)
  const lower = trimmed.toLowerCase()

  const locationOnly = lower.match(/^(?:tailors?|sellers?)\s+in\s+(.+)$/u)
  if (locationOnly) {
    return { specialty: '', location: locationOnly[1]?.trim() ?? '', general: '' }
  }

  const specialtyAndLocation = trimmed.match(/^(.+?)\s+in\s+(.+)$/iu)
  if (specialtyAndLocation) {
    return {
      specialty: specialtyAndLocation[1]?.trim() ?? '',
      location: specialtyAndLocation[2]?.trim() ?? '',
      general: '',
    }
  }

  return { specialty: '', location: '', general: trimmed }
}
