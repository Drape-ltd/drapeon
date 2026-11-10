export type MarketplaceCategory = 'TAILORING' | 'STREETWEAR'

export function marketplaceCategoryFromGatewayResponse(response: unknown): MarketplaceCategory {
  const category = (response as { data?: { profile?: { marketplaceCategory?: unknown } } } | null)?.data?.profile?.marketplaceCategory
  return category === 'STREETWEAR' ? 'STREETWEAR' : 'TAILORING'
}
