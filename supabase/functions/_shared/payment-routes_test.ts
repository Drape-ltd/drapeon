import {
  isRouteSupportedByCurrentCheckout,
  paymentDeliveryReadinessReasons,
  paymentRouteEnvironment,
} from './payment-routes.ts'

Deno.test('payment routing treats local and the configured Dev project as sandbox only', () => {
  if (paymentRouteEnvironment('http://127.0.0.1:54321') !== 'SANDBOX') {
    throw new Error('localhost must use sandbox-only routes')
  }
  if (paymentRouteEnvironment('https://pqptfuqogvrajozfsqzi.supabase.co') !== 'SANDBOX') {
    throw new Error('Dev project must use sandbox-only routes')
  }
  if (paymentRouteEnvironment('https://production-project.supabase.co') !== 'PRODUCTION') {
    throw new Error('unrecognized hosted projects must fail closed as production')
  }
})

Deno.test('delivery-country readiness enforces UK, US, Nigeria, and EU controls', () => {
  const reasons = (country: string, overrides: Record<string, unknown> = {}) =>
    paymentDeliveryReadinessReasons({
      country_code: country,
      version: 1,
      status: 'READY',
      domestic_only: false,
      vat_registration_ready: false,
      collect_vat_under_gbp_135: false,
      duties_customer_pays: false,
      ioss_reviewed: false,
      ...overrides,
    } as Parameters<typeof paymentDeliveryReadinessReasons>[0])

  const cases = [
    ['GB', ['UK_VAT_REGISTRATION_REQUIRED', 'UK_LOW_VALUE_VAT_RULE_REQUIRED']],
    ['US', ['US_CUSTOMER_DUTY_DISCLOSURE_REQUIRED']],
    ['NG', ['NIGERIA_DOMESTIC_RULE_REQUIRED']],
    ['DE', ['EU_IOSS_REVIEW_REQUIRED']],
  ] as const

  for (const [country, expected] of cases) {
    const actual = reasons(country)
    if (expected.some((reason) => !actual.includes(reason))) {
      throw new Error(`${country} missing readiness reasons: ${actual.join(', ')}`)
    }
  }

  if (reasons('GB', { vat_registration_ready: true, collect_vat_under_gbp_135: true }).length !== 0) {
    throw new Error('complete UK controls should be ready')
  }
  if (reasons('US', { duties_customer_pays: true }).length !== 0) {
    throw new Error('US duty disclosure should satisfy country readiness')
  }
  if (reasons('NG', { domestic_only: true }).length !== 0) {
    throw new Error('Nigeria domestic rule should satisfy country readiness')
  }
  if (reasons('DE', { ioss_reviewed: true }).length !== 0) {
    throw new Error('EU IOSS review should satisfy country readiness')
  }
})

Deno.test('the current checkout path never advertises Bachs as executable', () => {
  const bachsResolution = {
    available: true,
    environment: 'SANDBOX',
    route: { provider: 'BACHS' },
    deliveryRule: {},
    destination: {},
  } as unknown as Parameters<typeof isRouteSupportedByCurrentCheckout>[0]
  if (isRouteSupportedByCurrentCheckout(bachsResolution)) {
    throw new Error('Bachs must stay unavailable until its full payment path is wired')
  }

  const stripeResolution = {
    ...bachsResolution,
    route: { provider: 'STRIPE' },
  } as unknown as Parameters<typeof isRouteSupportedByCurrentCheckout>[0]
  if (!isRouteSupportedByCurrentCheckout(stripeResolution)) {
    throw new Error('The current Stripe path should remain available when the exact route is ready')
  }
})

Deno.test('legacy Paystack route data cannot reopen new checkout selection', () => {
  const legacyResolution = {
    available: true,
    environment: 'SANDBOX',
    route: { provider: 'PAYSTACK' },
    deliveryRule: {},
    destination: {},
  } as unknown as Parameters<typeof isRouteSupportedByCurrentCheckout>[0]

  if (isRouteSupportedByCurrentCheckout(legacyResolution)) {
    throw new Error('A historical Paystack provider must not be a selectable new route')
  }
})
