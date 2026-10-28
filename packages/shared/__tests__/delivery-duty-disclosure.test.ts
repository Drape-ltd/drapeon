import { customerDutyDisclosure } from '../src/delivery-duty-disclosure'

describe('customerDutyDisclosure', () => {
  it('explains the US customer-pays rule from the accepted snapshot', () => {
    expect(customerDutyDisclosure({ countryCode: 'US', dutiesCustomerPays: true })).toMatch(
      /paid by you to customs or the carrier/u
    )
  })

  it.each([
    null,
    undefined,
    'US',
    [],
    { countryCode: 'NG', dutiesCustomerPays: true },
    { countryCode: 'US', dutiesCustomerPays: false },
    { countryCode: 'US', dutiesCustomerPays: 'true' },
  ])('does not infer or disclose a US duty rule from %j', (snapshot) => {
    expect(customerDutyDisclosure(snapshot)).toBeNull()
  })
})
