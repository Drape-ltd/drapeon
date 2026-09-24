import {
  getVisibleProductUpdates,
  isProductUpdateVisible,
  PRODUCT_UPDATES,
} from '../src/product-updates'

describe('product update contract', () => {
  const now = new Date('2026-09-15T12:00:00Z')

  it('filters role-targeted updates without hiding the all-audience entry', () => {
    expect(getVisibleProductUpdates({ surface: 'web', role: 'CUSTOMER', now }).map((item) => item.id)).toEqual([
      'order-thread-2026-09',
      'fit-profile-2026-09',
    ])
    expect(getVisibleProductUpdates({ surface: 'web', role: 'TAILOR', now }).map((item) => item.id)).toEqual([
      'order-thread-2026-09',
      'ready-made-tailor-2026-09',
    ])
  })

  it('keeps future and archived updates out of the visible feed', () => {
    const future = { ...PRODUCT_UPDATES[0], publishedAt: '2026-09-16T00:00:00Z' }
    const archived = { ...PRODUCT_UPDATES[0], status: 'ARCHIVED' as const }
    expect(isProductUpdateVisible(future, { surface: 'web', now })).toBe(false)
    expect(isProductUpdateVisible(archived, { surface: 'web', now })).toBe(false)
  })

  it('requires an allowed surface and suppresses an expired entry', () => {
    const expiring = { ...PRODUCT_UPDATES[0], expiresAt: '2026-09-15T11:59:59Z' }
    expect(isProductUpdateVisible(PRODUCT_UPDATES[0], { surface: 'android', now })).toBe(true)
    expect(isProductUpdateVisible(PRODUCT_UPDATES[0], { surface: 'web', now: new Date('2026-09-11') })).toBe(false)
    expect(isProductUpdateVisible(expiring, { surface: 'web', now })).toBe(false)
  })
})
