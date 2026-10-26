import { majorToMinorUnits } from './money-units.ts'

export const SUPPORTED_ACCOUNT_CURRENCIES = [
  'NGN',
  'GHS',
  'KES',
  'USD',
  'GBP',
  'EUR',
  'CAD',
] as const
export type AccountCurrencyCode = (typeof SUPPORTED_ACCOUNT_CURRENCIES)[number]

/** USD-relative reference rates used only for clearly-labelled display estimates. */
export const ACCOUNT_CURRENCY_REFERENCE_RATES: Record<AccountCurrencyCode, number> = {
  USD: 1,
  GBP: 0.79,
  EUR: 0.92,
  NGN: 1580,
  GHS: 15.6,
  KES: 129,
  CAD: 1.36,
}

export function convertAccountCurrencyEstimate(
  amountMinorUnits: number,
  fromCurrency: AccountCurrencyCode,
  toCurrency: AccountCurrencyCode
) {
  const fromRate = ACCOUNT_CURRENCY_REFERENCE_RATES[fromCurrency]
  const toRate = ACCOUNT_CURRENCY_REFERENCE_RATES[toCurrency]
  return Math.round((amountMinorUnits / fromRate) * toRate)
}

export const PAYSTACK_ACCOUNT_CURRENCIES = ['NGN', 'GHS', 'KES'] as const
export const STRIPE_ACCOUNT_CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD'] as const

/** Providers eligible for new, explicitly configured payment routes. */
export type PaymentRouteProvider = 'STRIPE' | 'BACHS'
/** Provider values that can still appear on legacy order snapshots. */
export type OrderPaymentProvider = PaymentRouteProvider | 'PAYSTACK'
export type PaymentRouteStatus = 'ENABLED' | 'SANDBOX_ONLY' | 'DISABLED'
export type PaymentRouteEnvironment = 'SANDBOX' | 'PRODUCTION' | 'UNKNOWN'
export type PaymentLegalEntity = 'DRAPE_MARKETPLACE_LIMITED' | 'O4_GROUP_LLC'
export type PaymentFeesCollector = 'PLATFORM' | 'CONNECTED_ACCOUNT'
export type FirstWithdrawalReviewStatus = 'PENDING' | 'CLEARED' | 'BLOCKED'
export type CurrencySource = 'DEVICE_LOCALE' | 'IP_GEO' | 'USER_SELECTED' | 'UNSUPPORTED_FALLBACK'

/** Legal operator wording for customer/tailor payment receipts. Unknown legacy snapshots stay hidden. */
export function paymentReceiptOperatorLine(value: unknown): string | null {
  if (value === 'DRAPE_MARKETPLACE_LIMITED') return 'Drapeon, operated by Drape Marketplace Limited'
  if (value === 'O4_GROUP_LLC') return 'Drapeon, operated by O4 GROUP LLC'
  return null
}

/** Versioned route configuration consumed by the one shared route resolver. */
export type PaymentRouteConfig = {
  id: string
  version: number
  status: PaymentRouteStatus
  provider: PaymentRouteProvider
  tailorCountryCode: string
  chargeCurrency: AccountCurrencyCode
  payoutCurrency: AccountCurrencyCode
  legalEntity: PaymentLegalEntity
  feesCollector: PaymentFeesCollector
  feeScheduleVersion: string
  /** Card-issuer countries that have written provider approval for this route. */
  confirmedCardIssuerCountries: readonly string[]
}

/** Delivery rules are deliberately separate from payment corridors. */
export type DeliveryCountryRule = {
  id: string
  countryCode: string
  version: number
  status: 'READY' | 'DISABLED'
  readinessReasons: readonly string[]
}

export type PaymentRouteDestination = {
  id: string
  provider: PaymentRouteProvider
  legalEntity: PaymentLegalEntity
  countryCode: string
  currency: AccountCurrencyCode
  transfersEnabled: boolean
  payoutsEnabled: boolean
  feesCollector: PaymentFeesCollector
  firstWithdrawalReviewStatus: FirstWithdrawalReviewStatus
  active: boolean
}

export type PaymentRouteResolution =
  | {
      available: true
      environment: Exclude<PaymentRouteEnvironment, 'UNKNOWN'>
      route: PaymentRouteConfig
      deliveryRule: DeliveryCountryRule
      destination: PaymentRouteDestination
    }
  | {
      available: false
      reason:
        | 'INVALID_INPUT'
        | 'ENVIRONMENT_UNRESOLVED'
        | 'ROUTE_UNCONFIGURED'
        | 'ROUTE_DISABLED'
        | 'ROUTE_SANDBOX_ONLY'
        | 'DESTINATION_UNAVAILABLE'
        | 'CARD_ISSUER_UNCONFIRMED'
        | 'DELIVERY_COUNTRY_UNAVAILABLE'
      detail: string
    }

