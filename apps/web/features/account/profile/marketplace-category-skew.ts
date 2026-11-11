export type MarketplaceCategory = 'TAILORING' | 'READY_TO_WEAR'

export function marketplaceCategoryFromGatewayResponse(response: unknown): MarketplaceCategory {
  const category = (response as { data?: { profile?: { marketplaceCategory?: unknown } } } | null)?.data?.profile?.marketplaceCategory
  // STREETWEAR is the pre-rename value an older gateway can still return.
  return category === 'READY_TO_WEAR' || category === 'STREETWEAR' ? 'READY_TO_WEAR' : 'TAILORING'
}

export function marketplaceCategoryLabel(category: MarketplaceCategory): string {
  return category === 'READY_TO_WEAR' ? 'Ready-to-wear' : 'Tailors'
}

/** True only when the gateway actually reported a placement (an older gateway or database omits it). */
export function marketplaceCategoryReported(response: unknown): boolean {
  const category = (response as { data?: { profile?: { marketplaceCategory?: unknown } } } | null)?.data?.profile?.marketplaceCategory
  return category === 'TAILORING' || category === 'READY_TO_WEAR' || category === 'STREETWEAR'
}
