// Explore placement. Ops decides it; the database enforces who may be in Tailors.
export type MarketplaceCategory = 'TAILORING' | 'READY_TO_WEAR'

// One-release compatibility for older apps and links that still send "streetwear".
const ALIASES: Readonly<Record<string, MarketplaceCategory>> = {
  TAILORING: 'TAILORING',
  TAILORS: 'TAILORING',
  READY_TO_WEAR: 'READY_TO_WEAR',
  'READY-TO-WEAR': 'READY_TO_WEAR',
  STREETWEAR: 'READY_TO_WEAR',
}

export function resolveMarketplaceCategory(value: unknown): MarketplaceCategory {
  if (value === undefined || value === null || value === '') return 'TAILORING'
  if (typeof value !== 'string') throw new Error('INVALID_MARKETPLACE_CATEGORY')
  const resolved = ALIASES[value.trim().toUpperCase()]
  if (!resolved) throw new Error('INVALID_MARKETPLACE_CATEGORY')
  return resolved
}

export function applyMarketplaceCategoryFilter<T extends { eq(column: string, value: string): T }>(builder: T, value: unknown): T {
  return builder.eq('marketplace_category', resolveMarketplaceCategory(value))
}
