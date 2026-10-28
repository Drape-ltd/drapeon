import {
  availableStripePayoutSetupOptions,
  isRouteSupportedByCurrentCheckout,
  paymentDeliveryReadinessReasons,
  paymentRouteEnvironment,
  resolveConfiguredPaymentRoute,
  stripePayoutSetupRouteAvailable,
} from './payment-routes.ts'
import { resolvePaymentRoute } from '../../../packages/shared/src/currency-config.ts'

Deno.test('payment routing treats local and the configured Dev project as sandbox only', () => {
  if (paymentRouteEnvironment('http://127.0.0.1:54321') !== 'SANDBOX') {
    throw new Error('localhost must use sandbox-only routes')
  }
  if (paymentRouteEnvironment('https://pqptfuqogvrajozfsqzi.supabase.co') !== 'SANDBOX') {
    throw new Error('Dev project must use sandbox-only routes')
  }
  for (const untrustedHost of [
    'https://pqptfuqogvrajozfsqzi.attacker.example',
    'https://pqptfuqogvrajozfsqzi.supabase.co.attacker.example',
    'http://pqptfuqogvrajozfsqzi.supabase.co',
  ]) {
    if (paymentRouteEnvironment(untrustedHost) !== 'UNKNOWN') {
      throw new Error(`Unrecognized host must remain unclassified: ${untrustedHost}`)
    }
  }
  if (paymentRouteEnvironment('https://production-project.supabase.co') !== 'UNKNOWN') {
    throw new Error('unrecognized hosted projects must remain unclassified')
  }
})

Deno.test('unknown project environments cannot enable paid routes or payout setup', () => {
  const unknownRoute = {
    id: 'unknown-environment-route',
    version: 1,
    status: 'ENABLED',
    provider: 'STRIPE',
    tailor_country_code: 'US',
    charge_currency: 'USD',
    payout_currency: 'USD',
    legal_entity: 'O4_GROUP_LLC',
  } as const

  if (stripePayoutSetupRouteAvailable({
    routes: [unknownRoute],
    environment: 'UNKNOWN',
    tailorCountryCode: 'US',
    payoutCurrency: 'USD',
  })) throw new Error('unknown environments must not enable Stripe payout setup')

  const resolution = resolvePaymentRoute({
    routes: [{
      id: 'unknown-environment-route', version: 1, status: 'ENABLED', provider: 'STRIPE',
      tailorCountryCode: 'US', chargeCurrency: 'USD', payoutCurrency: 'USD',
      legalEntity: 'O4_GROUP_LLC', feesCollector: 'PLATFORM', feeScheduleVersion: 'test-v1',
      confirmedCardIssuerCountries: [],
    }],
    deliveryCountryRules: [{
      id: 'us', countryCode: 'US', version: 1, status: 'READY', readinessReasons: [],
    }],
    destinations: [{
      id: 'stripe-us', provider: 'STRIPE', legalEntity: 'O4_GROUP_LLC', countryCode: 'US',
      currency: 'USD', transfersEnabled: true, payoutsEnabled: true, feesCollector: 'PLATFORM',
      firstWithdrawalReviewStatus: 'CLEARED', active: true,
    }],
    environment: 'UNKNOWN',
    tailorCountryCode: 'US', customerChargeCurrency: 'USD', tailorPayoutCurrency: 'USD',
    deliveryCountryCode: 'US',
  })
  if (resolution.available || resolution.reason !== 'ENVIRONMENT_UNRESOLVED') {
    throw new Error('unknown environments must block even an enabled payment route')
  }
})

