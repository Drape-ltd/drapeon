import {
  isRouteSupportedByCurrentCheckout,
  resolveConfiguredPaymentRoute,
} from './payment-routes.ts'
import { normalizeAccountCurrency } from '../../../packages/shared/src/currency-config.ts'

// This is the currently published, general Terms version. It is a transaction
// snapshot only; it does not claim a separate tailor agreement or consent.
export const CURRENT_TAILOR_TERMS_VERSION = 'terms-of-service-2026-06-05'

type AcceptanceOrder = {
  id: string
  stage: string
  order_kind: string | null
  customer_id: string
  tailor_profile_id: string
  delivery_method: string
  delivery_country_code: string | null
  currency: string | null
  tailor_payout_currency_locked: string | null
}

type AcceptanceQuote = {
  id: string
  version: number
  status: string
  currency: string
}

function failed(message: string) {
  return { data: null, error: { message } }
}

/** Resolve again at acceptance and ask the database to validate + snapshot
 * that exact route in the same transaction that accepts the quote. */
export async function acceptQuoteWithPaymentRouteSnapshot(input: {
  supabase: any
  supabaseUrl: string
  orderId: string
  customerId: string
  quoteId: string
  expectedQuoteVersion: number
  allowBachsSandboxCheckout?: boolean
}) {
  const { data: orderData, error: orderError } = await input.supabase
    .from('orders')
    .select(
      'id,stage,order_kind,customer_id,tailor_profile_id,delivery_method,delivery_country_code,currency,tailor_payout_currency_locked'
    )
    .eq('id', input.orderId)
    .eq('customer_id', input.customerId)
    .maybeSingle()
  if (orderError) return failed(`PAYMENT_ROUTE_ORDER_READ_FAILED:${orderError.message}`)
  const order = orderData as AcceptanceOrder | null
  if (!order) return failed('ORDER_NOT_FOUND')
  if (order.stage !== 'QUOTE_SENT' || order.order_kind !== 'CUSTOM') {
    return failed('QUOTE_ACCEPTANCE_NOT_AVAILABLE')
  }

  const { data: quoteData, error: quoteReadError } = await input.supabase
    .from('order_quotes')
    .select('id,version,status,currency')
    .eq('id', input.quoteId)
    .eq('order_id', order.id)
    .eq('version', input.expectedQuoteVersion)
    .maybeSingle()
  if (quoteReadError) return failed(`PAYMENT_ROUTE_QUOTE_READ_FAILED:${quoteReadError.message}`)
  const quote = quoteData as AcceptanceQuote | null
  if (!quote || quote.status !== 'ACTIVE') return failed('QUOTE_VERSION_CHANGED')
  const quoteCurrency = normalizeAccountCurrency(quote.currency)
  if (!quoteCurrency) return failed('PAYMENT_ROUTE_ORDER_SNAPSHOT_MISMATCH')

  const { data: profileData, error: profileError } = await input.supabase
    .from('tailor_profiles')
    .select('id,payout_country_code,payout_currency')
    .eq('id', order.tailor_profile_id)
    .maybeSingle()
  if (profileError) return failed(`PAYMENT_ROUTE_TAILOR_READ_FAILED:${profileError.message}`)
  if (!profileData?.id) return failed('PAYMENT_ROUTE_TAILOR_NOT_FOUND')

  const tailorCountryCode = String(profileData.payout_country_code ?? '')
    .trim()
    .toUpperCase()
  const deliveryCountryCode =
    order.delivery_method === 'LOCAL_COLLECTION'
      ? tailorCountryCode
      : String(order.delivery_country_code ?? '')
          .trim()
          .toUpperCase()
  const payoutCurrency = String(
    order.tailor_payout_currency_locked ?? profileData.payout_currency ?? ''
  )
    .trim()
    .toUpperCase()
  if (
    !order.currency ||
    quote.currency !== order.currency
  ) {
    return failed('PAYMENT_ROUTE_ORDER_SNAPSHOT_MISMATCH')
  }

  let resolution
  try {
    resolution = await resolveConfiguredPaymentRoute({
      supabase: input.supabase,
      supabaseUrl: input.supabaseUrl,
      tailorProfileId: order.tailor_profile_id,
      tailorCountryCode,
      customerChargeCurrency: quote.currency,
      tailorPayoutCurrency: payoutCurrency,
      deliveryCountryCode,
    })
  } catch (error) {
    return failed(
      `PAYMENT_ROUTE_CONFIG_READ_FAILED:${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!resolution.available) return failed(`PAYMENT_ROUTE_NOT_AVAILABLE:${resolution.reason}`)
  if (!isRouteSupportedByCurrentCheckout(resolution, {
    allowBachsSandbox: input.allowBachsSandboxCheckout === true,
  }))
    return failed('PAYMENT_ROUTE_PATH_NOT_READY')

  return await input.supabase.rpc('accept_active_order_quote_with_route_snapshot', {
    p_order_id: order.id,
    p_customer_id: input.customerId,
    p_quote_id: quote.id,
    p_expected_quote_version: quote.version,
    p_payment_route_id: resolution.route.id,
    p_payment_route_version: resolution.route.version,
    p_delivery_country_rule_id: resolution.deliveryRule.id,
    p_delivery_country_rule_version: resolution.deliveryRule.version,
    p_payout_destination_id: resolution.destination.id,
    p_delivery_country_code: deliveryCountryCode,
    p_tailor_terms_version: CURRENT_TAILOR_TERMS_VERSION,
  })
}
