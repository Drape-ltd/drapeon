import { orderBelongsToRole, orderRoleFilter } from '../src/order-role-scope'

describe('order role scope', () => {
  const userId = 'user-1'

  it('limits customers to customer-owned orders even when a tailor profile exists', () => {
    expect(orderRoleFilter({ userId, role: 'CUSTOMER', tailorProfileId: 'tailor-1' })).toBe(
      'customer_id.eq.user-1'
    )
    expect(
      orderBelongsToRole(
        { customer_id: 'other', tailor_id: userId, tailor_profile_id: 'tailor-1' },
        { userId, role: 'CUSTOMER', tailorProfileId: 'tailor-1' }
      )
    ).toBe(false)
  })

  it('allows a tailor user id or owned tailor profile id', () => {
    expect(orderRoleFilter({ userId, role: 'TAILOR', tailorProfileId: 'tailor-1' })).toBe(
      'tailor_id.eq.user-1,tailor_profile_id.eq.tailor-1'
    )
    expect(
      orderBelongsToRole(
        { customer_id: 'customer-1', tailor_profile_id: 'tailor-1' },
        { userId, role: 'TAILOR', tailorProfileId: 'tailor-1' }
      )
    ).toBe(true)
  })
})