Deno.test('unknown card issuer never blocks quote acceptance; explicit checkout gate fails closed', () => {
  const input = {
    routes: [{
      id: 'ng-bachs', version: 1, status: 'ENABLED' as const, provider: 'BACHS' as const,
      tailorCountryCode: 'NG', chargeCurrency: 'NGN' as const, payoutCurrency: 'NGN' as const,
      legalEntity: 'DRAPE_MARKETPLACE_LIMITED' as const, feesCollector: 'PLATFORM' as const,
      feeScheduleVersion: 'test-v1', confirmedCardIssuerCountries: [],
    }],
    deliveryCountryRules: [{ id: 'ng', countryCode: 'NG', version: 1, status: 'READY' as const, readinessReasons: [] }],
    destinations: [{
      id: 'bachs-ng', provider: 'BACHS' as const, legalEntity: 'DRAPE_MARKETPLACE_LIMITED' as const,
      countryCode: 'NG', currency: 'NGN' as const, transfersEnabled: true, payoutsEnabled: true,
      feesCollector: 'PLATFORM' as const, firstWithdrawalReviewStatus: 'CLEARED' as const, active: true,
    }],
    environment: 'PRODUCTION' as const,
    tailorCountryCode: 'NG', customerChargeCurrency: 'NGN', tailorPayoutCurrency: 'NGN', deliveryCountryCode: 'NG',
  }
  const acceptance = resolvePaymentRoute(input)
  if (!acceptance.available) throw new Error(`Unknown issuer must not block quote acceptance: ${acceptance.reason}`)
  const enforced = resolvePaymentRoute({ ...input, enforceCardIssuerCountryGate: true })
  if (enforced.available || enforced.reason !== 'CARD_ISSUER_UNCONFIRMED') {
    throw new Error('Explicit issuer gate must block an unconfirmed country')
  }
})

Deno.test('configured route resolution rejects unknown project URLs before reading route data', async () => {
  let readCalled = false
  const resolution = await resolveConfiguredPaymentRoute({
    supabase: {
      from() {
        readCalled = true
        throw new Error('must not query an unverified project')
      },
    },
    supabaseUrl: 'https://pqptfuqogvrajozfsqzi.attacker.example',
    tailorProfileId: 'tailor-id',
    tailorCountryCode: 'US',
    customerChargeCurrency: 'USD',
    tailorPayoutCurrency: 'USD',
    deliveryCountryCode: 'US',
  })

  if (readCalled || resolution.available || resolution.reason !== 'ENVIRONMENT_UNRESOLVED') {
    throw new Error('unknown project URL must fail closed before route-data access')
  }
})

