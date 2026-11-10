import {
  MARKETPLACE_CATEGORY_LABELS,
  marketplaceCategoryFromExploreParam,
  parseMarketplaceCategory,
} from '../src/marketplace-category'

describe('marketplace categories', () => {
  it('parses only supported categories', () => {
    expect(parseMarketplaceCategory('streetwear')).toBe('STREETWEAR')
    expect(parseMarketplaceCategory('TAILORING')).toBe('TAILORING')
    expect(parseMarketplaceCategory('boutique')).toBeNull()
  })

  it('keeps tailoring as the backwards-compatible Explore default', () => {
    expect(marketplaceCategoryFromExploreParam(undefined)).toBe('TAILORING')
    expect(marketplaceCategoryFromExploreParam('unknown')).toBe('TAILORING')
    expect(MARKETPLACE_CATEGORY_LABELS.STREETWEAR).toBe('Streetwear')
  })
})
