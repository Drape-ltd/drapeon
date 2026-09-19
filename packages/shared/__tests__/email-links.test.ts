import {
  buildEmailSmartLink,
  normalizeDrapeonAppUrl,
  normalizeEmailWebPath,
} from '../src/email-links'

describe('email smart links', () => {
  it('keeps safe destinations and normalizes legacy app schemes', () => {
    expect(buildEmailSmartLink('https://drapeon.co/', '/account/orders/123', 'drapeon://orders/123'))
      .toBe('https://drapeon.co/open?next=%2Faccount%2Forders%2F123&app=drape%3A%2F%2Forders%2F123')
  })

  it('fails closed for external web and app destinations', () => {
    expect(normalizeEmailWebPath('https://evil.example')).toBe('/explore')
    expect(normalizeEmailWebPath('//evil.example')).toBe('/explore')
    expect(normalizeDrapeonAppUrl('javascript:alert(1)')).toBeNull()
  })
})
