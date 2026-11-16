import {
  bachsOnboardingProgress,
  type BachsAccount,
  type BachsPayoutDestination,
} from './bachs-operations.ts'

type DestinationSyncResult =
  | {
      persisted: true
      destinationId: string
      active: boolean
      firstWithdrawalReviewStatus: 'PENDING' | 'CLEARED' | 'BLOCKED'
      onboardingProgress: { dueCount: number; pendingCount: number } | null
    }
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

/** Persist a Bachs account only against the route that supplied its immutable
 * country, currency, legal entity and fee collector. A provider account being
 * created or returned from hosted onboarding never makes it payout-ready by
 * itself. */
export async function syncBachsPayoutDestination(
  supabase: any,
  input: {
    tailorProfileId: string
    routeId: string
    routeVersion: number
    account: BachsAccount
    providerDestinations?: BachsPayoutDestination[]
    checkedAt: string
  }
): Promise<DestinationSyncResult> {
  const accountCountry = input.account.country?.trim().toUpperCase()
  if (
    !input.account.id?.trim() ||
    !input.account.id.startsWith('acct_') ||
    !accountCountry ||
    !/^[A-Z]{2}$/u.test(accountCountry) ||
    !input.routeId ||
    !Number.isInteger(input.routeVersion) ||
    input.routeVersion < 1
  ) {
    return { persisted: false, reason: 'MISSING_IDENTITY' }
  }

  const { data: route, error: routeError } = await supabase
    .from('payment_routes')
    .select('id,version,provider,legal_entity,tailor_country_code,payout_currency,fees_collector')
    .eq('id', input.routeId)
    .eq('version', input.routeVersion)
    .eq('provider', 'BACHS')
    .eq('legal_entity', 'DRAPE_MARKETPLACE_LIMITED')
    .maybeSingle()
  if (routeError) {
    if (missingPhaseTwoRelation(routeError)) {
      return { persisted: false, reason: 'PHASE_TWO_SCHEMA_UNAVAILABLE' }
    }
    throw new Error(`BACHS_DESTINATION_ROUTE_POLICY_READ_FAILED:${routeError.message}`)
  }
  if (!route) return { persisted: false, reason: 'NO_ROUTE_FEE_POLICY' }

  const { data: existingData, error: existingError } = await supabase
    .from('payout_destinations')
    .select(
      'id,tailor_profile_id,legal_entity,country_code,currency,fees_collector,first_withdrawal_review_status,provider_destination_ref'
    )
    .eq('provider', 'BACHS')
    .eq('provider_account_ref', input.account.id)
    .maybeSingle()
  if (existingError) {
    if (missingPhaseTwoRelation(existingError)) {
      return { persisted: false, reason: 'PHASE_TWO_SCHEMA_UNAVAILABLE' }
    }
    throw new Error(`BACHS_DESTINATION_READ_FAILED:${existingError.message}`)
  }

  const existing = existingData as {
    id: string
    tailor_profile_id: string
    legal_entity: string
    country_code: string
    currency: string
    fees_collector: string
    first_withdrawal_review_status: 'PENDING' | 'CLEARED' | 'BLOCKED'
    provider_destination_ref: string | null
  } | null
  const deactivateExistingDestination = async () => {
    // Never mutate a destination that belongs to a different tailor. That
    // conflict must stay for Ops review rather than becoming a cross-account
    // deactivation.
    if (!existing || existing.tailor_profile_id !== input.tailorProfileId) return
    const { error } = await supabase
      .from('payout_destinations')
      .update({ active: false, capability_checked_at: input.checkedAt })
      .eq('id', existing.id)
    if (error) throw new Error(`BACHS_DESTINATION_DEACTIVATION_FAILED:${error.message}`)
  }

  const countryCode = String(route.tailor_country_code ?? '')
    .trim()
    .toUpperCase()
  const currency = String(route.payout_currency ?? '')
    .trim()
    .toUpperCase()
  const feesCollector = String(route.fees_collector ?? '')
  if (
    route.version !== input.routeVersion ||
    countryCode !== accountCountry ||
    !/^[A-Z]{2}$/u.test(countryCode) ||
    !/^[A-Z]{3}$/u.test(currency) ||
    !['PLATFORM', 'CONNECTED_ACCOUNT'].includes(feesCollector)
  ) {
    await deactivateExistingDestination()
    throw new Error('BACHS_DESTINATION_ROUTE_IDENTITY_CONFLICT')
  }
  const expectedCollector = feesCollector === 'PLATFORM' ? 'platform' : 'bachs'
  if (input.account.responsibilities?.fees?.collector !== expectedCollector) {
    await deactivateExistingDestination()
    throw new Error('BACHS_DESTINATION_FEE_COLLECTOR_CONFLICT')
  }

  const usableProviderDestinations = (input.providerDestinations ?? []).filter(
    (destination) => destination.is_usable &&
      destination.currency.trim().toUpperCase() === currency &&
      ['bank_account', 'mobile_money'].includes(destination.type),
  )
  if (usableProviderDestinations.length > 1) {
    await deactivateExistingDestination()
    throw new Error('BACHS_PAYOUT_DESTINATION_AMBIGUOUS')
  }
  const providerDestination = usableProviderDestinations[0] ?? null
  if (
    existing &&
    (existing.tailor_profile_id !== input.tailorProfileId ||
      existing.legal_entity !== 'DRAPE_MARKETPLACE_LIMITED' ||
      existing.country_code !== countryCode ||
      existing.currency !== currency ||
      existing.fees_collector !== feesCollector)
  ) {
    await deactivateExistingDestination()
    throw new Error('BACHS_DESTINATION_IDENTITY_CONFLICT')
  }
  if (existing?.provider_destination_ref &&
    existing.provider_destination_ref !== providerDestination?.id) {
    await deactivateExistingDestination()
    throw new Error('BACHS_PAYOUT_DESTINATION_IDENTITY_CONFLICT')
  }

  const transfersEnabled = input.account.capabilities?.transfers?.status === 'active'
  const payoutsEnabled = input.account.capabilities?.payouts?.status === 'active'
  const review = existing?.first_withdrawal_review_status ?? 'PENDING'
  const onboarding = bachsOnboardingProgress(input.account)
  const active = transfersEnabled && payoutsEnabled && review === 'CLEARED' &&
    onboarding !== null && onboarding.dueCount === 0 && onboarding.pendingCount === 0 &&
    providerDestination !== null
  const patch = {
    transfers_enabled: transfersEnabled,
    payouts_enabled: payoutsEnabled,
    active,
    capability_checked_at: input.checkedAt,
    provider_destination_ref: providerDestination?.id ?? existing?.provider_destination_ref ?? null,
    provider_external_account_present: providerDestination !== null ||
      existing?.provider_destination_ref != null,
    ...(onboarding
      ? {
          provider_onboarding_due_count: onboarding.dueCount,
          provider_onboarding_pending_count: onboarding.pendingCount,
          provider_onboarding_checked_at: input.checkedAt,
        }
      : { provider_onboarding_checked_at: null }),
  }

  if (existing) {
    const { error } = await supabase.from('payout_destinations').update(patch).eq('id', existing.id)
    if (error) {
      throw new Error(`BACHS_DESTINATION_REFRESH_FAILED:${error.message}`)
    }
    return {
      persisted: true,
      destinationId: existing.id,
      active,
      firstWithdrawalReviewStatus: review,
      onboardingProgress: onboarding,
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('payout_destinations')
    .insert({
      tailor_profile_id: input.tailorProfileId,
      provider: 'BACHS',
      legal_entity: 'DRAPE_MARKETPLACE_LIMITED',
      country_code: countryCode,
      currency,
      provider_account_ref: input.account.id,
      provider_destination_ref: providerDestination?.id ?? null,
      provider_external_account_present: providerDestination !== null,
      fees_collector: feesCollector,
      transfers_enabled: transfersEnabled,
      payouts_enabled: payoutsEnabled,
      first_withdrawal_review_status: 'PENDING',
      active: false,
      capability_checked_at: input.checkedAt,
      ...(onboarding
        ? {
            provider_onboarding_due_count: onboarding.dueCount,
            provider_onboarding_pending_count: onboarding.pendingCount,
            provider_onboarding_checked_at: input.checkedAt,
          }
        : {}),
    })
    .select('id')
    .single()
  if (insertError) {
    throw new Error(`BACHS_DESTINATION_CREATE_FAILED:${insertError.message}`)
  }
  return {
    persisted: true,
    destinationId: String(inserted.id),
    active: false,
    firstWithdrawalReviewStatus: 'PENDING',
    onboardingProgress: onboarding,
  }
}