export type PaymentRouteAvailabilityCopy = {
  available: boolean
  customerMessage?: string
  tailorMessage?: string
}

export const DEFAULT_ACCOUNT_CURRENCY: AccountCurrencyCode = 'USD'
export const UNKNOWN_REGION_CODE = 'ZZ'

const EURO_REGION_CODES = new Set([
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
])

const DIRECT_REGION_CURRENCY_MAP: Record<string, AccountCurrencyCode> = {
  NG: 'NGN',
  GH: 'GHS',
  KE: 'KES',
  US: 'USD',
  GB: 'GBP',
  CA: 'CAD',
}

export function isSupportedAccountCurrency(
  value: string | null | undefined
): value is AccountCurrencyCode {
  return (
    typeof value === 'string' &&
    (SUPPORTED_ACCOUNT_CURRENCIES as readonly string[]).includes(value.trim().toUpperCase())
  )
}

export function normalizeAccountCurrency(
  value: string | null | undefined
): AccountCurrencyCode | null {
  if (!isSupportedAccountCurrency(value)) return null
  return value.trim().toUpperCase() as AccountCurrencyCode
}

export function parseMajorCurrencyAmountToMinor(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  try {
    const amountMinor = majorToMinorUnits(normalized, 'USD')
    return amountMinor > 0 ? amountMinor : null
  } catch {
    return null
  }
}

export function currencySymbol(currency: AccountCurrencyCode) {
  switch (currency) {
    case 'NGN':
      return '₦'
    case 'GHS':
      return 'GH₵'
    case 'KES':
      return 'KSh'
    case 'USD':
      return '$'
    case 'GBP':
      return '£'
    case 'EUR':
      return '€'
    case 'CAD':
      return 'CA$'
  }
}

export function currencyDisplayLabel(currency: AccountCurrencyCode) {
  switch (currency) {
    case 'NGN':
      return 'Nigerian Naira'
    case 'GHS':
      return 'Ghanaian Cedi'
    case 'KES':
      return 'Kenyan Shilling'
    case 'USD':
      return 'US Dollar'
    case 'GBP':
      return 'British Pound'
    case 'EUR':
      return 'Euro'
    case 'CAD':
      return 'Canadian Dollar'
  }
}

/**
 * Resolves one exact payment corridor and its independent delivery-country rule.
 * It never falls back to another provider, currency, destination or country.
 */
