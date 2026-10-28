import {
  CUSTOM_ORDER_MAX_REFERENCE_PHOTOS,
  CUSTOM_ORDER_STYLE_ATTRIBUTES,
  REFERENCE_PHOTO_MAX_ATTRIBUTES,
  REFERENCE_PHOTO_NOTE_MAX_CHARS,
} from './custom-order-flow.ts'

// Re-exported so callers can reach the limits alongside the sanitizer. They live in
// custom-order-flow.ts because that module is import-free and therefore safe for the
// Deno Edge Functions to consume directly; this one is not.
export { REFERENCE_PHOTO_MAX_ATTRIBUTES, REFERENCE_PHOTO_NOTE_MAX_CHARS }

export type ReferencePhotoStyleAttribute = (typeof CUSTOM_ORDER_STYLE_ATTRIBUTES)[number]

export type ReferencePhotoAttribution = {
  photo: string
  attributes: ReferencePhotoStyleAttribute[]
  note?: string
}

const STYLE_ATTRIBUTE_SET = new Set<string>(CUSTOM_ORDER_STYLE_ATTRIBUTES)

export function isReferencePhotoStyleAttribute(value: unknown): value is ReferencePhotoStyleAttribute {
  return typeof value === 'string' && STYLE_ATTRIBUTE_SET.has(value)
}

function normalizeNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().replace(/\s+/gu, ' ')
  if (!trimmed) return undefined
  return trimmed.slice(0, REFERENCE_PHOTO_NOTE_MAX_CHARS)
}

function normalizeAttributes(value: unknown): ReferencePhotoStyleAttribute[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<ReferencePhotoStyleAttribute>()
  for (const entry of value) {
    if (!isReferencePhotoStyleAttribute(entry)) continue
    seen.add(entry)
    if (seen.size >= REFERENCE_PHOTO_MAX_ATTRIBUTES) break
  }
  // Emit in taxonomy order so the tailor always reads attributes in the same sequence.
  return CUSTOM_ORDER_STYLE_ATTRIBUTES.filter((attribute) => seen.has(attribute))
}

/**
 * Keeps only attributions that point at a photo actually attached to the brief, so a
 * stale attribution cannot survive the customer removing its photo.
 */
export function sanitizeReferencePhotoAttributions(
  value: unknown,
  referencePhotos: readonly string[] | null | undefined,
): ReferencePhotoAttribution[] {
  if (!Array.isArray(value)) return []

  const allowedPhotos = new Set(
    (referencePhotos ?? []).map((photo) => (typeof photo === 'string' ? photo.trim() : '')).filter(Boolean),
  )
  if (allowedPhotos.size === 0) return []

  const claimed = new Set<string>()
  const sanitized: ReferencePhotoAttribution[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const photo = typeof record.photo === 'string' ? record.photo.trim() : ''
    if (!photo || !allowedPhotos.has(photo) || claimed.has(photo)) continue

    const attributes = normalizeAttributes(record.attributes)
    const note = normalizeNote(record.note)
    if (attributes.length === 0 && !note) continue

    claimed.add(photo)
    sanitized.push(note ? { photo, attributes, note } : { photo, attributes })
    if (sanitized.length >= CUSTOM_ORDER_MAX_REFERENCE_PHOTOS) break
  }

  return sanitized
}

export function referencePhotoAttributionFor(
  attributions: readonly ReferencePhotoAttribution[] | null | undefined,
  photo: string | null | undefined,
): ReferencePhotoAttribution | null {
  if (!attributions || !photo) return null
  const target = photo.trim()
  if (!target) return null
  return attributions.find((entry) => entry.photo === target) ?? null
}

/**
 * One line per attributed photo for the tailor's brief dossier, indexed against the
 * photo order the customer submitted so "Photo 2" means the same thing on both sides.
 */
export function summarizeReferencePhotoAttributions(
  attributions: readonly ReferencePhotoAttribution[] | null | undefined,
  referencePhotos: readonly string[] | null | undefined,
): string[] {
  if (!attributions || attributions.length === 0) return []
  const photos = (referencePhotos ?? []).map((photo) => (typeof photo === 'string' ? photo.trim() : ''))

  const lines: string[] = []
  photos.forEach((photo, index) => {
    if (!photo) return
    const attribution = referencePhotoAttributionFor(attributions, photo)
    if (!attribution) return
    const parts = [`Photo ${index + 1}`]
    if (attribution.attributes.length > 0) parts.push(attribution.attributes.join(', '))
    if (attribution.note) parts.push(`"${attribution.note}"`)
    lines.push(parts.join(' — '))
  })
  return lines
}

export function countAttributedReferencePhotos(
  attributions: readonly ReferencePhotoAttribution[] | null | undefined,
): number {
  return attributions?.length ?? 0
}
