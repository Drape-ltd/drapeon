import * as SecureStore from 'expo-secure-store'

const KEY = 'drapeon.tailor-claim-resume.v1'
const VERIFIED_EMAIL_KEY = 'drapeon.tailor-claim-verified-email.v1'
const MAX_AGE_MS = 10 * 60 * 1000

export type ClaimResume = {
  token: string
  sessionId: string
  email: string
  password?: string
  step: 'password' | 'details'
  savedAt: number
}

export async function saveTailorClaimResume(value: Omit<ClaimResume, 'savedAt'>) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ ...value, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export async function saveVerifiedClaimEmail(token: string, email: string) {
  try {
    await SecureStore.setItemAsync(
      VERIFIED_EMAIL_KEY,
      JSON.stringify({ token, email, savedAt: Date.now() })
    )
    return true
  } catch {
    return false
  }
}

export async function getVerifiedClaimEmail(token: string) {
  try {
    const raw = await SecureStore.getItemAsync(VERIFIED_EMAIL_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as { token?: string; email?: string; savedAt?: number }
    if (
      value.token === token &&
      typeof value.email === 'string' &&
      typeof value.savedAt === 'number' &&
      Date.now() - value.savedAt <= MAX_AGE_MS
    )
      return value.email
  } catch {
    // The server still decides whether this bootstrap can resume.
  }
  return null
}

export async function getTailorClaimResume(token: string, sessionId: string) {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as ClaimResume
    if (
      value.token === token &&
      value.sessionId === sessionId &&
      typeof value.email === 'string' &&
      (value.step === 'password' || value.step === 'details') &&
      typeof value.savedAt === 'number' &&
      Date.now() - value.savedAt <= MAX_AGE_MS
    )
      return value
  } catch {
    // Invalid secure storage cannot grant claim access.
  }
  await SecureStore.deleteItemAsync(KEY).catch(() => {})
  return null
}

export async function clearTailorClaimResume() {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY).catch(() => {}),
    SecureStore.deleteItemAsync(VERIFIED_EMAIL_KEY).catch(() => {}),
  ])
}
