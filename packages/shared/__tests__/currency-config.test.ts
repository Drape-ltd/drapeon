import {
  convertAccountCurrencyEstimate,
  currencySymbol,
  paymentRouteAvailabilityCopy,
  detectCurrencyPreference,
  extractRegionCodeFromLocale,
  hasSellerPayoutCurrencyMismatch,
  parseMajorCurrencyAmountToMinor,
  resolvePaymentRoute,
  resolvePaymentProviderForCurrency,
  type DeliveryCountryRule,
  type PaymentRouteConfig,
  type PaymentRouteDestination,
  resolveSellerPayoutCurrency,
  resolveSellerOrderCurrency,
} from '../src/currency-config'

describe('convertAccountCurrencyEstimate', () => {
  it('converts an NGN checkout total into the customer USD display preference', () => {
    expect(convertAccountCurrencyEstimate(11_760_000, 'NGN', 'USD')).toBe(7443)
  })

  it('preserves the amount when the currencies match', () => {
    expect(convertAccountCurrencyEstimate(11_760_000, 'NGN', 'NGN')).toBe(11_760_000)
  })
})

describe('parseMajorCurrencyAmountToMinor', () => {
  it('converts customer-entered major amounts into stored minor units', () => {
    expect(parseMajorCurrencyAmountToMinor('120')).toBe(12000)
    expect(parseMajorCurrencyAmountToMinor('75,000')).toBe(7500000)
    expect(parseMajorCurrencyAmountToMinor('12.34')).toBe(1234)
  })

  it('rejects missing, non-positive, and over-precision amounts', () => {
    expect(parseMajorCurrencyAmountToMinor(null)).toBeNull()
    expect(parseMajorCurrencyAmountToMinor('0')).toBeNull()
    expect(parseMajorCurrencyAmountToMinor('12.345')).toBeNull()
  })
})

describe('extractRegionCodeFromLocale', () => {
  it('reads dash-delimited locales', () => {
    expect(extractRegionCodeFromLocale('en-CA')).toBe('CA')
    expect(extractRegionCodeFromLocale('en-NG')).toBe('NG')
  })

  it('reads underscore-delimited locales', () => {
    expect(extractRegionCodeFromLocale('fr_CA')).toBe('CA')
  })
})

describe('detectCurrencyPreference', () => {
  it('maps Canadian locale to CAD', () => {
    expect(detectCurrencyPreference({ locale: 'en-CA' })).toEqual({
      currency: 'CAD',
      source: 'DEVICE_LOCALE',
      regionCode: 'CA',
      usedFallback: false,
    })
  })

  it('maps Nigerian locale to NGN', () => {
    expect(detectCurrencyPreference({ locale: 'en-NG' }).currency).toBe('NGN')
  })

  it('prefers IP geolocation when available', () => {
    expect(detectCurrencyPreference({ locale: 'en-US', ipCountryCode: 'GH' })).toEqual({
      currency: 'GHS',
      source: 'IP_GEO',
      regionCode: 'GH',
      usedFallback: false,
    })
  })

  it('falls back to USD for unsupported regions', () => {
    expect(detectCurrencyPreference({ locale: 'en-ZA' })).toEqual({
      currency: 'USD',
      source: 'UNSUPPORTED_FALLBACK',
      regionCode: 'ZA',
      usedFallback: true,
    })
  })
})

describe('resolvePaymentProviderForCurrency', () => {
  it('routes every supported currency explicitly', () => {
    expect(resolvePaymentProviderForCurrency('NGN')).toBe('PAYSTACK')
    expect(resolvePaymentProviderForCurrency('GHS')).toBe('PAYSTACK')
    expect(resolvePaymentProviderForCurrency('KES')).toBe('PAYSTACK')
    expect(resolvePaymentProviderForCurrency('USD')).toBe('STRIPE')
    expect(resolvePaymentProviderForCurrency('GBP')).toBe('STRIPE')
    expect(resolvePaymentProviderForCurrency('EUR')).toBe('STRIPE')
    expect(resolvePaymentProviderForCurrency('CAD')).toBe('STRIPE')
  })
})

