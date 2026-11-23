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

// Database errors raised for Explore placement problems (ops_decide_verification,
// ops_set_marketplace_category and the tailor_profiles guard trigger).
const PLACEMENT_ERROR_CODES = ['PLACEMENT_REQUIRED', 'PLACEMENT_REQUIRES_CUSTOM_ORDERS', 'PLACEMENT_INVALID'] as const
export type PlacementErrorCode = typeof PLACEMENT_ERROR_CODES[number]

export function placementErrorFromMessage(message: string | null | undefined): { code: PlacementErrorCode; message: string } | null {
  const text = message ?? ''
  const code = PLACEMENT_ERROR_CODES.find((candidate) => text.startsWith(`${candidate}:`))
  if (!code) return null
  return { code, message: text.slice(code.length + 1).trim() }
}
