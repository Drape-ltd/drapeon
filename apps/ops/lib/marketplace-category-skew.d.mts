export type MarketplaceDecisionRow = {
  id: string
  from_category: string
  to_category: string
  reason: string
  actor: string
  created_at: string
}

export type MarketplaceCategoryProjection = {
  supported: boolean
  category: 'TAILORING' | 'READY_TO_WEAR'
  decisions: MarketplaceDecisionRow[]
}

export function isMarketplaceCategoryColumnUnavailable(error: unknown): boolean
export function marketplaceProjection(
  categoryResult: { data: { marketplace_category?: unknown } | null; error: unknown },
  decisionsResult: { data: MarketplaceDecisionRow[] | null; error: unknown },
): MarketplaceCategoryProjection