describe('resolvePaymentRoute', () => {
  const ngnBachsRoute: PaymentRouteConfig = {
    id: 'ng-tailor-ngn-bachs',
    version: 1,
    status: 'SANDBOX_ONLY',
    provider: 'BACHS',
    tailorCountryCode: 'NG',
    chargeCurrency: 'NGN',
    payoutCurrency: 'NGN',
    legalEntity: 'DRAPE_MARKETPLACE_LIMITED',
    confirmedCardIssuerCountries: [],
  }
  const usStripeRoute: PaymentRouteConfig = {
    id: 'us-tailor-usd-stripe',
    version: 1,
    status: 'SANDBOX_ONLY',
    provider: 'STRIPE',
    tailorCountryCode: 'US',
    chargeCurrency: 'USD',
    payoutCurrency: 'USD',
    legalEntity: 'O4_GROUP_LLC',
    confirmedCardIssuerCountries: [],
  }
  const readyRules: DeliveryCountryRule[] = [
    { countryCode: 'NG', version: 1, status: 'READY', readinessReasons: [] },
    { countryCode: 'US', version: 1, status: 'READY', readinessReasons: [] },
  ]
  const destinations: PaymentRouteDestination[] = [
    {
      id: 'ng-bachs-destination',
      provider: 'BACHS',
      countryCode: 'NG',
      currency: 'NGN',
      transfersEnabled: true,
      payoutsEnabled: true,
    },
    {
      id: 'us-stripe-destination',
      provider: 'STRIPE',
      countryCode: 'US',
      currency: 'USD',
      transfersEnabled: true,
      payoutsEnabled: true,
    },
  ]

  function resolve(overrides: Partial<Parameters<typeof resolvePaymentRoute>[0]> = {}) {
    return resolvePaymentRoute({
      routes: [ngnBachsRoute, usStripeRoute],
      deliveryCountryRules: readyRules,
      destinations,
      environment: 'SANDBOX',
      tailorCountryCode: 'NG',
      customerChargeCurrency: 'NGN',
      tailorPayoutCurrency: 'NGN',
      deliveryCountryCode: 'NG',
      ...overrides,
    })
  }

  it('allows the exact Bachs corridor only in sandbox', () => {
    expect(resolve({ cardIssuerCountryCode: 'GB' })).toMatchObject({
      available: true,
      route: { id: 'ng-tailor-ngn-bachs', provider: 'BACHS' },
    })
    expect(resolve({ environment: 'PRODUCTION', cardIssuerCountryCode: 'GB' })).toMatchObject({
      available: false,
      reason: 'ROUTE_SANDBOX_ONLY',
    })
  })

  it('does not infer or fall back to a corridor for another currency or country', () => {
    expect(resolve({ tailorCountryCode: 'GH' })).toMatchObject({
      available: false,
      reason: 'ROUTE_UNCONFIGURED',
    })
    expect(resolve({ customerChargeCurrency: 'USD' })).toMatchObject({
      available: false,
      reason: 'ROUTE_UNCONFIGURED',
    })
    expect(resolve({ tailorPayoutCurrency: 'USD' })).toMatchObject({
      available: false,
      reason: 'ROUTE_UNCONFIGURED',
    })
  })

  it('fails closed when route, destination, or delivery rule is disabled or ambiguous', () => {
    expect(resolve({ routes: [{ ...ngnBachsRoute, status: 'DISABLED' }] })).toMatchObject({
      available: false,
      reason: 'ROUTE_DISABLED',
    })
    expect(resolve({ destinations: [] })).toMatchObject({
      available: false,
      reason: 'DESTINATION_UNAVAILABLE',
    })
    expect(
      resolve({ destinations: [destinations[0], { ...destinations[0], id: 'duplicate' }] })
    ).toMatchObject({
      available: false,
      reason: 'DESTINATION_UNAVAILABLE',
    })
    expect(resolve({ deliveryCountryRules: [] })).toMatchObject({
      available: false,
      reason: 'DELIVERY_COUNTRY_UNAVAILABLE',
    })
    expect(resolve({ deliveryCountryRules: [readyRules[0], readyRules[0]] })).toMatchObject({
      available: false,
      reason: 'DELIVERY_COUNTRY_UNAVAILABLE',
    })
  })

  it('requires confirmed Bachs issuer countries before an enabled route can be used', () => {
    const enabledRoute = {
      ...ngnBachsRoute,
      status: 'ENABLED' as const,
      confirmedCardIssuerCountries: ['NG'],
    }
    expect(resolve({ routes: [enabledRoute], cardIssuerCountryCode: 'GB' })).toMatchObject({
      available: false,
      reason: 'CARD_ISSUER_UNCONFIRMED',
    })
    expect(resolve({ routes: [enabledRoute], cardIssuerCountryCode: 'NG' })).toMatchObject({
      available: true,
    })
  })

  it('allows a supported Stripe route in sandbox without borrowing another country destination', () => {
    expect(
      resolve({
        tailorCountryCode: 'US',
        customerChargeCurrency: 'USD',
        tailorPayoutCurrency: 'USD',
        deliveryCountryCode: 'US',
      })
    ).toMatchObject({ available: true, route: { provider: 'STRIPE', legalEntity: 'O4_GROUP_LLC' } })
    expect(
      resolve({
        tailorCountryCode: 'US',
        customerChargeCurrency: 'USD',
        tailorPayoutCurrency: 'USD',
        deliveryCountryCode: 'US',
        destinations: [],
      })
    ).toMatchObject({ available: false, reason: 'DESTINATION_UNAVAILABLE' })
  })

  it('uses one customer block message and actionable tailor guidance without raw reason codes', () => {
    const copy = paymentRouteAvailabilityCopy(resolve({ environment: 'PRODUCTION' }))
    expect(copy).toEqual({
      available: false,
      customerMessage: 'This tailor isn’t taking paid orders right now.',
      tailorMessage: 'This route is available only for testing; live paid orders are not open yet.',
    })
    expect(copy.customerMessage).not.toContain('ROUTE_')
    expect(
      paymentRouteAvailabilityCopy(
        resolve({
          destinations: [],
        })
      ).tailorMessage
    ).toBe('Complete payout setup and have transfer and withdrawal access verified.')
  })
})