export function resolvePaymentRoute(input: {
  routes: readonly PaymentRouteConfig[]
  deliveryCountryRules: readonly DeliveryCountryRule[]
  destinations: readonly PaymentRouteDestination[]
  environment: PaymentRouteEnvironment
  tailorCountryCode: string
  customerChargeCurrency: string
  tailorPayoutCurrency: string
  deliveryCountryCode: string
  cardIssuerCountryCode?: string | null
}): PaymentRouteResolution {
  const tailorCountryCode = normalizeCountryCode(input.tailorCountryCode)
  const deliveryCountryCode = normalizeCountryCode(input.deliveryCountryCode)
  const cardIssuerCountryCode = input.cardIssuerCountryCode
    ? normalizeCountryCode(input.cardIssuerCountryCode)
    : null
  const chargeCurrency = normalizeAccountCurrency(input.customerChargeCurrency)
  const payoutCurrency = normalizeAccountCurrency(input.tailorPayoutCurrency)

  if (!tailorCountryCode || !deliveryCountryCode || !chargeCurrency || !payoutCurrency) {
    return {
      available: false,
      reason: 'INVALID_INPUT',
      detail: 'A supported currency and valid country codes are required.',
    }
  }

  if (input.environment === 'UNKNOWN') {
    return {
      available: false,
      reason: 'ENVIRONMENT_UNRESOLVED',
      detail: 'The payment environment could not be verified.',
    }
  }

  const candidates = input.routes.filter(
    (route) =>
      normalizeCountryCode(route.tailorCountryCode) === tailorCountryCode &&
      route.chargeCurrency === chargeCurrency &&
      route.payoutCurrency === payoutCurrency
  )
  const latestRouteVersion = candidates.reduce(
    (latest, candidate) => Math.max(latest, candidate.version),
    0
  )
  const currentRoutes = candidates.filter((candidate) => candidate.version === latestRouteVersion)
  const route = currentRoutes[0]
  if (currentRoutes.length !== 1 || !route) {
    return {
      available: false,
      reason: 'ROUTE_UNCONFIGURED',
      detail: 'No single exact payment route is configured for this corridor.',
    }
  }

  if (route.status === 'DISABLED') {
    return { available: false, reason: 'ROUTE_DISABLED', detail: 'This payment route is disabled.' }
  }
  if (route.status === 'SANDBOX_ONLY' && input.environment !== 'SANDBOX') {
    return {
      available: false,
      reason: 'ROUTE_SANDBOX_ONLY',
      detail: 'This payment route is available only for sandbox testing.',
    }
  }

  if (
    route.status === 'ENABLED' &&
    route.provider === 'BACHS' &&
    (!cardIssuerCountryCode ||
      !route.confirmedCardIssuerCountries.some(
        (country) => normalizeCountryCode(country) === cardIssuerCountryCode
      ))
  ) {
    return {
      available: false,
      reason: 'CARD_ISSUER_UNCONFIRMED',
      detail: 'The provider has not confirmed this card-issuer country for the route.',
    }
  }

  const destinations = input.destinations.filter(
    (destination) =>
      destination.provider === route.provider &&
      destination.legalEntity === route.legalEntity &&
      normalizeCountryCode(destination.countryCode) === tailorCountryCode &&
      destination.currency === route.payoutCurrency &&
      destination.feesCollector === route.feesCollector &&
      destination.firstWithdrawalReviewStatus === 'CLEARED' &&
      destination.active &&
      destination.transfersEnabled &&
      destination.payoutsEnabled
  )
  const destination = destinations[0]
  if (destinations.length !== 1 || !destination) {
    return {
      available: false,
      reason: 'DESTINATION_UNAVAILABLE',
      detail: 'A unique destination with transfer and payout capability is required.',
    }
  }

  const deliveryRules = input.deliveryCountryRules.filter(
    (rule) => normalizeCountryCode(rule.countryCode) === deliveryCountryCode
  )
  const latestDeliveryRuleVersion = deliveryRules.reduce(
    (latest, rule) => Math.max(latest, rule.version),
    0
  )
  const currentDeliveryRules = deliveryRules.filter(
    (rule) => rule.version === latestDeliveryRuleVersion
  )
  const deliveryRule = currentDeliveryRules[0]
  if (
    currentDeliveryRules.length !== 1 ||
    !deliveryRule ||
    deliveryRule.status !== 'READY' ||
    deliveryRule.readinessReasons.length > 0
  ) {
    return {
      available: false,
      reason: 'DELIVERY_COUNTRY_UNAVAILABLE',
      detail: 'Delivery to this country is not ready for paid orders.',
    }
  }

  return {
    available: true,
    environment: input.environment,
    route,
    deliveryRule,
    destination,
  }
}

/** Presentation copy for the resolver result; it does not make routing decisions. */
export function paymentRouteAvailabilityCopy(
  resolution: PaymentRouteResolution
): PaymentRouteAvailabilityCopy {
  if (resolution.available === true) return { available: true }

  const tailorMessages: Record<
    Extract<PaymentRouteResolution, { available: false }>['reason'],
    string
  > = {
    INVALID_INPUT: 'Check that your country and payout currency details are complete.',
    ENVIRONMENT_UNRESOLVED: 'Payment is temporarily unavailable while Drapeon verifies this connection.',
    ROUTE_UNCONFIGURED: 'Paid orders are not configured for this tailor country and currency yet.',
    ROUTE_DISABLED: 'This payment route is temporarily unavailable while Drapeon reviews it.',
    ROUTE_SANDBOX_ONLY:
      'This route is available only for testing; live paid orders are not open yet.',
    DESTINATION_UNAVAILABLE:
      'Complete payout setup and have transfer and withdrawal access verified.',
    CARD_ISSUER_UNCONFIRMED:
      'The provider has not confirmed support for this card-issuing country.',
    DELIVERY_COUNTRY_UNAVAILABLE:
      'Delivery rules for this destination country still need to be completed.',
  }

  return {
    available: false,
    customerMessage: 'This tailor isn’t taking paid orders right now.',
    tailorMessage: tailorMessages[resolution.reason],
  }
}

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

