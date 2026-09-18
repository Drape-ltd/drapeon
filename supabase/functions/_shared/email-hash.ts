/** Privacy-safe email identity helpers for delivery suppression and measurement. */

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase()
}

export async function emailAddressHash(value: string): Promise<string> {
  const normalized = normalizeEmailAddress(value)
  if (!normalized || !normalized.includes('@')) throw new Error('A valid email address is required.')
  return sha256Hex(normalized)
}
