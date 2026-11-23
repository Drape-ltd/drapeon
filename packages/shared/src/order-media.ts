/**
 * Converts stored order-media references into an object path that can be signed
 * by the current Supabase project. Order media is private: delivery URLs are
 * intentionally not a durable data contract.
 */
export function orderMediaStoragePath(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw || /^(?:data|blob):/iu.test(raw)) return null

  const publicMarker = '/storage/v1/object/public/order-photos/'
  const signedMarker = '/storage/v1/object/sign/order-photos/'
  const marker = raw.includes(publicMarker)
    ? publicMarker
    : raw.includes(signedMarker)
      ? signedMarker
      : null

  const candidate = marker
    ? raw.slice(raw.indexOf(marker) + marker.length)
    : /^https?:\/\//iu.test(raw)
      ? null
      : raw.replace(/^\/+|^order-photos\//gu, '')

  if (!candidate) return null
  const path = candidate.split(/[?#]/u)[0]?.replace(/^\/+/, '') ?? ''
  return path && !path.includes('..') ? path : null
}
