import {
  buildEmailSmartLink,
  normalizeDrapeonAppUrl,
  normalizeEmailWebPath,
} from '../src/email-links'

describe('email smart links', () => {
  test('keeps supported web destinations and app targets encoded', () => {
    expect(
      buildEmailSmartLink(
        'https://drapeon.co/',
        '/account/orders/order-1?view=messages',
        'drape://orders/order-1'
      )
    ).toBe(
      'https://drapeon.co/open?next=%2Faccount%2Forders%2Forder-1%3Fview%3Dmessages&app=drape%3A%2F%2Forders%2Forder-1'
    )
  })

  test('fails closed for external or traversal destinations', () => {
    expect(normalizeEmailWebPath('https://evil.example/phish')).toBe('/explore')
    expect(normalizeEmailWebPath('//evil.example/phish')).toBe('/explore')
    expect(normalizeEmailWebPath('/account/../settings')).toBe('/explore')
    expect(normalizeDrapeonAppUrl('javascript:alert(1)')).toBeNull()
  })

  test('accepts the legacy scheme only as controlled handoff data', () => {
    expect(normalizeDrapeonAppUrl('drapeon://orders/order-1')).toBe('drape://orders/order-1')
  })
})
