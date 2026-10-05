import type { StorageImageBucket } from '@/lib/image-url'

// Keep Explore's two-column covers in the same frame as Wishlist collections.
export const EXPLORE_COVER_ASPECT_RATIO = 1.08
export const EXPLORE_COVER_POSITION = 'top center' as const

type ExploreCoverSource = {
  portfolio_photo_urls?: unknown
  explore_image_url?: string | null
  explore_image_bucket?: StorageImageBucket | null
  avatar_url?: string | null
}

export function resolveExploreCover(source: ExploreCoverSource): {
  uri: string | null
  bucket: StorageImageBucket | null
} {
  // Wishlist uses the first portfolio photo. The read gateway has already removed
  // blocked media from this list, so use that same approved photo on Explore.
  const photos = Array.isArray(source.portfolio_photo_urls)
    ? source.portfolio_photo_urls
    : []
  const firstPhoto = photos.find(
    (url): url is string => typeof url === 'string' && url.trim().length > 0,
  )
  if (firstPhoto) return { uri: firstPhoto, bucket: 'portfolio-photos' }

  if (source.explore_image_url?.trim()) {
    return {
      uri: source.explore_image_url,
      bucket: source.explore_image_bucket ?? 'portfolio-photos',
    }
  }

  if (source.avatar_url?.trim()) return { uri: source.avatar_url, bucket: 'avatars' }
  return { uri: null, bucket: null }
}
