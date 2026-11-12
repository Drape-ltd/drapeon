import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getOptionalSentryDsn, getZiptaxApiKey } from './env.ts'
import { log } from './logger.ts'
import {
  calculateLockedOrderAmounts,
  getTaxPolicyControl,
  getTaxPolicyReviewHealth,
  normalizeTaxCountryCode,
  resolveTaxBreakdown as resolveStaticTaxBreakdown,
  type LockedOrderAmounts,
} from '../../../packages/shared/src/tax.ts'
import type { AccountCurrencyCode } from '../../../packages/shared/src/currency-config.ts'
import { validateDeliveryPostal } from '../../../packages/shared/src/postal-code.ts'

const FN = 'tax'
export const ZIPTAX_ENDPOINT = 'https://api.zip-tax.com/request/v60'
const ZIPTAX_TIMEOUT_MS = 5_000
const TAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Drapeon is a Wyoming LLC. Formal nexus analysis has not
// yet been completed with a US accountant. Tax is being
// collected conservatively across all US states pending
// that review. Economic nexus threshold in most states
// is $100,000 in sales or 200 transactions per year.
// At early stage volume Drapeon is unlikely to trigger
// nexus obligations in any state. Revisit at scale.
// Physical nexus: Wyoming only. WY has no general sales
// tax on digital marketplace services.
// TODO post-launch: implement tax remittance reporting.
// Use Ziptax or TaxJar filing API to automate state and
// provincial remittance once filing thresholds are hit
// in each jurisdiction.

const CANADIAN_PROVINCE_NAMES: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
}

const CANADIAN_PROVINCE_TAX_TYPES: Record<string, string> = {
  AB: 'GST',
  BC: 'GST+PST',
  MB: 'GST+PST',
  NB: 'HST',
  NL: 'HST',
  NS: 'HST',
  NT: 'GST',
  NU: 'GST',
  ON: 'HST',
  PE: 'HST',
  QC: 'GST+QST',
  SK: 'GST+PST',
  YT: 'GST',
}

const CANADIAN_PROVINCE_CODES = Object.fromEntries(
  Object.entries(CANADIAN_PROVINCE_NAMES).map(([code, name]) => [name.toUpperCase(), code]),
) as Record<string, string>

const US_STATE_CODES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS',
  KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT',
  NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
  OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX',
  UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC',
}

export type ResolvedOrderTax = {
  label: string
  taxRegion: string
  rateBps: number
  fallback: boolean
  fallbackReason: string | null
  source: 'STATIC' | 'ZIPTAX' | 'ZIPTAX_CACHE'
  rawResponse?: Record<string, unknown> | null
  shippingTaxable: boolean
  platformFeeTaxable: boolean
}

export class TaxResolutionError extends Error {
  constructor(
    public readonly code: 'DELIVERY_STREET_ADDRESS_REQUIRED' | 'DELIVERY_POSTAL_CODE_REQUIRED' | 'DELIVERY_POSTAL_CODE_INVALID' | 'DELIVERY_POSTAL_REGION_MISMATCH',
    message: string,
  ) {
    super(message)
    this.name = 'TaxResolutionError'
  }
}

export class TaxProviderUnavailableError extends Error {
  readonly code = 'TAX_PROVIDER_UNAVAILABLE' as const

  constructor() {
    super('Tax is temporarily unavailable. Please try sending the quote again in a moment.')
    this.name = 'TaxProviderUnavailableError'
  }
}

export class TaxRateUnavailableError extends Error {
  readonly code = 'TAX_RATE_UNAVAILABLE_FOR_ADDRESS' as const

  constructor() {
    super('Tax is unavailable for this delivery address. Check the delivery details or contact support.')
    this.name = 'TaxRateUnavailableError'
  }
}

export class TaxProviderAddressMismatchError extends Error {
  readonly code = 'TAX_PROVIDER_ADDRESS_MISMATCH' as const

  constructor() {
    super('The tax provider could not verify that the returned state and postal code match the delivery address.')
    this.name = 'TaxProviderAddressMismatchError'
  }
}

class ZiptaxProviderResponseError extends Error {
  constructor(public readonly providerCode: number | null, message: string) {
    super(message)
    this.name = 'ZiptaxProviderResponseError'
  }
}

