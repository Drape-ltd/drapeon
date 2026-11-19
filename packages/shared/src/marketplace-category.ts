// Explore placement: where Drapeon shows a seller. Ops decides it; it is
// independent of the seller type a shop chooses in setup.
export const MARKETPLACE_CATEGORIES = ['TAILORING', 'READY_TO_WEAR'] as const

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number]

export const MARKETPLACE_CATEGORY_LABELS: Readonly<Record<MarketplaceCategory, string>> = {
  TAILORING: 'Tailors',
  READY_TO_WEAR: 'Ready-made',
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
  "Drapeon's team chooses where your shop appears. Tailors is for custom orders; Ready-made is for finished pieces and curated shops."

export const EXPLORE_SECTION_CONTROL_LABEL = 'Explore section'

export function suggestedExploreSection(profile: {
  sellerType?: string | null
  supportsCustomOrders?: boolean | null
}): { category: MarketplaceCategory; reason: string } {
  if (profile.supportsCustomOrders !== true) return { category: 'READY_TO_WEAR', reason: 'custom orders off' }
  if (profile.sellerType?.toUpperCase() === 'BOUTIQUE') return { category: 'READY_TO_WEAR', reason: 'boutique' }
  return { category: 'TAILORING', reason: 'custom orders on' }
}

export function shouldNudgeReadyMadeItems(category: MarketplaceCategory, publicItemCount: number | null): boolean {
  return category === 'READY_TO_WEAR' && publicItemCount === 0
}

export function exploreSectionMoveNotice(category: MarketplaceCategory) {
  const section = placementLabel(category)
  const message = `You now appear in ${section} on Explore`
  return {
    title: 'Your Explore section changed',
    message,
    reviewLabel: 'Request a review',
    reviewPath: '/account/support',
    reviewUrl: 'https://drapeon.co/account/support',
  }
}

export function exploreSectionPushPayload(category: MarketplaceCategory, dedupeKey: string) {
  const notice = exploreSectionMoveNotice(category)
  const exploreUrl = category === 'READY_TO_WEAR'
    ? 'https://drapeon.co/explore?filter=ready-made'
    : 'https://drapeon.co/explore'
  return {
    title: notice.title,
    body: notice.message,
    data: { type: 'explore_section_moved', exploreSectionMove: category, url: exploreUrl },
    communication: {
      category: 'SUPPORT' as const,
      purpose: 'OPERATIONAL' as const,
      severity: 'NOTICE' as const,
      mandatory: true,
      inApp: true,
      strictInApp: true,
      destinationKey: 'SUPPORT_CASE',
      deduplicationKey: dedupeKey,
    },
  }
}

function exploreSectionMoveCategoryFromJob(payload: Record<string, unknown>): MarketplaceCategory | null {
  if (payload.eventType !== 'explore_section_moved') return null
  const category = parseMarketplaceCategory(payload.exploreSectionMove)
  if (!category) throw new Error('Invalid Explore section move category')
  return category
}

export function exploreSectionMovePushForJob(payload: Record<string, unknown>, dedupeKey: string) {
  const category = exploreSectionMoveCategoryFromJob(payload)
  return category ? exploreSectionPushPayload(category, dedupeKey) : null
}

export function exploreSectionMoveEmailForJob(payload: Record<string, unknown>) {
  const category = exploreSectionMoveCategoryFromJob(payload)
  return category ? exploreSectionMoveNotice(category) : null
}
