import * as SecureStore from 'expo-secure-store'

const KEY = 'drapeon.pending-tailor-claim.v1'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const CLAIM_TOKEN = /^[A-Za-z0-9_-]{40,60}$/u

export async function savePendingTailorClaim(token: string): Promise<boolean> {
  if (!CLAIM_TOKEN.test(token)) return false
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ token, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export async function getPendingTailorClaim(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { token?: unknown; savedAt?: unknown }
    if (
      typeof value.token === 'string' &&
      CLAIM_TOKEN.test(value.token) &&
      typeof value.savedAt === 'number' &&
      Date.now() - value.savedAt <= MAX_AGE_MS
    ) {
      return value.token
    }
    await SecureStore.deleteItemAsync(KEY)
  } catch {
    // Invalid or unavailable secure storage must not block normal authentication.
  }
  return null
}

export async function clearPendingTailorClaim(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => {})
}
