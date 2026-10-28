import {
  hostedCheckoutProviderFromUrl,
  isHostedCheckoutCompletion,
} from '../hosted-checkout'

describe('hosted payment checkout destinations', () => {
  it('accepts only HTTPS URLs on exact provider domains or their subdomains', () => {
    expect(hostedCheckoutProviderFromUrl('https://checkout.bachs.io/c/abc')).toBe('BACHS')
    expect(hostedCheckoutProviderFromUrl('https://checkout.paystack.com/pay/abc')).toBe('PAYSTACK')
    expect(hostedCheckoutProviderFromUrl('https://paystack.co/pay/abc')).toBe('PAYSTACK')
    expect(hostedCheckoutProviderFromUrl('http://checkout.bachs.io/c/abc')).toBeNull()
    expect(hostedCheckoutProviderFromUrl('https://evilbachs.io/c/abc')).toBeNull()
    expect(hostedCheckoutProviderFromUrl('https://bachs.io.attacker.test/c/abc')).toBeNull()
  })

  it('recognizes Bachs completion only at Drapeon return URLs with a checkout ID', () => {
    const expected = 'drape:///payment-redirect'
    expect(isHostedCheckoutCompletion(
      'https://drapeon.co/payments/return?checkout_id=chk_abc123', expected, 'BACHS',
    )).toBe(true)
    expect(isHostedCheckoutCompletion(
      'https://attacker.test/payments/return?checkout_id=chk_abc123', expected, 'BACHS',
    )).toBe(false)
    expect(isHostedCheckoutCompletion(
      'https://drapeon.co/payments/return?checkout_id=not-a-checkout', expected, 'BACHS',
    )).toBe(false)
    expect(isHostedCheckoutCompletion(
      'https://drapeon.co/payments/return?reference=ref_abc', expected, 'BACHS',
    )).toBe(false)
  })

  it('preserves Paystack reference returns and exact app-scheme return URLs', () => {
    const expected = 'drape:///payment-redirect'
    expect(isHostedCheckoutCompletion(
      'https://drapeon.co/payments/return?reference=ref_abc', expected, 'PAYSTACK',
    )).toBe(true)
    expect(isHostedCheckoutCompletion(
      'https://attacker.test/payments/return?reference=ref_abc', expected, 'PAYSTACK',
    )).toBe(false)
    expect(isHostedCheckoutCompletion(expected, expected, 'BACHS')).toBe(true)
    expect(isHostedCheckoutCompletion(
      'https://drapeon.co/payments/return?checkout_id=chk_abc', expected, 'PAYSTACK',
    )).toBe(false)
  })
})
