import {
  MARKETPLACE_CATEGORY_LABELS,
  MARKETPLACE_CATEGORY_SLUGS,
  canPlaceInTailors,
  marketplaceCategoryExploreParam,
  marketplaceCategoryFromExploreParam,
  parseMarketplaceCategory,
  placementLabel,
} from '../src/marketplace-category'

describe('Explore placement', () => {
  it('parses the two placements and the legacy aliases', () => {
    expect(parseMarketplaceCategory('TAILORING')).toBe('TAILORING')
    expect(parseMarketplaceCategory('ready_to_wear')).toBe('READY_TO_WEAR')
    expect(parseMarketplaceCategory('ready-to-wear')).toBe('READY_TO_WEAR')
    expect(parseMarketplaceCategory('streetwear')).toBe('READY_TO_WEAR')
    expect(parseMarketplaceCategory('STREETWEAR')).toBe('READY_TO_WEAR')
    expect(parseMarketplaceCategory('tailors')).toBe('TAILORING')
    expect(parseMarketplaceCategory('boutique')).toBeNull()
    expect(parseMarketplaceCategory(42)).toBeNull()
  })

  it('defaults Explore to Tailors and only links the secondary aisle', () => {
    expect(marketplaceCategoryFromExploreParam(undefined)).toBe('TAILORING')
    expect(marketplaceCategoryFromExploreParam('unknown')).toBe('TAILORING')
    expect(marketplaceCategoryFromExploreParam('ready-to-wear')).toBe('READY_TO_WEAR')
    expect(marketplaceCategoryExploreParam('TAILORING')).toBeUndefined()
    expect(marketplaceCategoryExploreParam('READY_TO_WEAR')).toBe('ready-to-wear')
  })

  it('labels placements without the old style name', () => {
    expect(MARKETPLACE_CATEGORY_LABELS.READY_TO_WEAR).toBe('Ready-to-wear')
    expect(MARKETPLACE_CATEGORY_SLUGS.READY_TO_WEAR).toBe('ready-to-wear')
    expect(placementLabel(null)).toBe('Tailors')
    expect(Object.values(MARKETPLACE_CATEGORY_LABELS).join(' ')).not.toMatch(/streetwear/i)
  })

  it('allows Tailors only for sellers that take custom orders', () => {
    expect(canPlaceInTailors({ supports_custom_orders: true })).toBe(true)
    expect(canPlaceInTailors({ supportsCustomOrders: false })).toBe(false)
    expect(canPlaceInTailors({})).toBe(false)
  })
})
