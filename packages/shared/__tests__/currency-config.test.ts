import {
  convertAccountCurrencyEstimate,
  currencySymbol,
  paymentRouteAvailabilityCopy,
  detectCurrencyPreference,
  extractRegionCodeFromLocale,
  hasSellerPayoutCurrencyMismatch,
  parseMajorCurrencyAmountToMinor,
  paymentReceiptOperatorLine,
  paymentRouteCardIssuerAllowed,
  resolvePaymentRoute,
  type DeliveryCountryRule,
  type PaymentRouteConfig,
  type PaymentRouteDestination,
  type PaymentRouteProvider,
  type OrderPaymentProvider,
  resolveSellerPayoutCurrency,
  resolveSellerOrderCurrency,
} from '../src/currency-config'
import { convertWithReferenceFxRates, parseReferenceFxRates } from '../src/reference-fx-rates'

describe('convertAccountCurrencyEstimate', () => {
  it('converts an NGN checkout total into the customer USD display preference', () => {
    expect(convertAccountCurrencyEstimate(11_760_000, 'NGN', 'USD')).toBe(7443)
  })

  it('preserves the amount when the currencies match', () => {
    expect(convertAccountCurrencyEstimate(11_760_000, 'NGN', 'NGN')).toBe(11_760_000)
  })
})

describe('reference FX display rates', () => {
  const expectedQuotes = ['USD', 'NGN', 'GBP'] as const

  it('parses dated USD-base Frankfurter v2 rows and converts minor units', () => {
    const parsed = parseReferenceFxRates(
      [
        { date: '2026-10-26', base: 'USD', quote: 'NGN', rate: 1500 },
        { date: '2026-10-26', base: 'USD', quote: 'GBP', rate: 0.75 },
      ],
      expectedQuotes
    )

    expect(parsed).toEqual({ date: '2026-10-26', rates: { USD: 1, NGN: 1500, GBP: 0.75 } })
    expect(convertWithReferenceFxRates(150_000, 'NGN', 'GBP', parsed!.rates)).toBe(75)
  })

  it('rejects absent, malformed, non-positive, and mixed-date quote legs', () => {
    expect(parseReferenceFxRates(null, expectedQuotes)).toBeNull()
    expect(
      parseReferenceFxRates(
        [{ date: '2026-10-26', base: 'USD', quote: 'NGN', rate: 1500 }],
        expectedQuotes
      )
    ).toBeNull()
    expect(
      parseReferenceFxRates(
        [
          { date: '2026-10-26', base: 'USD', quote: 'NGN', rate: 0 },
          { date: '2026-10-26', base: 'USD', quote: 'GBP', rate: 0.75 },
        ],
        expectedQuotes
      )
    ).toBeNull()
    expect(
      parseReferenceFxRates(
        [
          { date: '2026-10-26', base: 'USD', quote: 'NGN', rate: 1500 },
          { date: '2026-10-25', base: 'USD', quote: 'GBP', rate: 0.75 },
        ],
        expectedQuotes
      )
    ).toBeNull()
  })

  it('does not invent a conversion when either live quote is unavailable', () => {
    expect(convertWithReferenceFxRates(1000, 'NGN', 'GBP', { USD: 1, NGN: 1500 })).toBeNull()
  })
})

describe('paymentReceiptOperatorLine', () => {
  it('renders the legal operator captured on the accepted order', () => {
    expect(paymentReceiptOperatorLine('DRAPE_MARKETPLACE_LIMITED')).toBe(
      'Drapeon, operated by Drape Marketplace Limited'
    )
    expect(paymentReceiptOperatorLine('O4_GROUP_LLC')).toBe('Drapeon, operated by O4 GROUP LLC')
  })

  it('omits unknown or legacy snapshots rather than guessing an entity', () => {
    expect(paymentReceiptOperatorLine(null)).toBeNull()
    expect(paymentReceiptOperatorLine('PAYSTACK')).toBeNull()
  })
})