export type TaxLockInput = {
  supabase: SupabaseClient
  orderId?: string | null
  currency: AccountCurrencyCode
  regionCode?: string | null
  countryCode?: string | null
  address?: string | null
  postalCode?: string | null
  stateRegion?: string | null
  city?: string | null
}

type ZiptaxAddressDetail = {
  normalizedAddress?: string
  state?: string
  stateCode?: string
  county?: string
  city?: string
  postalCode?: string
  postal_code?: string
}

type ZiptaxSummary = {
  rate?: number
  summary_name?: string
  summaryName?: string
  tax_type?: string
  taxType?: string
}

type ZiptaxBaseRate = {
  jur_description?: string
  jurDescription?: string
  jur_name?: string
  jurName?: string
  jurType?: string
  rate?: number
}

type ZiptaxResponse = {
  metadata?: {
    rCode?: number
    version?: string
    response?: {
      code?: number
    }
  }
  addressDetail?: ZiptaxAddressDetail
  tax_summaries?: ZiptaxSummary[] | null
  taxSummaries?: ZiptaxSummary[] | null
  base_rates?: ZiptaxBaseRate[] | null
  baseRates?: ZiptaxBaseRate[] | null
  shipping?: {
    taxable?: string
    description?: string
  }
  service?: {
    taxable?: string
    description?: string
  }
}

type CachedTaxRate = {
  country_code: string
  address_key: string
  postal_code: string
  rate_bps: number
  tax_region: string
  source: string
  shipping_taxable: boolean
  platform_fee_taxable: boolean
  raw_response: Record<string, unknown> | null
  expires_at: string
}

function boolFromTaxableFlag(value: string | null | undefined, defaultValue: boolean) {
  if (value === 'Y') return true
  if (value === 'N') return false
  return defaultValue
}

function rateToBps(rate: number) {
  return rate <= 1 ? Math.round(rate * 10_000) : Math.round(rate * 100)
}

function normalizeRateBpsFromSummaries(summaries: ZiptaxSummary[] | null | undefined) {
  const safeSummaries = Array.isArray(summaries) ? summaries : []
  const salesRates = safeSummaries
    .filter((summary) => (summary.tax_type ?? summary.taxType) === 'SALES_TAX' && typeof summary.rate === 'number')
    .map((summary) => summary.rate as number)
  if (salesRates.length !== 1) {
    throw new ZiptaxProviderResponseError(
      null,
      `ZipTax must return exactly one SALES_TAX summary (received ${salesRates.length}).`,
    )
  }
  return rateToBps(salesRates[0])
}

function provinceTaxLabel(detail: ZiptaxAddressDetail | undefined, summaries: ZiptaxSummary[] | null | undefined) {
  const provinceCode = detail?.stateCode?.trim().toUpperCase() || ''
  const provinceName = detail?.state?.trim()
    || CANADIAN_PROVINCE_NAMES[provinceCode]
    || 'Canada'
  const summaryName = (Array.isArray(summaries) ? summaries : [])
    .map((summary) => (summary.summary_name ?? summary.summaryName)?.trim())
    .find((value): value is string => !!value && value.length > 0)

  const taxType = summaryName || CANADIAN_PROVINCE_TAX_TYPES[provinceCode] || 'sales tax'
  return `${provinceName} ${taxType}`.trim()
}

function usStateLabel(detail: ZiptaxAddressDetail | undefined, baseRates: ZiptaxBaseRate[] | null | undefined) {
  if (detail?.state?.trim()) return detail.state.trim()
  const stateRate = (Array.isArray(baseRates) ? baseRates : [])
    .find((rate) => (rate.jurType?.startsWith('US_STATE_') || rate.jur_name === 'US_STATE'))
  const stateName = stateRate?.jurName ?? stateRate?.jur_description ?? stateRate?.jurDescription
  if (stateName?.trim()) return stateName.trim()
  if (detail?.stateCode?.trim()) return detail.stateCode.trim().toUpperCase()
  return 'United States'
}

export type ParsedZiptaxV60 = {
  rateBps: number
  taxRegion: string
  shippingTaxable: boolean
  platformFeeTaxable: boolean
}

