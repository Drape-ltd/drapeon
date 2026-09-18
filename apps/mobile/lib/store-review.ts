import AsyncStorage from '@react-native-async-storage/async-storage'
import { requireOptionalNativeModule } from 'expo'
import { capture } from '@/lib/analytics'

const REVIEW_REQUEST_STORAGE_KEY = 'drape.store-review.last-requested-at.v1'
const REVIEW_REQUEST_COOLDOWN_MS = 120 * 24 * 60 * 60 * 1000

type ReviewTrigger = 'custom_order_created'
type StoreReviewModule = {
  isAvailableAsync: () => Promise<boolean>
  requestReview: () => Promise<void>
}

// A review prompt is optional. Development clients can temporarily lag native
// dependencies, so never let its absence interrupt an order or profile screen.
const storeReview = requireOptionalNativeModule<StoreReviewModule>('ExpoStoreReview')

function hasActiveCooldown(lastRequestedAt: string | null, now: number) {
  if (!lastRequestedAt) return false

  const requestedAt = Date.parse(lastRequestedAt)
  return Number.isFinite(requestedAt) && now - requestedAt < REVIEW_REQUEST_COOLDOWN_MS
}

/**
 * Makes one best-effort, native review request after a meaningful success.
 *
 * The operating system decides whether to show its rating UI. We never infer
 * a rating or a completed review, and we do not place a satisfaction question
 * or rating gate in front of the native prompt.
 */
export async function requestReviewAfterMeaningfulSuccess(trigger: ReviewTrigger) {
  try {
    if (!storeReview) return

    const now = Date.now()
    const lastRequestedAt = await AsyncStorage.getItem(REVIEW_REQUEST_STORAGE_KEY)
    if (hasActiveCooldown(lastRequestedAt, now)) return

    const isAvailable = await storeReview.isAvailableAsync()
    if (!isAvailable) return

    // Record the attempt before calling the system API. iOS and Android may
    // silently decline to render their rate-limited review UI.
    await AsyncStorage.setItem(REVIEW_REQUEST_STORAGE_KEY, new Date(now).toISOString())
    capture('store_review_request_attempted', { trigger })
    await storeReview.requestReview()
  } catch {
    // Reviews are always opportunistic. A device or store failure must never
    // interrupt a successfully completed customer action.
  }
}
