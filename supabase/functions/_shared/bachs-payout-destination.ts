import {
  bachsPayoutDestinationDisplay,
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
      stagedChange?: {
        requestId: string
        userId: string
        requestedDestination: Record<string, unknown>
      }
    }
  | {
      persisted: false
      reason:
        | 'MISSING_IDENTITY'
        | 'NO_ROUTE_FEE_POLICY'
        | 'AMBIGUOUS_ROUTE_FEE_POLICY'
        | 'PHASE_TWO_SCHEMA_UNAVAILABLE'
    }

export function bachsReplacementCandidate(
  destinations: BachsPayoutDestination[],
  currentId: string,
  currency: string,
): { candidate: BachsPayoutDestination | null; ambiguous: boolean; currentUsable: boolean } {
  const supported = destinations.filter((destination) =>
    destination.currency.trim().toUpperCase() === currency.trim().toUpperCase() &&
    ['bank_account', 'mobile_money'].includes(destination.type)
  )
  const currentUsable = supported.some((destination) =>
    destination.id === currentId && destination.is_usable
  )
  const replacements = supported.filter((destination) =>
    destination.id !== currentId && destination.is_usable
  ).sort((left, right) => left.id.localeCompare(right.id))
  return {
    // The tailor must confirm the masked bank before it becomes CURRENT. A
    // stable candidate avoids ignoring a second provider-added usable bank.
    candidate: replacements[0] ?? null,
    ambiguous: replacements.length > 1,
    currentUsable,
  }
}

async function initializeCurrentBachsBank(
  supabase: any,
  parentId: string,
  destination: BachsPayoutDestination,
) {
  const display = bachsPayoutDestinationDisplay(destination)
  const { error } = await supabase.rpc('initialize_bachs_withdrawal_destination', {
    p_payout_destination_id: parentId,
    p_provider_destination_ref: destination.id,
    p_bank_name: display.bankName,
    p_account_last4: display.accountMasked?.replace(/\D/gu, '').slice(-4) ?? null,
    p_account_name: display.accountName,
  })
  if (error) throw new Error(`BACHS_CURRENT_BANK_INITIALIZE_FAILED:${error.message}`)
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

async function deactivateUnavailableCurrentBank(
  supabase: any,
  destinationId: string,
  checkedAt: string,
) {
  const { error } = await supabase.from('payout_destinations').update({
    active: false,
    provider_disabled_reason: 'bachs_current_bank_unusable',
    capability_checked_at: checkedAt,
  }).eq('id', destinationId)
  if (error) throw new Error(`BACHS_DESTINATION_DEACTIVATION_FAILED:${error.message}`)
}

function missingReadinessRoutine(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST202' ||
    error?.code === '42883' ||
    (/sync_bachs_payout_profile_readiness/iu.test(error?.message ?? '') &&
      /could not find|does not exist/iu.test(error?.message ?? ''))
  )
}

/** Provider evidence that the tailor can take paid work through Bachs. It is
 * independent of Ops' first-payout review, which still gates money release
 * through payout_destinations.active. */
export function bachsProviderPayoutReady(input: {
  transfersEnabled: boolean
  payoutsEnabled: boolean
  onboarding: { dueCount: number; pendingCount: number } | null
  hasUsableDestination: boolean
}): boolean {
  return input.transfersEnabled && input.payoutsEnabled && input.hasUsableDestination &&
    input.onboarding !== null && input.onboarding.dueCount === 0 &&
    input.onboarding.pendingCount === 0
}

async function syncBachsProfileReadiness(
  supabase: any,
  input: {
    profileId: string
    accountId: string
    ready: boolean
    countryCode: string
    currency: string
    observedAt: string
  },
) {
  const { error } = await supabase.rpc('sync_bachs_payout_profile_readiness', {
    p_profile_id: input.profileId,
    p_provider_account_ref: input.accountId,
    p_ready: input.ready,
    p_country_code: input.countryCode,
    p_payout_currency: input.currency,
    p_observed_at: input.observedAt,
  })
  // An Edge deploy can precede the migration; the destination row stays
  // authoritative and the next refresh writes readiness once it exists.
  if (error && !missingReadinessRoutine(error)) {
    throw new Error(`BACHS_PAYOUT_PROFILE_READINESS_SYNC_FAILED:${error.message}`)
  }
}

/** A deactivated destination must not leave the profile saying "payout
 * ready" (the #313 readiness flag gates accepting paid work). */
