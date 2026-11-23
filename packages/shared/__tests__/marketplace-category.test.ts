import {
  MARKETPLACE_CATEGORY_LABELS,
  MARKETPLACE_CATEGORY_SLUGS,
  canPlaceInTailors,
  exploreSectionMoveNotice,
  exploreSectionPushPayload,
  marketplaceCategoryExploreParam,
  marketplaceCategoryFromExploreParam,
  parseMarketplaceCategory,
  placementLabel,
  shouldNudgeReadyMadeItems,
  suggestedExploreSection,
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
    expect(MARKETPLACE_CATEGORY_LABELS.READY_TO_WEAR).toBe('Ready-made')
    expect(MARKETPLACE_CATEGORY_SLUGS.READY_TO_WEAR).toBe('ready-to-wear')
    expect(placementLabel(null)).toBe('Tailors')
    expect(Object.values(MARKETPLACE_CATEGORY_LABELS).join(' ')).not.toMatch(/streetwear/i)
  })

  it('allows Tailors only for sellers that take custom orders', () => {
    expect(canPlaceInTailors({ supports_custom_orders: true })).toBe(true)
    expect(canPlaceInTailors({ supportsCustomOrders: false })).toBe(false)
    expect(canPlaceInTailors({})).toBe(false)
  })

  it.each([
    [{ sellerType: 'TAILOR', supportsCustomOrders: false }, 'READY_TO_WEAR', 'custom orders off'],
    [{ sellerType: 'TAILOR_SHOP', supportsCustomOrders: false }, 'READY_TO_WEAR', 'custom orders off'],
    [{ sellerType: 'BOUTIQUE', supportsCustomOrders: true }, 'READY_TO_WEAR', 'boutique'],
    [{ sellerType: 'TAILOR', supportsCustomOrders: true }, 'TAILORING', 'custom orders on'],
    [{ sellerType: 'TAILOR_SHOP', supportsCustomOrders: true }, 'TAILORING', 'custom orders on'],
    [{ sellerType: null, supportsCustomOrders: true }, 'TAILORING', 'custom orders on'],
    [{ sellerType: 'UNKNOWN', supportsCustomOrders: true }, 'TAILORING', 'custom orders on'],
  ] as const)('suggests a section from existing data only', (profile, category, reason) => {
    expect(suggestedExploreSection(profile)).toEqual({ category, reason })
  })

  it.each(['TAILORING', 'READY_TO_WEAR'] as const)('builds a public move notice for %s without an Ops reason', (category) => {
    const notice = exploreSectionMoveNotice(category)
    expect(notice.message).toBe(`You now appear in ${placementLabel(category)} on Explore`)
    expect(notice.reviewPath).toBe('/account/support')
    expect(JSON.stringify(notice)).not.toMatch(/internal reason|curated after review/i)
    const push = exploreSectionPushPayload(category, `move-${category}`)
    expect(push.body).toBe(notice.message)
    expect(push.data).toEqual({
      type: 'explore_section_moved',
      exploreSectionMove: category,
      url: category === 'READY_TO_WEAR'
        ? 'https://drapeon.co/explore?filter=ready-made'
        : 'https://drapeon.co/explore',
    })
    expect(push.communication).toMatchObject({ inApp: true, strictInApp: true, category: 'SUPPORT', destinationKey: 'SUPPORT_CASE', deduplicationKey: `move-${category}` })
  })

  it('nudges a Ready-made seller only when a successful shop read has no public items', () => {
    expect(shouldNudgeReadyMadeItems('READY_TO_WEAR', 0)).toBe(true)
    expect(shouldNudgeReadyMadeItems('READY_TO_WEAR', 1)).toBe(false)
    expect(shouldNudgeReadyMadeItems('READY_TO_WEAR', null)).toBe(false)
    expect(shouldNudgeReadyMadeItems('TAILORING', 0)).toBe(false)
  })
})