export function resolveSellerPayoutCurrency(input: {
  payoutCurrency?: string | null
  payoutProvider?: string | null
  payoutAccountType?: string | null
  hasPaystackRecipient?: boolean | null
  hasStripeConnectAccount?: boolean | null
  fallbackCurrency?: string | null
}): AccountCurrencyCode | null {
  const explicit = normalizeAccountCurrency(input.payoutCurrency)

  const provider = `${input.payoutProvider ?? ''} ${input.payoutAccountType ?? ''}`.toUpperCase()
  const isPaystackRoute = provider.includes('PAYSTACK') || input.hasPaystackRecipient
  const isStripeRoute =
    provider.includes('STRIPE') || provider.includes('CONNECT') || input.hasStripeConnectAccount

  if (isPaystackRoute) {
    return explicit && (PAYSTACK_ACCOUNT_CURRENCIES as readonly string[]).includes(explicit)
      ? explicit
      : 'NGN'
  }

  if (isStripeRoute) {
    const fallback = normalizeAccountCurrency(input.fallbackCurrency)
    if (explicit && (STRIPE_ACCOUNT_CURRENCIES as readonly string[]).includes(explicit))
      return explicit
    return fallback && (STRIPE_ACCOUNT_CURRENCIES as readonly string[]).includes(fallback)
      ? fallback
      : 'USD'
  }

  return explicit
}

export function resolveSellerOrderCurrency(input: {
  itemCurrency?: string | null
  tailorCurrency?: string | null
  payoutCurrency?: string | null
  payoutProvider?: string | null
  payoutAccountType?: string | null
  hasPaystackRecipient?: boolean | null
  hasStripeConnectAccount?: boolean | null
  customerCurrency?: string | null
}): AccountCurrencyCode {
  const payoutCurrency = resolveSellerPayoutCurrency({
    payoutCurrency: input.payoutCurrency,
    payoutProvider: input.payoutProvider,
    payoutAccountType: input.payoutAccountType,
    hasPaystackRecipient: input.hasPaystackRecipient,
    hasStripeConnectAccount: input.hasStripeConnectAccount,
    fallbackCurrency: input.tailorCurrency,
  })

  return (
    normalizeAccountCurrency(input.itemCurrency) ??
    payoutCurrency ??
    normalizeAccountCurrency(input.tailorCurrency) ??
    normalizeAccountCurrency(input.customerCurrency) ??
    DEFAULT_ACCOUNT_CURRENCY
  )
}

export function hasSellerPayoutCurrencyMismatch(input: {
  itemCurrency?: string | null
  payoutCurrency?: string | null
  payoutProvider?: string | null
  payoutAccountType?: string | null
  hasPaystackRecipient?: boolean | null
  hasStripeConnectAccount?: boolean | null
  fallbackCurrency?: string | null
}): boolean {
  const itemCurrency = normalizeAccountCurrency(input.itemCurrency)
  const payoutCurrency = resolveSellerPayoutCurrency(input)
  if (!itemCurrency || !payoutCurrency) return false
  return itemCurrency !== payoutCurrency
}

export function extractRegionCodeFromLocale(locale: string | null | undefined): string | null {
  if (typeof locale !== 'string' || locale.trim().length === 0) return null
  const normalized = locale.trim().replace('_', '-')
  const parts = normalized.split('-')
  const regionCandidate = parts[1] ?? ''
  if (!/^[A-Za-z]{2}$/.test(regionCandidate)) return null
  return regionCandidate.toUpperCase()
}

export function currencyForRegionCode(
  regionCode: string | null | undefined
): AccountCurrencyCode | null {
  if (typeof regionCode !== 'string' || regionCode.trim().length !== 2) return null
  const normalized = regionCode.trim().toUpperCase()
  const directCurrency =
    DIRECT_REGION_CURRENCY_MAP[normalized as keyof typeof DIRECT_REGION_CURRENCY_MAP] ?? null
  if (directCurrency) {
    return directCurrency
  }
  if (EURO_REGION_CODES.has(normalized)) {
    return 'EUR'
  }
  return null
}

export function detectCurrencyPreference(input: {
  locale?: string | null
  ipCountryCode?: string | null
}): {
  currency: AccountCurrencyCode
  source: CurrencySource
  regionCode: string
  usedFallback: boolean
} {
  const ipRegion =
    typeof input.ipCountryCode === 'string' ? input.ipCountryCode.trim().toUpperCase() : null
  const localeRegion = extractRegionCodeFromLocale(input.locale)

  if (ipRegion) {
    const ipCurrency = currencyForRegionCode(ipRegion)
    if (ipCurrency) {
      return {
        currency: ipCurrency,
        source: 'IP_GEO',
        regionCode: ipRegion,
        usedFallback: false,
      }
    }
  }

  if (localeRegion) {
    const localeCurrency = currencyForRegionCode(localeRegion)
    if (localeCurrency) {
      return {
        currency: localeCurrency,
        source: 'DEVICE_LOCALE',
        regionCode: localeRegion,
        usedFallback: false,
      }
    }
  }

  return {
    currency: DEFAULT_ACCOUNT_CURRENCY,
    source: 'UNSUPPORTED_FALLBACK',
    regionCode: ipRegion ?? localeRegion ?? UNKNOWN_REGION_CODE,
    usedFallback: true,
  }
}
