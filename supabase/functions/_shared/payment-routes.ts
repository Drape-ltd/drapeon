import {
  resolvePaymentRoute,
  type AccountCurrencyCode,
  type DeliveryCountryRule,
  type PaymentFeesCollector,
  type PaymentLegalEntity,
  type PaymentRouteConfig,
  type PaymentRouteDestination,
  type PaymentRouteEnvironment,
  type PaymentRouteProvider,
  type PaymentRouteResolution,
} from '../../../packages/shared/src/currency-config.ts'

type RouteConfigRow = {
  id: string
  version: number
  status: 'ENABLED' | 'SANDBOX_ONLY' | 'DISABLED'
  provider: PaymentRouteProvider
  tailor_country_code: string
  charge_currency: AccountCurrencyCode
  payout_currency: AccountCurrencyCode
  legal_entity: PaymentLegalEntity
  fees_collector: PaymentFeesCollector
  fee_schedule_version: string
  confirmed_card_issuer_countries: string[] | null
}

type DeliveryRuleRow = {
  id: string
  country_code: string
  version: number
  status: 'READY' | 'DISABLED'
  domestic_only: boolean
  vat_registration_ready: boolean
  collect_vat_under_gbp_135: boolean
  duties_customer_pays: boolean
  ioss_reviewed: boolean
}

type DestinationRow = {
  id: string
  provider: PaymentRouteProvider
  legal_entity: PaymentLegalEntity
  country_code: string
  currency: AccountCurrencyCode
  transfers_enabled: boolean
  payouts_enabled: boolean
  fees_collector: PaymentFeesCollector
  first_withdrawal_review_status: 'PENDING' | 'CLEARED' | 'BLOCKED'
  active: boolean
}

export function paymentRouteEnvironment(supabaseUrl: string): PaymentRouteEnvironment {
  try {
    const host = new URL(supabaseUrl).hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('pqptfuqogvrajozfsqzi.')
    ) return 'SANDBOX'
  } catch {
    // Invalid or missing project URL is not a sandbox signal.
  }
  return 'PRODUCTION'
}

/**
 * Payout onboarding may only create a Stripe account for a country/currency
 * that already has an available Stripe route configuration. This is a setup
 * guard, not a provider selector: accepted orders still use resolvePaymentRoute.
 */
export function stripePayoutSetupRouteAvailable(input: {
  routes: Array<Pick<RouteConfigRow, 'id' | 'version' | 'status' | 'provider' | 'legal_entity' | 'tailor_country_code' | 'payout_currency' | 'charge_currency'>>
  environment: PaymentRouteEnvironment
  tailorCountryCode: string
  payoutCurrency: string
}): boolean {
  const country = input.tailorCountryCode.trim().toUpperCase()
  const currency = input.payoutCurrency.trim().toUpperCase()
  const candidates = input.routes.filter((route) =>
    route.provider === 'STRIPE' &&
    route.legal_entity === 'O4_GROUP_LLC' &&
    route.tailor_country_code.trim().toUpperCase() === country &&
    route.payout_currency.trim().toUpperCase() === currency
  )

  const latestByChargeCurrency = new Map<string, Pick<RouteConfigRow, 'id' | 'version' | 'status' | 'provider' | 'legal_entity' | 'tailor_country_code' | 'payout_currency' | 'charge_currency'>>()
  const ambiguousLatest = new Set<string>()
  for (const route of candidates) {
    const current = latestByChargeCurrency.get(route.charge_currency)
    if (!current || route.version > current.version) {
      latestByChargeCurrency.set(route.charge_currency, route)
      ambiguousLatest.delete(route.charge_currency)
    } else if (route.version === current.version && route.id !== current.id) {
      ambiguousLatest.add(route.charge_currency)
    }
  }

  for (const [chargeCurrency, route] of latestByChargeCurrency) {
    if (ambiguousLatest.has(chargeCurrency)) continue
    if (route.status === 'ENABLED' || (route.status === 'SANDBOX_ONLY' && input.environment === 'SANDBOX')) {
      return true
    }
  }
  return false
}

/** The current accepted-order/payment path is still Stripe-specific. */
export function isRouteSupportedByCurrentCheckout(
  resolution: PaymentRouteResolution,
): boolean {
  return resolution.available && resolution.route.provider === 'STRIPE'
}