async function markBachsProfileNotReady(
  supabase: any,
  input: { tailorProfileId: string; account: BachsAccount; checkedAt: string },
  existing: { country_code: string; currency: string },
) {
  await syncBachsProfileReadiness(supabase, {
    profileId: input.tailorProfileId,
    accountId: input.account.id,
    ready: false,
    countryCode: existing.country_code,
    currency: existing.currency,
    observedAt: input.checkedAt,
  })
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
    throw new Error('BACHS_DESTINATION_ROUTE_IDENTITY_CONFLICT')
  }
  const expectedCollector = feesCollector === 'PLATFORM' ? 'platform' : 'bachs'
  if (input.account.responsibilities?.fees?.collector !== expectedCollector) {
    throw new Error('BACHS_DESTINATION_FEE_COLLECTOR_CONFLICT')
  }

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
  const { data: currentBank, error: currentBankError } = existing
    ? await supabase.from('bachs_withdrawal_destinations')
      .select('id,provider_destination_ref,status,provider_default_status,bank_name,account_last4,account_name')
      .eq('payout_destination_id', existing.id).eq('status', 'CURRENT').maybeSingle()
    : { data: null, error: null }
  if (currentBankError) throw new Error(`BACHS_CURRENT_BANK_READ_FAILED:${currentBankError.message}`)
  const currentBankRef = currentBank?.provider_destination_ref ?? existing?.provider_destination_ref ?? null
  const usableProviderDestinations = (input.providerDestinations ?? []).filter(
    (destination) => destination.is_usable &&
      destination.currency.trim().toUpperCase() === currency &&
      ['bank_account', 'mobile_money'].includes(destination.type),
  )
  let { data: pendingChange, error: pendingChangeError } = currentBankRef
    ? await supabase.from('payout_change_requests')
      .select('id,tailor_user_id,current_destination,requested_destination,metadata')
      .eq('tailor_profile_id', input.tailorProfileId)
      .eq('status', 'PENDING')
      .maybeSingle()
    : { data: null, error: null }
  if (pendingChangeError) {
    throw new Error(`BACHS_PENDING_CHANGE_READ_FAILED:${pendingChangeError.message}`)
  }
  const replacement = currentBankRef
    ? bachsReplacementCandidate(input.providerDestinations ?? [], currentBankRef, currency)
    : null
  if (replacement?.ambiguous && !replacement.currentUsable) {
    if (existing) {
      await deactivateUnavailableCurrentBank(supabase, existing.id, input.checkedAt)
      await markBachsProfileNotReady(supabase, input, existing)
    }
    throw new Error('BACHS_PAYOUT_DESTINATION_AMBIGUOUS')
  }
  if (!pendingChange && existing && replacement?.candidate) {
    const { data: owner, error: ownerError } = await supabase.from('tailor_profiles')
      .select('user_id').eq('id', input.tailorProfileId).maybeSingle()
    if (ownerError || !owner?.user_id) {
      throw new Error(`BACHS_CHANGE_OWNER_READ_FAILED:${ownerError?.message ?? 'missing_owner'}`)
    }
    const oldProviderBank = usableProviderDestinations.find((item) => item.id === currentBankRef)
    const oldDisplay = oldProviderBank
      ? bachsPayoutDestinationDisplay(oldProviderBank)
      : {
          bankName: currentBank?.bank_name ?? null,
          accountName: currentBank?.account_name ?? null,
          accountMasked: currentBank?.account_last4
            ? `••••${currentBank.account_last4}` : null,
        }
    const nextDisplay = bachsPayoutDestinationDisplay(replacement.candidate)
    const currentDestination = {
      payout_provider: 'BACHS', provider_account_ref: input.account.id,
      provider_destination_ref: currentBankRef,
      payout_bank_name: oldDisplay.bankName,
      payout_account_name: oldDisplay.accountName,
      payout_account_masked: oldDisplay.accountMasked,
    }
    const requestedDestination = {
      payout_provider: 'BACHS', provider_account_ref: input.account.id,
      provider_destination_ref: replacement.candidate.id,
      payout_currency: currency, payout_country_code: countryCode,
      payout_bank_name: nextDisplay.bankName,
      payout_account_name: nextDisplay.accountName,
      payout_account_masked: nextDisplay.accountMasked,
      payout_account_verified: true,
    }
    const metadata = {
      change_kind: 'BACHS_DESTINATION', lifecycle_state: 'AWAITING_CONFIRMATION',
      confirmation_expires_at: new Date(Date.parse(input.checkedAt) + 48 * 60 * 60 * 1000).toISOString(),
      provider_destination_observed_at: input.checkedAt,
      multiple_new_destinations: replacement.ambiguous,
    }
    const { data: created, error: createError } = await supabase.from('payout_change_requests')
      .insert({ tailor_user_id: owner.user_id, tailor_profile_id: input.tailorProfileId,
        current_destination: currentDestination,
        requested_destination: requestedDestination, metadata,
        submitted_at: input.checkedAt }).select('id').single()
    if (createError || !created?.id) {
      throw new Error(`BACHS_CHANGE_AUTO_STAGE_FAILED:${createError?.message ?? 'missing_request'}`)
    }
    pendingChange = { id: created.id, tailor_user_id: owner.user_id,
      current_destination: currentDestination, requested_destination: requestedDestination,
      metadata }
  }
  const validPendingChange = pendingChange?.metadata?.change_kind === 'BACHS_DESTINATION' &&
    pendingChange.current_destination?.provider_account_ref === input.account.id &&
    pendingChange.current_destination?.provider_destination_ref === currentBankRef
  const providerDestination = currentBankRef
    ? usableProviderDestinations.find((item) => item.id === currentBankRef) ?? null
    : usableProviderDestinations.length === 1 ? usableProviderDestinations[0] : null

  if (
    existing &&
    (existing.tailor_profile_id !== input.tailorProfileId ||
      existing.legal_entity !== 'DRAPE_MARKETPLACE_LIMITED' ||
      existing.country_code !== countryCode ||
      existing.currency !== currency ||
      existing.fees_collector !== feesCollector)
  ) {
    throw new Error('BACHS_DESTINATION_IDENTITY_CONFLICT')
  }
  // The parent reference is the immutable onboarding bank. A later bank
  // change only moves the CURRENT child; order releases stay on the acct_.

  let stagedChange: {
    requestId: string
    userId: string
    requestedDestination: Record<string, unknown>
  } | undefined
  if (validPendingChange && replacement?.candidate) {
    const candidateDisplay = bachsPayoutDestinationDisplay(replacement.candidate)
    const requestedDestination = {
      ...pendingChange.requested_destination,
      payout_provider: 'BACHS',
      payout_currency: currency,
      payout_country_code: countryCode,
      payout_bank_name: candidateDisplay.bankName,
      payout_account_name: candidateDisplay.accountName,
      payout_account_masked: candidateDisplay.accountMasked,
      payout_account_verified: true,
      provider_account_ref: input.account.id,
      provider_destination_ref: replacement.candidate.id,
    }
    if (pendingChange.requested_destination?.provider_destination_ref !== replacement.candidate.id) {
      const { error: stageError } = await supabase.from('payout_change_requests')
        .update({
          requested_destination: requestedDestination,
          metadata: {
            ...pendingChange.metadata,
            lifecycle_state: 'AWAITING_CONFIRMATION',
            provider_destination_observed_at: input.checkedAt,
          },
          updated_at: input.checkedAt,
        })
        .eq('id', pendingChange.id)
        .eq('status', 'PENDING')
      if (stageError) throw new Error(`BACHS_CHANGE_STAGE_FAILED:${stageError.message}`)
    }
    const { error: childStageError } = await supabase.rpc('stage_bachs_withdrawal_destination', {
      p_payout_destination_id: existing!.id,
      p_change_request_id: pendingChange.id,
      p_provider_destination_ref: replacement.candidate.id,
      p_bank_name: candidateDisplay.bankName,
      p_account_last4: candidateDisplay.accountMasked?.replace(/\D/gu, '').slice(-4) ?? null,
      p_account_name: candidateDisplay.accountName,
      p_actor_id: pendingChange.tailor_user_id,
      p_observed_at: input.checkedAt,
    })
    if (childStageError) throw new Error(`BACHS_CHANGE_CHILD_STAGE_FAILED:${childStageError.message}`)
    stagedChange = {
      requestId: pendingChange.id,
      userId: pendingChange.tailor_user_id,
      requestedDestination,
    }
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
    provider_destination_ref: existing?.provider_destination_ref ?? providerDestination?.id ?? null,
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

  const providerReady = bachsProviderPayoutReady({
    transfersEnabled,
    payoutsEnabled,
    onboarding,
    hasUsableDestination: providerDestination !== null,
  })
  const readinessInput = {
    profileId: input.tailorProfileId,
    accountId: input.account.id,
    ready: providerReady,
    countryCode,
    currency,
    observedAt: input.checkedAt,
  }

  if (existing) {
    const { error } = await supabase.from('payout_destinations').update(patch).eq('id', existing.id)
    if (error) {
      throw new Error(`BACHS_DESTINATION_REFRESH_FAILED:${error.message}`)
    }
    if (!currentBank && providerDestination && !existing.provider_destination_ref) {
      await initializeCurrentBachsBank(supabase, existing.id, providerDestination)
    }
    await syncBachsProfileReadiness(supabase, readinessInput)
    return {
      persisted: true,
      destinationId: existing.id,
      active,
      firstWithdrawalReviewStatus: review,
      onboardingProgress: onboarding,
      ...(stagedChange ? { stagedChange } : {}),
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
  if (providerDestination) {
    await initializeCurrentBachsBank(supabase, String(inserted.id), providerDestination)
  }
  await syncBachsProfileReadiness(supabase, readinessInput)
  return {
    persisted: true,
    destinationId: String(inserted.id),
    active: false,
    firstWithdrawalReviewStatus: 'PENDING',
    onboardingProgress: onboarding,
  }
}
