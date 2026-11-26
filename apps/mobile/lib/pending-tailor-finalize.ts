import * as SecureStore from 'expo-secure-store'

const KEY = 'drapeon.pending-tailor-finalize.v1'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export async function savePendingTailorFinalize(userId: string) {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ userId, savedAt: Date.now() }))
}

export async function getPendingTailorFinalize(userId: string) {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    if (!raw) return false
    const value = JSON.parse(raw) as { userId?: string; savedAt?: number }
    return value.userId === userId &&
      typeof value.savedAt === 'number' &&
      Date.now() - value.savedAt <= MAX_AGE_MS
  } catch {
    return false
  }
}

export async function clearPendingTailorFinalize() {
  await SecureStore.deleteItemAsync(KEY).catch(() => {})
}
