import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAuthUser } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { checkRateLimit, rateLimitExceededResponse } from '../_shared/rateLimit.ts'
import { log } from '../_shared/logger.ts'
import { parseBody, z } from '../_shared/validate.ts'
import { paymentRouteAvailabilityCopy, resolveSellerOrderCurrency } from '../../../packages/shared/src/currency-config.ts'
import { isRouteSupportedByCurrentCheckout, resolveConfiguredPaymentRoute } from '../_shared/payment-routes.ts'

const FN = 'payment-route-availability'
const BodySchema = z.object({
  tailorProfileId: z.string().trim().uuid(),
  deliveryCountryCode: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
  localCollection: z.boolean().optional().default(false),
})

function jsonResponse(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, cors)

  try {
    const caller = await getAuthUser(req)
    if (!caller) return jsonResponse({ code: 'UNAUTHORIZED', error: 'Sign in again to check paid-order availability.' }, 401, cors)

    const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const allowed = await checkRateLimit(supabase, `${FN}:${caller.id}`, 3600, 60)
    if (!allowed) return rateLimitExceededResponse(cors)

    const parsed = parseBody(BodySchema, await req.json().catch(() => ({})))
    if (!parsed.ok) return jsonResponse({ code: 'VALIDATION_FAILED', error: parsed.error }, 400, cors)

    const [{ data: user, error: userError }, { data: tailor, error: tailorError }] = await Promise.all([
      supabase.from('users').select('default_currency,region_code').eq('id', caller.id).maybeSingle(),
      supabase.from('tailor_profiles').select(
        'id,payout_country_code,currency,payout_currency,payout_provider,payout_account_type,paystack_recipient_code,paystack_account_id,stripe_connect_account_id,stripe_account_id',
      ).eq('id', parsed.data.tailorProfileId).maybeSingle(),
    ])
    if (userError || tailorError || !user || !tailor) {
      log('error', FN, 'payment_route.profile_read_failed', {
        actor_id: caller.id,
        tailor_profile_id: parsed.data.tailorProfileId,
        error: userError?.message ?? tailorError?.message ?? 'missing_user_or_tailor',
      })
      return jsonResponse({ code: 'PAYMENT_ROUTE_UNAVAILABLE', available: false, customerMessage: 'This tailor isn’t taking paid orders right now.' }, 503, cors)
    }

    const tailorCountryCode = typeof tailor.payout_country_code === 'string'
      ? tailor.payout_country_code
      : ''
    const chargeCurrency = resolveSellerOrderCurrency({
      tailorCurrency: tailor.currency,
      payoutCurrency: tailor.payout_currency,
      payoutProvider: tailor.payout_provider,
      payoutAccountType: tailor.payout_account_type,
      hasPaystackRecipient: !!(tailor.paystack_recipient_code ?? tailor.paystack_account_id),
      hasStripeConnectAccount: !!(tailor.stripe_connect_account_id ?? tailor.stripe_account_id),
      customerCurrency: user.default_currency,
    })
    const payoutCurrency = resolveSellerOrderCurrency({
      tailorCurrency: tailor.currency,
      payoutCurrency: tailor.payout_currency,
      payoutProvider: tailor.payout_provider,
      payoutAccountType: tailor.payout_account_type,
      hasPaystackRecipient: !!(tailor.paystack_recipient_code ?? tailor.paystack_account_id),
      hasStripeConnectAccount: !!(tailor.stripe_connect_account_id ?? tailor.stripe_account_id),
      customerCurrency: chargeCurrency,
    })
    // Before a brief, the customer has not selected collection versus shipping.
    // Let them start only if at least one plausible delivery corridor is ready;
    // custom-order-action rechecks the exact selected country at submission.
    const deliveryCountries = parsed.data.localCollection
      ? [tailorCountryCode]
      : parsed.data.deliveryCountryCode
        ? [parsed.data.deliveryCountryCode]
        : [...new Set([user.region_code, tailorCountryCode].filter((value): value is string => typeof value === 'string' && value.length > 0))]

    let resolutions
    try {
      resolutions = await Promise.all(deliveryCountries.map((deliveryCountryCode) =>
        resolveConfiguredPaymentRoute({
          supabase,
          supabaseUrl: getSupabaseUrl(),
          tailorProfileId: tailor.id,
          tailorCountryCode,
          customerChargeCurrency: chargeCurrency ?? '',
          tailorPayoutCurrency: payoutCurrency ?? '',
          deliveryCountryCode,
        })
      ))
    } catch (error) {
      log('error', FN, 'payment_route.resolve_failed', {
        actor_id: caller.id,
        tailor_profile_id: tailor.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return jsonResponse({ code: 'PAYMENT_ROUTE_UNAVAILABLE', available: false, customerMessage: 'This tailor isn’t taking paid orders right now.' }, 503, cors)
    }

    // Keep provider selection aligned with the current payment implementation.
    // A configured Bachs route is still unavailable until its complete payment
    // path has been implemented and proven.
    const executable = resolutions.some(isRouteSupportedByCurrentCheckout)
    const resolution = resolutions.find((candidate) => !candidate.available) ?? resolutions[0]
    if (!resolution) {
      return jsonResponse({ code: 'PAYMENT_ROUTE_UNAVAILABLE', available: false, customerMessage: 'This tailor isn’t taking paid orders right now.' }, 200, cors)
    }
    const copy = executable
      ? { available: true }
      : resolution.available
        ? {
            available: false,
            customerMessage: 'This tailor isn’t taking paid orders right now.',
          }
        : paymentRouteAvailabilityCopy(resolution)

    return jsonResponse({
      available: executable,
      customerMessage: copy.customerMessage,
    }, 200, cors)
  } catch (error) {
    log('error', FN, 'request.failed', { error: error instanceof Error ? error.message : String(error) })
    return jsonResponse({ code: 'INTERNAL_ERROR', error: 'Could not check paid-order availability.' }, 500, cors)
  }
})
