export type MarketplaceMediaKind = 'IMAGE' | 'VIDEO'

export type MarketplaceMedia = {
  id: string
  kind: MarketplaceMediaKind
  url: string
  posterUrl: string | null
  width: number | null
  height: number | null
  focalX: number
  focalY: number
  altText: string | null
  isPrimary: boolean
  position: number
}

export type MarketplaceExploreCover = {
  url: string
  bucket: 'portfolio-photos' | 'avatars'
  source: 'portfolio' | 'media' | 'explore' | 'avatar'
}

const DRAPEON_BRAND_MARK_FILENAMES = new Set([
  'drapeon-mark.png',
  'drapeon-mark-green.png',
  'drapeon-mark.svg',
  'drapeon-mark-green.svg',
  'drapeon-logo.png',
  'drapeon-logo.svg',
  'icon.png',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
])

/** Identifies app-brand artwork that should not replace an available tailor portfolio photo. */
export function isDrapeonBrandMarkUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  const raw = value.trim().split(/[?#]/u, 1)[0] ?? ''
  let path = raw
  try {
    path = new URL(raw).pathname
  } catch {
    // Storage paths can be relative; the filename check below still applies.
  }
  const filename = path.split('/').pop()?.toLowerCase() ?? ''
  return DRAPEON_BRAND_MARK_FILENAMES.has(filename)
}

/** Selects a real marketplace image before an explore default or profile mark. */
export function resolveMarketplaceExploreCover(source: {
  portfolioPhotoUrls?: unknown
  media?: readonly Pick<MarketplaceMedia, 'kind' | 'url' | 'posterUrl' | 'position'>[] | null
  exploreImageUrl?: string | null
  exploreImageBucket?: 'portfolio-photos' | 'avatars' | null
  avatarUrl?: string | null
}): MarketplaceExploreCover | null {
  const portfolioPhotos = Array.isArray(source.portfolioPhotoUrls)
    ? source.portfolioPhotoUrls.filter((value): value is string => typeof value === 'string')
    : []
  const portfolioPhoto = portfolioPhotos.find((value) => {
    const url = value.trim()
    return url.length > 0 && !isDrapeonBrandMarkUrl(url)
  })?.trim()
  if (portfolioPhoto) return { url: portfolioPhoto, bucket: 'portfolio-photos', source: 'portfolio' }

  const orderedMedia = [...(source.media ?? [])].sort((a, b) => a.position - b.position)
  const mediaImage = orderedMedia.find((item) =>
    item.kind === 'IMAGE' && item.url.trim().length > 0 && !isDrapeonBrandMarkUrl(item.url),
  )
  if (mediaImage) return { url: mediaImage.url.trim(), bucket: 'portfolio-photos', source: 'media' }

  const videoPoster = orderedMedia.find((item) =>
    item.kind === 'VIDEO' && item.posterUrl?.trim() && !isDrapeonBrandMarkUrl(item.posterUrl),
  )?.posterUrl?.trim()
  if (videoPoster) return { url: videoPoster, bucket: 'portfolio-photos', source: 'media' }

  const exploreImage = source.exploreImageUrl?.trim()
  if (exploreImage && !isDrapeonBrandMarkUrl(exploreImage)) {
    return {
      url: exploreImage,
      bucket: source.exploreImageBucket ?? 'portfolio-photos',
      source: 'explore',
    }
  }

  const avatar = source.avatarUrl?.trim()
  if (avatar && !isDrapeonBrandMarkUrl(avatar)) {
    return { url: avatar, bucket: 'avatars', source: 'avatar' }
  }

  // Keep the app mark as a last resort when the profile has no real media. It
  // must never outrank a portfolio photo, structured image, video poster, or
  // real explore cover.
  const hasRealMedia = portfolioPhotos.some((value) => value.trim() && !isDrapeonBrandMarkUrl(value))
    || orderedMedia.some((item) => item.url.trim() && !isDrapeonBrandMarkUrl(item.url))
    || Boolean(exploreImage && !isDrapeonBrandMarkUrl(exploreImage))
  if (!hasRealMedia) {
    const brandCandidates: MarketplaceExploreCover[] = [
      ...(exploreImage && isDrapeonBrandMarkUrl(exploreImage)
        ? [{ url: exploreImage, bucket: source.exploreImageBucket ?? 'portfolio-photos', source: 'explore' as const }]
        : []),
      ...portfolioPhotos.flatMap((url) => url.trim() && isDrapeonBrandMarkUrl(url)
        ? [{ url: url.trim(), bucket: 'portfolio-photos' as const, source: 'portfolio' as const }]
        : []),
      ...orderedMedia.flatMap((item) => item.url.trim() && isDrapeonBrandMarkUrl(item.url)
        ? [{ url: item.url.trim(), bucket: 'portfolio-photos' as const, source: 'media' as const }]
        : []),
      ...(avatar && isDrapeonBrandMarkUrl(avatar)
        ? [{ url: avatar, bucket: 'avatars' as const, source: 'avatar' as const }]
        : []),
    ]
    if (brandCandidates.length > 0) return brandCandidates[0]!
  }

  return null
}

export function normalizeFocalPoint(value: unknown, fallback = 0.5): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

export function marketplaceMediaObjectPosition(media: Pick<MarketplaceMedia, 'focalX' | 'focalY'>): string {
  return `${normalizeFocalPoint(media.focalX) * 100}% ${normalizeFocalPoint(media.focalY) * 100}%`
}

export function marketplaceMediaContentPosition(media: Pick<MarketplaceMedia, 'focalX' | 'focalY'>) {
  return {
    left: `${normalizeFocalPoint(media.focalX) * 100}%`,
    top: `${normalizeFocalPoint(media.focalY) * 100}%`,
  }
}