describe('resolveSellerPayoutCurrency', () => {
  it('infers NGN when Paystack is configured but payout currency is missing', () => {
    expect(
      resolveSellerPayoutCurrency({
        payoutProvider: 'PAYSTACK',
        fallbackCurrency: 'USD',
      })
    ).toBe('NGN')
    expect(
      resolveSellerPayoutCurrency({
        hasPaystackRecipient: true,
        fallbackCurrency: 'USD',
      })
    ).toBe('NGN')
  })

  it('uses the verified payout route over an incompatible legacy payout currency', () => {
    expect(
      resolveSellerPayoutCurrency({
        payoutCurrency: 'USD',
        payoutProvider: 'PAYSTACK',
        hasPaystackRecipient: true,
        fallbackCurrency: 'USD',
      })
    ).toBe('NGN')
    expect(
      resolveSellerPayoutCurrency({
        payoutCurrency: 'NGN',
        payoutProvider: 'STRIPE',
        hasStripeConnectAccount: true,
        fallbackCurrency: 'GBP',
      })
    ).toBe('GBP')
  })

  it('keeps Stripe fallback inside Stripe-supported currencies', () => {
    expect(
      resolveSellerPayoutCurrency({
        payoutProvider: 'STRIPE',
        fallbackCurrency: 'GBP',
      })
    ).toBe('GBP')
    expect(
      resolveSellerPayoutCurrency({
        payoutProvider: 'STRIPE',
        fallbackCurrency: 'NGN',
      })
    ).toBe('USD')
  })
})

describe('resolveSellerOrderCurrency', () => {
  it('prefers item currency for ready-made checkout', () => {
    expect(
      resolveSellerOrderCurrency({
        itemCurrency: 'NGN',
        payoutCurrency: 'NGN',
        customerCurrency: 'USD',
      })
    ).toBe('NGN')
  })

  it('prefers payout currency for custom orders without an item currency', () => {
    expect(
      resolveSellerOrderCurrency({
        tailorCurrency: 'USD',
        payoutCurrency: 'NGN',
        customerCurrency: 'USD',
      })
    ).toBe('NGN')
  })

  it('uses Paystack payout routing before customer currency for custom orders', () => {
    expect(
      resolveSellerOrderCurrency({
        tailorCurrency: 'USD',
        payoutProvider: 'PAYSTACK',
        customerCurrency: 'USD',
      })
    ).toBe('NGN')
  })

  it('does not let stale USD payout currency override a Paystack destination', () => {
    expect(
      resolveSellerOrderCurrency({
        tailorCurrency: 'USD',
        payoutCurrency: 'USD',
        payoutAccountType: 'PAYSTACK',
        hasPaystackRecipient: true,
        customerCurrency: 'USD',
      })
    ).toBe('NGN')
  })

  it('falls back to customer currency only when the seller has no commerce currency', () => {
    expect(resolveSellerOrderCurrency({ customerCurrency: 'CAD' })).toBe('CAD')
  })
})

describe('hasSellerPayoutCurrencyMismatch', () => {
  it('blocks ready-made item currency that does not match payout currency', () => {
    expect(
      hasSellerPayoutCurrencyMismatch({
        itemCurrency: 'USD',
        payoutCurrency: 'NGN',
      })
    ).toBe(true)
  })

  it('blocks item currency mismatch when payout currency must be inferred from Paystack', () => {
    expect(
      hasSellerPayoutCurrencyMismatch({
        itemCurrency: 'USD',
        payoutProvider: 'PAYSTACK',
        fallbackCurrency: 'USD',
      })
    ).toBe(true)
  })

  it('allows matching item and payout currencies', () => {
    expect(
      hasSellerPayoutCurrencyMismatch({
        itemCurrency: 'NGN',
        payoutCurrency: 'NGN',
      })
    ).toBe(false)
  })
})

describe('currencySymbol', () => {
  it('uses CA$ for CAD', () => {
    expect(currencySymbol('CAD')).toBe('CA$')
  })
})
