export const MARKETPLACE_CATEGORIES = ['TAILORING', 'STREETWEAR'] as const

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number]

export const MARKETPLACE_CATEGORY_LABELS: Readonly<Record<MarketplaceCategory, string>> = {
  TAILORING: 'Tailors',
  STREETWEAR: 'Streetwear',
}

export const MARKETPLACE_CATEGORY_SLUGS: Readonly<Record<MarketplaceCategory, string>> = {
  TAILORING: 'tailors',
  STREETWEAR: 'streetwear',
}

export function parseMarketplaceCategory(value: unknown): MarketplaceCategory | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return MARKETPLACE_CATEGORIES.includes(normalized as MarketplaceCategory)
    ? (normalized as MarketplaceCategory)
    : null
}

export function marketplaceCategoryFromExploreParam(value: unknown): MarketplaceCategory {
  return typeof value === 'string' && value.trim().toLowerCase() === 'streetwear'
    ? 'STREETWEAR'
    : 'TAILORING'
}

export function marketplaceCategoryExploreParam(category: MarketplaceCategory): string | undefined {
  return category === 'STREETWEAR' ? 'streetwear' : undefined
}
