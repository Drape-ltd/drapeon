// Imported by middleware/config tests: claim capabilities must never leak via
// referrers, caches, search indexing, or permissive third-party script policy.
export const CLAIM_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://*.supabase.co; media-src 'self' https://*.supabase.co; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
} as const
