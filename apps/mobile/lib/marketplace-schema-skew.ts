export function isMarketplaceSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; message?: unknown }
  const code = typeof value.code === 'string' ? value.code.toUpperCase() : ''
  const message = typeof value.message === 'string' ? value.message : ''
  return (code === '42703' || code === 'PGRST204')
    && /column [\w.]*marketplace_category does not exist/i.test(message)
}

export type MarketplaceCategory = 'TAILORING' | 'STREETWEAR'

export function marketplaceCategoriesFromCapabilities(capabilities: unknown): MarketplaceCategory[] {
  if (!capabilities || typeof capabilities !== 'object') return []
  const categories = (capabilities as { categories?: unknown }).categories
  if (!Array.isArray(categories)) return []
  return categories.filter((category): category is MarketplaceCategory =>
    category === 'TAILORING' || category === 'STREETWEAR',
  )
}

export function marketplaceCategoriesForUi(capabilities: unknown): MarketplaceCategory[] {
  const supported = marketplaceCategoriesFromCapabilities(capabilities)
  return supported.includes('STREETWEAR') ? ['TAILORING', 'STREETWEAR'] : ['TAILORING']
}

export function marketplaceSearchSchemaFallback(
  error: unknown,
  category: MarketplaceCategory,
): 'legacy_tailoring' | 'empty' | 'error' {
  if (!isMarketplaceSchemaUnavailable(error)) return 'error'
  return category === 'TAILORING' ? 'legacy_tailoring' : 'empty'
}

export function marketplaceCategoryFromOptionalResult(result: {
  data?: { marketplace_category?: unknown } | null
  error?: unknown
}): 'TAILORING' | 'STREETWEAR' {
  if (result.error && !isMarketplaceSchemaUnavailable(result.error)) throw result.error
  return result.data?.marketplace_category === 'STREETWEAR' ? 'STREETWEAR' : 'TAILORING'
}