describe('provider type boundary', () => {
  it('retains Paystack for legacy orders but excludes it from new route configuration', () => {
    const acceptLegacyProvider = (_provider: OrderPaymentProvider) => true
    const acceptRouteProvider = (_provider: PaymentRouteProvider) => true

    expect(acceptLegacyProvider('PAYSTACK')).toBe(true)
    // @ts-expect-error Paystack is historical-only and must not be configured for new routes.
    expect(acceptRouteProvider('PAYSTACK')).toBe(true)
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
    feesCollector: 'PLATFORM',
    feeScheduleVersion: 'fees-2026-01',
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
    feesCollector: 'PLATFORM',
    feeScheduleVersion: 'fees-2026-01',
    confirmedCardIssuerCountries: [],
  }
  const readyRules: DeliveryCountryRule[] = [
    { id: 'ng-delivery-v1', countryCode: 'NG', version: 1, status: 'READY', readinessReasons: [] },
    { id: 'us-delivery-v1', countryCode: 'US', version: 1, status: 'READY', readinessReasons: [] },
  ]
  const destinations: PaymentRouteDestination[] = [
    {
      id: 'ng-bachs-destination',
      provider: 'BACHS',
      legalEntity: 'DRAPE_MARKETPLACE_LIMITED',
      countryCode: 'NG',
      currency: 'NGN',
      transfersEnabled: true,
      payoutsEnabled: true,
      feesCollector: 'PLATFORM',
      firstWithdrawalReviewStatus: 'CLEARED',
      active: true,
    },
    {
      id: 'us-stripe-destination',
      provider: 'STRIPE',
      legalEntity: 'O4_GROUP_LLC',
      countryCode: 'US',
      currency: 'USD',
      transfersEnabled: true,
      payoutsEnabled: true,
      feesCollector: 'PLATFORM',
      firstWithdrawalReviewStatus: 'CLEARED',
      active: true,
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

  it('gates a Nigerian tailor by the customer delivery-country rule', () => {
    const ukWithoutVatReadiness: DeliveryCountryRule = {
      id: 'gb-delivery-v1',
      countryCode: 'GB',
      version: 1,
      status: 'DISABLED',
      readinessReasons: ['UK_VAT_REGISTRATION_REQUIRED', 'UK_LOW_VALUE_VAT_RULE_REQUIRED'],
    }
    const usWithoutDutyDisclosure: DeliveryCountryRule = {
      id: 'us-delivery-v2',
      countryCode: 'US',
      version: 2,
      status: 'DISABLED',
      readinessReasons: ['US_CUSTOMER_DUTY_DISCLOSURE_REQUIRED'],
    }

    expect(
      resolve({ deliveryCountryCode: 'GB', deliveryCountryRules: [ukWithoutVatReadiness] })
    ).toMatchObject({ available: false, reason: 'DELIVERY_COUNTRY_UNAVAILABLE' })
    expect(
      resolve({ deliveryCountryCode: 'US', deliveryCountryRules: [usWithoutDutyDisclosure] })
    ).toMatchObject({ available: false, reason: 'DELIVERY_COUNTRY_UNAVAILABLE' })

    const readyUkRule: DeliveryCountryRule = {
      ...ukWithoutVatReadiness,
      id: 'gb-delivery-v2',
      version: 2,
      status: 'READY',
      readinessReasons: ['UK_TAX_THRESHOLD_IMPLEMENTATION_REQUIRED'],
    }
    expect(
      resolve({
        deliveryCountryCode: 'GB',
        deliveryCountryRules: [ukWithoutVatReadiness, readyUkRule],
      })
    ).toMatchObject({
      available: false,
      reason: 'DELIVERY_COUNTRY_UNAVAILABLE',
      detail: expect.stringContaining('treatment above £135'),
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

  it('uses only the newest route and delivery-rule versions', () => {
    const newerRoute = { ...ngnBachsRoute, id: 'ng-tailor-ngn-bachs-v2', version: 2 }
    expect(resolve({ routes: [ngnBachsRoute, newerRoute] })).toMatchObject({
      available: true,
      route: { id: 'ng-tailor-ngn-bachs-v2', version: 2 },
    })
    expect(
      resolve({ routes: [ngnBachsRoute, { ...newerRoute, status: 'DISABLED' }] })
    ).toMatchObject({ available: false, reason: 'ROUTE_DISABLED' })

    const newerDeliveryRule = { ...readyRules[0], version: 2, status: 'DISABLED' as const }
    expect(resolve({ deliveryCountryRules: [readyRules[0], newerDeliveryRule] })).toMatchObject({
      available: false,
      reason: 'DELIVERY_COUNTRY_UNAVAILABLE',
    })
  })

  it('fails closed when the latest route version is ambiguous', () => {
    const latestRoute = { ...ngnBachsRoute, version: 2 }
    expect(resolve({
      routes: [
        ngnBachsRoute,
        { ...latestRoute, id: 'ng-tailor-ngn-bachs-v2-a' },
        { ...latestRoute, id: 'ng-tailor-ngn-bachs-v2-b' },
      ],
    })).toMatchObject({ available: false, reason: 'ROUTE_UNCONFIGURED' })
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
      resolve({
        destinations: [{ ...destinations[0], firstWithdrawalReviewStatus: 'PENDING' }],
      })
    ).toMatchObject({ available: false, reason: 'DESTINATION_UNAVAILABLE' })
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

  it('keeps the issuer gate off until checkout has an issuer signal, with opt-in enforcement', () => {
    const enabledRoute = {
      ...ngnBachsRoute,
      status: 'ENABLED' as const,
      confirmedCardIssuerCountries: ['GB', 'US'],
    }
    // Quote acceptance has no card issuer yet, so it must not block here.
    expect(resolve({ routes: [enabledRoute] })).toMatchObject({ available: true })
    expect(resolve({ routes: [enabledRoute], enforceCardIssuerCountryGate: true })).toMatchObject({
      available: false,
      reason: 'CARD_ISSUER_UNCONFIRMED',
    })
    expect(resolve({ routes: [enabledRoute], enforceCardIssuerCountryGate: true, cardIssuerCountryCode: 'GB' })).toMatchObject({
      available: true,
    })
    expect(resolve({ routes: [enabledRoute], enforceCardIssuerCountryGate: true, cardIssuerCountryCode: 'NG' })).toMatchObject({
      available: false,
      reason: 'CARD_ISSUER_UNCONFIRMED',
    })
  })

  it('applies issuer gating only when explicitly enforced and requires a known confirmed issuer', () => {
    const input = {
      provider: 'BACHS' as const,
      confirmedCardIssuerCountries: ['NG', 'GB'],
      cardIssuerCountryCode: null,
    }
    expect(paymentRouteCardIssuerAllowed(input)).toBe(true)
    expect(paymentRouteCardIssuerAllowed({ ...input, enforceCardIssuerCountryGate: true })).toBe(false)
    expect(paymentRouteCardIssuerAllowed({ ...input, cardIssuerCountryCode: 'gb', enforceCardIssuerCountryGate: true })).toBe(true)
    expect(paymentRouteCardIssuerAllowed({ ...input, cardIssuerCountryCode: 'US', enforceCardIssuerCountryGate: true })).toBe(false)
    expect(paymentRouteCardIssuerAllowed({ ...input, provider: 'STRIPE', enforceCardIssuerCountryGate: true })).toBe(true)
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
    const ukCopy = paymentRouteAvailabilityCopy(resolve({
      deliveryCountryCode: 'GB',
      deliveryCountryRules: [{
        id: 'gb-delivery-v2',
        countryCode: 'GB',
        version: 2,
        status: 'READY',
        readinessReasons: ['UK_TAX_THRESHOLD_IMPLEMENTATION_REQUIRED'],
      }],
    }))
    expect(ukCopy.customerMessage).toBe('This tailor isn’t taking paid orders right now.')
    expect(ukCopy.tailorMessage).toContain('treatment above £135')
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
