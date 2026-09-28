const PRODUCTION_MEDIA_ORIGINS = Object.freeze([
  'https://auth.drapeon.co',
  'https://wkfsrunetmgjdtcurmoj.supabase.co',
])

function developmentMediaOrigin(value) {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : ''
  } catch {
    return ''
  }
}

/**
 * Build the Ops response policy. Production media origins are deliberately
 * deployment constants: a missing Worker environment binding must not turn
 * valid review evidence into broken browser images.
 *
 * @param {string} nonce
 * @param {{ development: boolean, configuredSupabaseUrl?: string | undefined }} runtime
 */
export function contentSecurityPolicy(nonce, runtime) {
  const development = runtime.development
  const localOrigin = development ? developmentMediaOrigin(runtime.configuredSupabaseUrl) : ''
  const mediaOrigins = [...PRODUCTION_MEDIA_ORIGINS, localOrigin].filter(Boolean).join(' ')
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    development ? "'unsafe-eval'" : '',
    'https://static.cloudflareinsights.com',
  ].filter(Boolean).join(' ')
  const connectSrc = [
    "'self'",
    'https://cloudflareinsights.com',
    development ? 'ws://localhost:*' : '',
    development ? 'ws://127.0.0.1:*' : '',
  ].filter(Boolean).join(' ')

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `img-src 'self' data: blob: ${mediaOrigins}`,
    `media-src 'self' blob: ${mediaOrigins}`,
    `script-src ${scriptSrc}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "form-action 'self'",
    development ? '' : 'upgrade-insecure-requests',
  ].filter(Boolean).join('; ')
}

export { PRODUCTION_MEDIA_ORIGINS }
