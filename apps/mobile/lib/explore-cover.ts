import { resolveMarketplaceExploreCover, type MarketplaceMedia } from '@drape/shared'
import type { StorageImageBucket } from '@/lib/image-url'

// Keep Explore's two-column covers in the same frame as Wishlist collections.
export const EXPLORE_COVER_ASPECT_RATIO = 1.08
export const EXPLORE_COVER_POSITION = 'top center' as const

type ExploreCoverSource = {
  portfolio_photo_urls?: unknown
  media?: MarketplaceMedia[] | null
  explore_image_url?: string | null
  explore_image_bucket?: StorageImageBucket | null
  avatar_url?: string | null
}

export function resolveExploreCover(source: ExploreCoverSource): {
  uri: string | null
  bucket: StorageImageBucket | null
} {
  const cover = resolveMarketplaceExploreCover({
    portfolioPhotoUrls: source.portfolio_photo_urls,
    media: source.media,
    exploreImageUrl: source.explore_image_url,
    exploreImageBucket: source.explore_image_bucket === 'avatars' || source.explore_image_bucket === 'portfolio-photos'
      ? source.explore_image_bucket
      : null,
    avatarUrl: source.avatar_url,
  })

  return cover ? { uri: cover.url, bucket: cover.bucket } : { uri: null, bucket: null }
}