export function parseZiptaxV60(payload: ZiptaxResponse, country: 'US' | 'CA'): ParsedZiptaxV60 {
  const responseCode = payload.metadata?.response?.code ?? payload.metadata?.rCode ?? null
  if (responseCode !== 100) {
    throw new ZiptaxProviderResponseError(
      responseCode,
      `ZipTax did not return success metadata (code=${responseCode ?? 'unknown'}).`,
    )
  }

  const summaries = payload.taxSummaries ?? payload.tax_summaries
  const baseRates = payload.baseRates ?? payload.base_rates
  const rateBps = normalizeRateBpsFromSummaries(summaries)
  const taxRegion = country === 'US'
    ? usStateLabel(payload.addressDetail, baseRates)
    : provinceTaxLabel(payload.addressDetail, summaries)

  return {
    rateBps,
    taxRegion,
    shippingTaxable: boolFromTaxableFlag(payload.shipping?.taxable, false),
    platformFeeTaxable: boolFromTaxableFlag(payload.service?.taxable, false),
  }
}

async function captureTaxFailureInSentry(context: Record<string, unknown>) {
  const dsn = getOptionalSentryDsn()
  if (!dsn) return

  try {
    const dsnUrl = new URL(dsn)
    const projectId = dsnUrl.pathname.replace(/^\/+/u, '')
    const eventId = crypto.randomUUID().replace(/-/gu, '')
    const envelopeHeader = {
      event_id: eventId,
      dsn,
      sent_at: new Date().toISOString(),
    }
    const itemHeader = { type: 'event' }
    const eventPayload = {
      event_id: eventId,
      level: 'error',
      message: 'ZipTax lookup failed',
      platform: 'javascript',
      timestamp: Math.floor(Date.now() / 1000),
      tags: {
        component: 'tax',
        provider: 'ZIPTAX',
      },
      extra: context,
    }

    await fetch(`${dsnUrl.protocol}//${dsnUrl.host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body: `${JSON.stringify(envelopeHeader)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(eventPayload)}`,
    })
  } catch (error) {
    log('warn', FN, 'sentry.capture_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function normalizedAddressToken(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .toUpperCase()
}

function normalizedRegionCode(value: string | null | undefined, country: 'US' | 'CA') {
  const token = normalizedAddressToken(value)
  if (!token) return ''
  if (token.length === 2) return token
  return country === 'US' ? (US_STATE_CODES[token] ?? token) : (CANADIAN_PROVINCE_CODES[token] ?? token)
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function streetAddressLines(input: TaxLockInput, postalCode: string, country: 'US' | 'CA') {
  const cityValue = input.city?.trim() ?? ''
  const regionValue = input.stateRegion?.trim() ?? ''
  const city = normalizedAddressToken(cityValue)
  const region = normalizedAddressToken(regionValue)
  const regionCode = normalizedRegionCode(input.stateRegion, country)
  const countryTokens = country === 'US'
    ? new Set(['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'])
    : new Set(['CA', 'CAN', 'CANADA'])
  const countrySuffix = country === 'US'
    ? /(?:,\s*)?(?:US|USA|U\.S\.|U\.S\.A\.|United States(?: of America)?)\s*$/iu
    : /(?:,\s*)?(?:CA|CAN|Canada)\s*$/iu
  const postalPattern = country === 'US'
    ? escapedPattern(postalCode)
    : escapedPattern(postalCode).replace(/\\ /gu, '\\s?')
  const regionValues = [...new Set([regionValue, regionCode].filter(Boolean))]
  const localityFragments = new Set([
    city,
    region,
    regionCode,
    normalizedAddressToken(postalCode),
    ...regionValues.map((value) => normalizedAddressToken(`${cityValue} ${value}`)),
    ...regionValues.map((value) => normalizedAddressToken(`${value} ${postalCode}`)),
    ...regionValues.map((value) => normalizedAddressToken(`${cityValue} ${value} ${postalCode}`)),
  ].filter(Boolean))
  const localitySuffix = cityValue && regionValues.length > 0
    ? new RegExp(`(?:,\\s*)?${escapedPattern(cityValue)}\\s*,?\\s*(?:${regionValues.map(escapedPattern).join('|')})\\s+${postalPattern}\\s*$`, 'iu')
    : null
  const regionPostalOnly = regionValues.length > 0
    ? new RegExp(`^(?:${regionValues.map(escapedPattern).join('|')})\\s+${postalPattern}$`, 'iu')
    : null

  const lines = (input.address ?? '')
    .split(/[\r\n]+/u)
    .map((line) => line.replace(countrySuffix, '').trim())
    .map((line) => localitySuffix ? line.replace(localitySuffix, '').replace(/,\s*$/u, '').trim() : line)
    .filter(Boolean)
    .filter((line) => {
      const token = normalizedAddressToken(line)
      if (!token || countryTokens.has(token)) return false
      if (localityFragments.has(token)) return false
      if (regionPostalOnly?.test(line)) return false
      return true
    })

  if (lines.length === 0) {
    throw new TaxResolutionError('DELIVERY_STREET_ADDRESS_REQUIRED', 'A street address is required before tax can be calculated.')
  }

  return lines
}

export function buildStructuredZiptaxAddress(input: TaxLockInput, postalCode: string, country: 'US' | 'CA') {
  const street = streetAddressLines(input, postalCode, country)
  const city = input.city?.trim() ?? ''
  const region = input.stateRegion?.trim() ?? ''
  const regionPostal = [region, postalCode].filter(Boolean).join(' ')
  return [...street, city, regionPostal].filter(Boolean).join(', ')
}

export function buildTaxAddressCacheKey(input: TaxLockInput, postalCode: string, country: 'US' | 'CA') {
  const providerAddress = buildStructuredZiptaxAddress(input, postalCode, country)
  return normalizedAddressToken(`${providerAddress}, ${country}`)
}

function ziptaxReturnedAddressIdentity(detail: ZiptaxAddressDetail | undefined, country: 'US' | 'CA') {
  const normalizedAddress = detail?.normalizedAddress?.trim() ?? ''
  const postalPattern = country === 'US'
    ? /\b\d{5}(?:-\d{4})?\b/u
    : /\b[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJKLMNPRSTVWXYZ] ?\d[ABCEGHJKLMNPRSTVWXYZ]\d\b/iu
  const postalCode = (detail?.postalCode ?? detail?.postal_code ?? normalizedAddress.match(postalPattern)?.[0] ?? '')
    .trim()
    .toUpperCase()
  const stateFromAddress = normalizedAddress.match(country === 'US'
    ? /,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?(?:,|$)/u
    : /,\s*([A-Z]{2})\s+[A-Z]\d[A-Z] ?\d[A-Z]\d(?:,|$)/iu)?.[1]
  const stateCode = normalizedRegionCode(detail?.stateCode ?? detail?.state ?? stateFromAddress, country)
  return { postalCode, stateCode }
}

function ziptaxAddressMatchesInput(
  detail: ZiptaxAddressDetail | undefined,
  expectedPostalCode: string,
  expectedRegion: string | null | undefined,
  country: 'US' | 'CA',
) {
  const returned = ziptaxReturnedAddressIdentity(detail, country)
  const expectedPostal = expectedPostalCode.trim().toUpperCase()
  const postalMatches = country === 'US'
    ? returned.postalCode.slice(0, 5) === expectedPostal.slice(0, 5)
    : returned.postalCode.replace(/\s/gu, '') === expectedPostal.replace(/\s/gu, '')
  return postalMatches
    && !!returned.stateCode
    && returned.stateCode === normalizedRegionCode(expectedRegion, country)
}

async function readCachedTaxRate(
  supabase: SupabaseClient,
  countryCode: 'US' | 'CA',
  postalCode: string,
  addressKey: string,
) {
  try {
    const { data, error } = await supabase
      .from('tax_rate_cache')
      .select('country_code, address_key, postal_code, rate_bps, tax_region, source, shipping_taxable, platform_fee_taxable, raw_response, expires_at')
      .eq('country_code', countryCode)
      .eq('address_key', addressKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (error) throw error
    return (data as CachedTaxRate | null) ?? null
  } catch (error) {
    log('warn', FN, 'tax_cache.read_failed', {
      country_code: countryCode,
      postal_code: postalCode,
      address_key: addressKey,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function writeCachedTaxRate(
  supabase: SupabaseClient,
  countryCode: 'US' | 'CA',
  postalCode: string,
  addressKey: string,
  tax: ResolvedOrderTax,
) {
  try {
    const expiresAt = new Date(Date.now() + TAX_CACHE_TTL_MS).toISOString()
    const { error } = await supabase
      .from('tax_rate_cache')
      .upsert({
        country_code: countryCode,
        address_key: addressKey,
        postal_code: postalCode,
        rate_bps: tax.rateBps,
        tax_region: tax.taxRegion,
        source: tax.source,
        shipping_taxable: tax.shippingTaxable,
        platform_fee_taxable: tax.platformFeeTaxable,
        raw_response: tax.rawResponse ?? {},
        expires_at: expiresAt,
      }, {
        onConflict: 'country_code,address_key',
      })

    if (error) throw error
  } catch (error) {
    log('warn', FN, 'tax_cache.write_failed', {
      country_code: countryCode,
      postal_code: postalCode,
      address_key: addressKey,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getTaxRateFromZiptax(
  address: string,
  zip: string,
  country: 'US' | 'CA',
  expectedRegion?: string,
): Promise<{ rateBps: number; reason: string }> {
  const params = buildZiptaxLocationParams(address, zip, country)

  const response = await fetch(`${ZIPTAX_ENDPOINT}?${params.toString()}`, {
    headers: {
      'X-API-KEY': getZiptaxApiKey(),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(ZIPTAX_TIMEOUT_MS),
  })

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(`ZipTax request failed (${response.status}): ${payload.slice(0, 240)}`)
  }

  const payload = await response.json() as ZiptaxResponse
  const parsed = parseZiptaxV60(payload, country)
  if (expectedRegion && !ziptaxAddressMatchesInput(payload.addressDetail, zip, expectedRegion, country)) {
    throw new TaxProviderAddressMismatchError()
  }
  return { rateBps: parsed.rateBps, reason: parsed.taxRegion }
}

function buildZiptaxLocationParams(address: string, postalCode: string, country: 'US' | 'CA') {
  const params = new URLSearchParams({ format: 'json' })
  const normalizedAddress = address.trim()

  if (normalizedAddress) {
    params.set('address', normalizedAddress)
    params.set('countryCode', country === 'US' ? 'USA' : 'CAN')
    return params
  }

  if (country === 'CA') {
    throw new Error('ZipTax Canadian lookups require a structured address')
  }

  params.set('postalcode', postalCode)
  return params
}

function staticTaxFromContext(input: TaxLockInput): ResolvedOrderTax {
  const breakdown = resolveStaticTaxBreakdown({
    regionCode: input.regionCode,
    countryCode: input.countryCode,
    currency: input.currency,
  })

  return {
    label: breakdown.label,
    taxRegion: breakdown.jurisdiction ?? 'Tax',
    rateBps: breakdown.rateBps,
    fallback: breakdown.fallback,
    fallbackReason: breakdown.fallbackReason,
    source: 'STATIC',
    rawResponse: null,
    shippingTaxable: false,
    platformFeeTaxable: false,
  }
}

export async function resolveOrderTax(input: TaxLockInput): Promise<ResolvedOrderTax> {
  const countryCode =
    normalizeTaxCountryCode(input.countryCode)
    ?? normalizeTaxCountryCode(input.regionCode)

  if (!countryCode) {
    throw new Error('A supported delivery tax jurisdiction is required before checkout.')
  }

  const taxPolicy = getTaxPolicyControl(countryCode)
  const taxPolicyHealth = getTaxPolicyReviewHealth(countryCode)
  if (!taxPolicy || taxPolicyHealth === 'UNSUPPORTED') {
    throw new Error(`Tax is not configured for ${countryCode}.`)
  }
  if (taxPolicyHealth === 'BLOCKED') {
    throw new Error(`Tax checkout is not enabled for ${countryCode}.`)
  }
  if (taxPolicyHealth === 'OVERDUE') {
    throw new Error(`Tax policy review is overdue for ${countryCode}.`)
  }

  if (!['US', 'CA'].includes(countryCode)) {
    const staticTax = staticTaxFromContext(input)
    if (staticTax.fallback) {
      throw new Error(`Tax is not configured for ${countryCode}.`)
    }
    return staticTax
  }

  const providerCountryCode = countryCode as 'US' | 'CA'
  const postalValidation = validateDeliveryPostal(
    providerCountryCode,
    input.postalCode,
    input.stateRegion,
  )
  if (!postalValidation.ok) {
    throw new TaxResolutionError(postalValidation.code, postalValidation.message)
  }
  const postalCode = postalValidation.normalized!
  const providerAddress = buildStructuredZiptaxAddress(input, postalCode, providerCountryCode)
  const addressKey = buildTaxAddressCacheKey(input, postalCode, providerCountryCode)

  const cached = await readCachedTaxRate(input.supabase, providerCountryCode, postalCode, addressKey)
  if (cached) {
    return {
      label: `Tax (${cached.tax_region})`,
      taxRegion: cached.tax_region,
      rateBps: cached.rate_bps,
      fallback: false,
      fallbackReason: null,
      source: 'ZIPTAX_CACHE',
      rawResponse: cached.raw_response,
      shippingTaxable: !!cached.shipping_taxable,
      platformFeeTaxable: !!cached.platform_fee_taxable,
    }
  }

  try {
    const params = buildZiptaxLocationParams(
      providerAddress,
      postalCode,
      providerCountryCode,
    )

    const response = await fetch(`${ZIPTAX_ENDPOINT}?${params.toString()}`, {
      headers: {
        'X-API-KEY': getZiptaxApiKey(),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(ZIPTAX_TIMEOUT_MS),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`ZipTax request failed (${response.status}): ${body.slice(0, 240)}`)
    }

    const payload = await response.json() as ZiptaxResponse
    const parsed = parseZiptaxV60(payload, providerCountryCode)
    if (!ziptaxAddressMatchesInput(payload.addressDetail, postalCode, input.stateRegion, providerCountryCode)) {
      throw new TaxProviderAddressMismatchError()
    }

    const resolved: ResolvedOrderTax = {
      label: `Tax (${parsed.taxRegion})`,
      taxRegion: parsed.taxRegion,
      rateBps: parsed.rateBps,
      fallback: false,
      fallbackReason: null,
      source: 'ZIPTAX',
      rawResponse: payload as Record<string, unknown>,
      shippingTaxable: parsed.shippingTaxable,
      platformFeeTaxable: parsed.platformFeeTaxable,
    }

    await writeCachedTaxRate(input.supabase, providerCountryCode, postalCode, addressKey, resolved)

    return resolved
  } catch (error) {
    const context = {
      order_id: input.orderId ?? null,
      country_code: countryCode,
      postal_code: postalCode,
      currency: input.currency,
      error: error instanceof Error ? error.message : String(error),
    }
    log('error', FN, 'ziptax.lookup_failed', context)
    await captureTaxFailureInSentry(context)
    if (error instanceof ZiptaxProviderResponseError && [109, 110].includes(error.providerCode ?? -1)) {
      throw new TaxRateUnavailableError()
    }
    if (error instanceof TaxProviderAddressMismatchError) throw error
    throw new TaxProviderUnavailableError()
  }
}

export function calculateLockedOrderAmountsWithTaxBase(input: {
  subtotalAmount: number
  platformFeeAmount?: number | null
  shippingAmount?: number | null
  taxRateBps?: number | null
  shippingTaxable?: boolean
  platformFeeTaxable?: boolean
}): LockedOrderAmounts {
  const subtotalAmount = Math.max(0, input.subtotalAmount)
  const platformFeeAmount = Math.max(0, input.platformFeeAmount ?? 0)
  const shippingAmount = Math.max(0, input.shippingAmount ?? 0)
  const taxableAmount = subtotalAmount
    + (input.shippingTaxable ? shippingAmount : 0)
    + (input.platformFeeTaxable ? platformFeeAmount : 0)

  return calculateLockedOrderAmounts({
    subtotalAmount,
    platformFeeAmount,
    shippingAmount,
    taxRateBps: input.taxRateBps ?? 0,
    taxableAmount,
  })
}