Deno.test('missing persisted route configuration fails closed for every required table', async () => {
  const configTables = ['payment_routes', 'delivery_country_rules', 'payout_destinations']

  for (const failedTable of configTables) {
    const supabase = {
      from(table: string) {
        const response = table === failedTable
          ? Promise.resolve({ data: null, error: { message: `relation public.${table} does not exist` } })
          : Promise.resolve({ data: [], error: null })
        const query = {
          select() { return query },
          eq() { return query },
          then: response.then.bind(response),
        }
        return query
      },
    }

    let failedClosed = false
    try {
      await resolveConfiguredPaymentRoute({
        supabase,
        supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
        tailorProfileId: '00000000-0000-0000-0000-000000000001',
        tailorCountryCode: 'NG',
        customerChargeCurrency: 'NGN',
        tailorPayoutCurrency: 'NGN',
        deliveryCountryCode: 'NG',
      })
    } catch (error) {
      failedClosed = error instanceof Error && error.message.startsWith('PAYMENT_ROUTE_CONFIG_READ_FAILED:')
    }
    if (!failedClosed) throw new Error(`Missing ${failedTable} must not be treated as route readiness`)
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
    ['GB', ['UK_VAT_REGISTRATION_REQUIRED', 'UK_LOW_VALUE_VAT_RULE_REQUIRED', 'UK_TAX_THRESHOLD_IMPLEMENTATION_REQUIRED']],
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

  if (!reasons('GB', { vat_registration_ready: true, collect_vat_under_gbp_135: true }).includes('UK_TAX_THRESHOLD_IMPLEMENTATION_REQUIRED')) {
    throw new Error('UK must remain blocked until the threshold tax implementation and above-threshold treatment are reviewed')
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

Deno.test('Stripe payout onboarding requires an available configured country/currency route', () => {
  type SetupRoute = Parameters<typeof stripePayoutSetupRouteAvailable>[0]['routes'][number]
  const base: SetupRoute = {
    id: 'route-us-usd', version: 1, status: 'SANDBOX_ONLY', provider: 'STRIPE',
    legal_entity: 'O4_GROUP_LLC', tailor_country_code: 'US', payout_currency: 'USD',
    charge_currency: 'GBP',
  }
  const ready = (routes: SetupRoute[], environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX') =>
    stripePayoutSetupRouteAvailable({
      routes,
      environment,
      tailorCountryCode: 'US',
      payoutCurrency: 'USD',
    })

  if (!ready([base])) throw new Error('Sandbox-only US/USD route should permit sandbox payout onboarding')
  if (ready([base], 'PRODUCTION')) throw new Error('Sandbox-only route must not permit production payout onboarding')
  if (ready([], 'SANDBOX')) throw new Error('Missing route must not create a Stripe account')
  if (ready([{ ...base, tailor_country_code: 'GB' }])) throw new Error('A different tailor country must not match')
  if (ready([{ ...base, payout_currency: 'GBP' }])) throw new Error('A different payout currency must not match')
  if (ready([{ ...base, status: 'DISABLED' }])) throw new Error('Disabled route must not permit payout onboarding')
  if (ready([{ ...base, provider: 'BACHS' }])) throw new Error('Non-Stripe route must not permit Stripe onboarding')
  if (ready([base, { ...base, id: 'route-us-usd-duplicate' }])) throw new Error('Ambiguous latest route must fail closed')
  if (!ready([base, { ...base, id: 'route-us-usd-v2', version: 2, status: 'ENABLED' }])) {
    throw new Error('A newer available route version should permit onboarding')
  }
  if (ready([base, { ...base, id: 'route-us-usd-v2', version: 2, status: 'DISABLED' }])) {
    throw new Error('A newer disabled route must not fall back to a stale sandbox version')
  }
})

Deno.test('payout setup options are derived only from available latest Stripe routes', () => {
  type SetupRoute = Parameters<typeof availableStripePayoutSetupOptions>[0]['routes'][number]
  const routes: SetupRoute[] = [
    { id: 'us-usd-v1', version: 1, status: 'SANDBOX_ONLY', provider: 'STRIPE', legal_entity: 'O4_GROUP_LLC', tailor_country_code: 'US', payout_currency: 'USD', charge_currency: 'GBP' },
    { id: 'us-usd-disabled-v2', version: 2, status: 'DISABLED', provider: 'STRIPE', legal_entity: 'O4_GROUP_LLC', tailor_country_code: 'US', payout_currency: 'USD', charge_currency: 'GBP' },
    { id: 'gb-gbp-v1', version: 1, status: 'ENABLED', provider: 'STRIPE', legal_entity: 'O4_GROUP_LLC', tailor_country_code: 'GB', payout_currency: 'GBP', charge_currency: 'USD' },
    { id: 'ng-ngn-bachs', version: 1, status: 'SANDBOX_ONLY', provider: 'BACHS', legal_entity: 'DRAPE_MARKETPLACE_LIMITED', tailor_country_code: 'NG', payout_currency: 'NGN', charge_currency: 'NGN' },
    { id: 'ca-cad-wrong-entity', version: 1, status: 'ENABLED', provider: 'STRIPE', legal_entity: 'DRAPE_MARKETPLACE_LIMITED', tailor_country_code: 'CA', payout_currency: 'CAD', charge_currency: 'CAD' },
  ]

  const sandbox = availableStripePayoutSetupOptions({ routes, environment: 'SANDBOX' })
  if (JSON.stringify(sandbox) !== JSON.stringify([
    { provider: 'STRIPE', tailorCountryCode: 'GB', payoutCurrency: 'GBP' },
  ])) {
    throw new Error(`unexpected sandbox setup options: ${JSON.stringify(sandbox)}`)
  }

  const production = availableStripePayoutSetupOptions({ routes, environment: 'PRODUCTION' })
  if (JSON.stringify(production) !== JSON.stringify([
    { provider: 'STRIPE', tailorCountryCode: 'GB', payoutCurrency: 'GBP' },
  ])) {
    throw new Error(`unexpected production setup options: ${JSON.stringify(production)}`)
  }

  const sandboxRouteOnly: SetupRoute[] = [{ ...routes[0]!, id: 'us-usd-ready', version: 3, status: 'SANDBOX_ONLY' }]
  const sandboxOnly = availableStripePayoutSetupOptions({ routes: sandboxRouteOnly, environment: 'SANDBOX' })
  if (sandboxOnly.length !== 1 || sandboxOnly[0]?.tailorCountryCode !== 'US') {
    throw new Error('sandbox should expose a currently available sandbox-only route')
  }
  if (availableStripePayoutSetupOptions({ routes: sandboxRouteOnly, environment: 'PRODUCTION' }).length !== 0) {
    throw new Error('production must not expose a sandbox-only route')
  }
})
