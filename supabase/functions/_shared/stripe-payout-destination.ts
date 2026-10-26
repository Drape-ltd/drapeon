import { type StripeConnectAccount, stripeTransfersAndPayoutsReady } from './stripe.ts'

type DestinationSyncResult =
  | { persisted: true; destinationId: string; active: boolean }
  | {
      persisted: false
      reason:
        | 'MISSING_IDENTITY'
        | 'NO_ROUTE_FEE_POLICY'
        | 'AMBIGUOUS_ROUTE_FEE_POLICY'
        | 'PHASE_TWO_SCHEMA_UNAVAILABLE'
    }

function missingPhaseTwoRelation(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    /relation .*payment_(routes|destinations).* does not exist|could not find the table .*payment_(routes|destinations)/iu.test(
      error?.message ?? ''
    )
  )
}

/**
 * Persist a neutral Stripe destination only after the caller has retrieved the
 * current account from Stripe. Route fee policy is copied once and then kept
 * immutable; refreshing capabilities never resets first-withdrawal review.
 */
export async function syncStripePayoutDestination(
  supabase: any,
  input: {
    tailorProfileId: string
    payoutCurrency: string | null | undefined
    account: StripeConnectAccount
    checkedAt: string
  }
): Promise<DestinationSyncResult> {
  const countryCode = input.account.country?.trim().toUpperCase()
  const currency = input.payoutCurrency?.trim().toUpperCase()
  if (
    !input.account.id?.trim() ||
    !countryCode ||
    !/^[A-Z]{2}$/.test(countryCode) ||
    !currency ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return { persisted: false, reason: 'MISSING_IDENTITY' }
  }

  const { data: routes, error: routeError } = await supabase
    .from('payment_routes')
    .select('fees_collector')
    .eq('provider', 'STRIPE')
    .eq('legal_entity', 'O4_GROUP_LLC')
    .eq('tailor_country_code', countryCode)
    .eq('payout_currency', currency)
  if (routeError) {
    if (missingPhaseTwoRelation(routeError)) {
      return { persisted: false, reason: 'PHASE_TWO_SCHEMA_UNAVAILABLE' }
    }
    throw new Error(`STRIPE_DESTINATION_ROUTE_POLICY_READ_FAILED:${routeError.message}`)
  }
  const feeCollectors = [
    ...new Set((routes ?? []).map((row: { fees_collector?: unknown }) => row.fees_collector)),
  ]
  if (feeCollectors.length === 0) {
    return { persisted: false, reason: 'NO_ROUTE_FEE_POLICY' }
  }
  if (
    feeCollectors.length !== 1 ||
    !['PLATFORM', 'CONNECTED_ACCOUNT'].includes(String(feeCollectors[0]))
  ) {
    return { persisted: false, reason: 'AMBIGUOUS_ROUTE_FEE_POLICY' }
  }
  const feesCollector = String(feeCollectors[0])

  const { data: existingData, error: existingError } = await supabase
    .from('payout_destinations')
    .select(
      'id,tailor_profile_id,legal_entity,country_code,currency,fees_collector,first_withdrawal_review_status'
    )
    .eq('provider', 'STRIPE')
    .eq('provider_account_ref', input.account.id)
    .maybeSingle()
  if (existingError) {
    if (missingPhaseTwoRelation(existingError)) {
      return { persisted: false, reason: 'PHASE_TWO_SCHEMA_UNAVAILABLE' }
    }
    throw new Error(`STRIPE_DESTINATION_READ_FAILED:${existingError.message}`)
  }

  const existing = existingData as {
    id: string
    tailor_profile_id: string
    legal_entity: string
    country_code: string
    currency: string
    fees_collector: string
    first_withdrawal_review_status: 'PENDING' | 'CLEARED' | 'BLOCKED'
  } | null
  if (
    existing &&
    (existing.tailor_profile_id !== input.tailorProfileId ||
      existing.legal_entity !== 'O4_GROUP_LLC' ||
      existing.country_code !== countryCode ||
      existing.currency !== currency ||
      existing.fees_collector !== feesCollector)
  ) {
    throw new Error('STRIPE_DESTINATION_IDENTITY_CONFLICT')
  }

  const transfersEnabled = input.account.capabilities?.transfers === 'active'
  const payoutsEnabled = input.account.payouts_enabled === true
  const firstWithdrawalReviewStatus = existing?.first_withdrawal_review_status ?? 'PENDING'
  const active =
    stripeTransfersAndPayoutsReady(input.account) && firstWithdrawalReviewStatus === 'CLEARED'
  const capabilityPatch = {
    transfers_enabled: transfersEnabled,
    payouts_enabled: payoutsEnabled,
    first_withdrawal_review_status: firstWithdrawalReviewStatus,
    active,
    capability_checked_at: input.checkedAt,
  }

  if (existing) {
    const { error } = await supabase
      .from('payout_destinations')
      .update(capabilityPatch)
      .eq('id', existing.id)
    if (error) {
      throw new Error(`STRIPE_DESTINATION_REFRESH_FAILED:${error.message}`)
    }
    return { persisted: true, destinationId: existing.id, active }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('payout_destinations')
    .insert({
      tailor_profile_id: input.tailorProfileId,
      provider: 'STRIPE',
      legal_entity: 'O4_GROUP_LLC',
      country_code: countryCode,
      currency,
      provider_account_ref: input.account.id,
      fees_collector: feesCollector,
      ...capabilityPatch,
    })
    .select('id')
    .single()
  if (insertError) {
    throw new Error(`STRIPE_DESTINATION_CREATE_FAILED:${insertError.message}`)
  }
  return { persisted: true, destinationId: String(inserted.id), active: false }
}
