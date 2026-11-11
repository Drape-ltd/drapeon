// Explore placement: where Drapeon shows a seller. Ops decides it; it is
// independent of the seller type a shop chooses in setup.
export const MARKETPLACE_CATEGORIES = ['TAILORING', 'READY_TO_WEAR'] as const

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number]

export const MARKETPLACE_CATEGORY_LABELS: Readonly<Record<MarketplaceCategory, string>> = {
  TAILORING: 'Tailors',
  READY_TO_WEAR: 'Ready-to-wear',
}

export const MARKETPLACE_CATEGORY_SLUGS: Readonly<Record<MarketplaceCategory, string>> = {
  TAILORING: 'tailors',
  READY_TO_WEAR: 'ready-to-wear',
}

// One-release compatibility: older clients and links still say "streetwear".
const LEGACY_ALIASES: Readonly<Record<string, MarketplaceCategory>> = {
  STREETWEAR: 'READY_TO_WEAR',
  'READY-TO-WEAR': 'READY_TO_WEAR',
  READYTOWEAR: 'READY_TO_WEAR',
  TAILORS: 'TAILORING',
}

export function parseMarketplaceCategory(value: unknown): MarketplaceCategory | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  if (MARKETPLACE_CATEGORIES.includes(normalized as MarketplaceCategory)) {
    return normalized as MarketplaceCategory
  }
  return LEGACY_ALIASES[normalized] ?? null
}

export function marketplaceCategoryFromExploreParam(value: unknown): MarketplaceCategory {
  return parseMarketplaceCategory(value) ?? 'TAILORING'
}

export function marketplaceCategoryExploreParam(category: MarketplaceCategory): string | undefined {
  return category === 'READY_TO_WEAR' ? MARKETPLACE_CATEGORY_SLUGS.READY_TO_WEAR : undefined
}

export function placementLabel(category: MarketplaceCategory | null | undefined): string {
  return MARKETPLACE_CATEGORY_LABELS[category ?? 'TAILORING']
}

// Tailors is the custom-order aisle; the database enforces the same rule.
export function canPlaceInTailors(profile: { supports_custom_orders?: boolean | null; supportsCustomOrders?: boolean | null }): boolean {
  return (profile.supports_custom_orders ?? profile.supportsCustomOrders) === true
}

export const PLACEMENT_SELLER_EXPLAINER =
  "Drapeon's team chooses where your shop appears. Tailors is for custom orders; Ready-to-wear is for ready-made pieces and new shops."
