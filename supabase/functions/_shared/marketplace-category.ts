export type MarketplaceCategory = 'TAILORING' | 'STREETWEAR'
export function resolveMarketplaceCategory(value: unknown): MarketplaceCategory {
  if (value === undefined || value === null || value === '') return 'TAILORING'
  if (typeof value !== 'string') throw new Error('INVALID_MARKETPLACE_CATEGORY')
  const normalized = value.trim().toUpperCase()
  if (normalized !== 'TAILORING' && normalized !== 'STREETWEAR') throw new Error('INVALID_MARKETPLACE_CATEGORY')
  return normalized
}
export function applyMarketplaceCategoryFilter<T extends { eq(column: string, value: string): T }>(builder: T, value: unknown): T {
  return builder.eq('marketplace_category', resolveMarketplaceCategory(value))
}