export function paymentDeliveryReadinessReasons(row: DeliveryRuleRow): string[] {
  const country = row.country_code.trim().toUpperCase()
  const reasons: string[] = []
  if (row.status !== 'READY') reasons.push('DELIVERY_COUNTRY_DISABLED')
  if (country === 'GB' && !row.vat_registration_ready) reasons.push('UK_VAT_REGISTRATION_REQUIRED')
  if (country === 'GB' && !row.collect_vat_under_gbp_135) reasons.push('UK_LOW_VALUE_VAT_RULE_REQUIRED')
  if (country === 'US' && !row.duties_customer_pays) reasons.push('US_CUSTOMER_DUTY_DISCLOSURE_REQUIRED')
  if (country === 'NG' && !row.domestic_only) reasons.push('NIGERIA_DOMESTIC_RULE_REQUIRED')
  if (
    ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE',
      'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'].includes(country) &&
    !row.ioss_reviewed
  ) reasons.push('EU_IOSS_REVIEW_REQUIRED')
  return reasons
}

function mapRoute(row: RouteConfigRow): PaymentRouteConfig {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    provider: row.provider,
    tailorCountryCode: row.tailor_country_code,
    chargeCurrency: row.charge_currency,
    payoutCurrency: row.payout_currency,
    legalEntity: row.legal_entity,
    feesCollector: row.fees_collector,
    feeScheduleVersion: row.fee_schedule_version,
    confirmedCardIssuerCountries: row.confirmed_card_issuer_countries ?? [],
  }
}

function mapDeliveryRule(row: DeliveryRuleRow): DeliveryCountryRule {
  return {
    id: row.id,
    countryCode: row.country_code,
    version: row.version,
    status: row.status,
    readinessReasons: paymentDeliveryReadinessReasons(row),
  }
}

function mapDestination(row: DestinationRow): PaymentRouteDestination {
  return {
    id: row.id,
    provider: row.provider,
    legalEntity: row.legal_entity,
    countryCode: row.country_code,
    currency: row.currency,
    transfersEnabled: row.transfers_enabled,
    payoutsEnabled: row.payouts_enabled,
    feesCollector: row.fees_collector,
    firstWithdrawalReviewStatus: row.first_withdrawal_review_status,
    active: row.active,
  }
}

/**
 * Loads persisted route, delivery-country and destination data, then delegates
 * the only route decision to the shared resolver. Query failures throw so
 * callers can fail closed instead of interpreting a partial read as readiness.
 */
export async function resolveConfiguredPaymentRoute(input: {
  supabase: any
  supabaseUrl: string
  tailorProfileId: string
  tailorCountryCode: string
  customerChargeCurrency: string
  tailorPayoutCurrency: string
  deliveryCountryCode: string
  cardIssuerCountryCode?: string | null
}): Promise<PaymentRouteResolution> {
  const tailorCountryCode = input.tailorCountryCode.trim().toUpperCase()
  const deliveryCountryCode = input.deliveryCountryCode.trim().toUpperCase()
  const chargeCurrency = input.customerChargeCurrency.trim().toUpperCase()
  const payoutCurrency = input.tailorPayoutCurrency.trim().toUpperCase()

  const [routesResult, deliveryRulesResult, destinationsResult] = await Promise.all([
    input.supabase.from('payment_routes').select(
      'id,version,status,provider,tailor_country_code,charge_currency,payout_currency,legal_entity,fees_collector,fee_schedule_version,confirmed_card_issuer_countries',
    ).eq('tailor_country_code', tailorCountryCode)
      .eq('charge_currency', chargeCurrency)
      .eq('payout_currency', payoutCurrency),
    input.supabase.from('delivery_country_rules').select(
      'id,country_code,version,status,domestic_only,vat_registration_ready,collect_vat_under_gbp_135,duties_customer_pays,ioss_reviewed',
    ).eq('country_code', deliveryCountryCode),
    input.supabase.from('payout_destinations').select(
      'id,provider,legal_entity,country_code,currency,transfers_enabled,payouts_enabled,fees_collector,first_withdrawal_review_status,active',
    ).eq('tailor_profile_id', input.tailorProfileId),
  ])

  const queryError = routesResult.error ?? deliveryRulesResult.error ?? destinationsResult.error
  if (queryError) throw new Error(`PAYMENT_ROUTE_CONFIG_READ_FAILED:${queryError.message}`)

  return resolvePaymentRoute({
    routes: ((routesResult.data ?? []) as RouteConfigRow[]).map(mapRoute),
    deliveryCountryRules: ((deliveryRulesResult.data ?? []) as DeliveryRuleRow[]).map(mapDeliveryRule),
    destinations: ((destinationsResult.data ?? []) as DestinationRow[]).map(mapDestination),
    environment: paymentRouteEnvironment(input.supabaseUrl),
    tailorCountryCode,
    customerChargeCurrency: chargeCurrency,
    tailorPayoutCurrency: payoutCurrency,
    deliveryCountryCode,
    cardIssuerCountryCode: input.cardIssuerCountryCode,
  })
}
