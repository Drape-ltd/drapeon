/** Preserve normal keys; hash unsafe values so retries keep one stable provider key. */
export async function resendIdempotencyHeader(value: string | null | undefined) {
  const key = value?.trim()
  if (!key) return null
  if (/^[\x21-\x7e]{1,256}$/u.test(key)) return key
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return `drapeon-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function requireAsciiEmailApiKey(value: string) {
  if (!/^[\x21-\x7e]+$/u.test(value)) throw new Error('RESEND_API_KEY contains an invalid HTTP header value.')
  return value
}
