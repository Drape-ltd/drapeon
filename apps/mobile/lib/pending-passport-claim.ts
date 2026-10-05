import * as SecureStore from 'expo-secure-store'

const KEY = 'drapeon.pending-passport-claim.v1'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function savePendingPassportClaim(passportId: string): Promise<boolean> {
  if (!UUID.test(passportId)) return false
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ passportId, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export async function getPendingPassportClaim(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { passportId?: unknown; savedAt?: unknown }
    if (typeof value.passportId === 'string' && UUID.test(value.passportId) &&
        typeof value.savedAt === 'number' && Date.now() - value.savedAt <= MAX_AGE_MS) {
      return value.passportId
    }
    await SecureStore.deleteItemAsync(KEY)
  } catch {
    // A malformed or inaccessible pending link must not block normal login.
  }
  return null
}

export async function clearPendingPassportClaim(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => {})
}
