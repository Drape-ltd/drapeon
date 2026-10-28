import type { BachsAccount } from './bachs-operations.ts'
import { syncBachsPayoutDestination } from './bachs-payout-destination.ts'

type Route = {
  id: string
  version: number
  status: string
  provider: string
  legal_entity: string
  tailor_country_code: string
  payout_currency: string
  fees_collector: 'PLATFORM' | 'CONNECTED_ACCOUNT'
}

type SetupClaim = {
  claim_id: string
  provider_request_key: string
  provider_account_ref: string | null
  state: 'RESERVED' | 'BOUND' | 'REVIEW'
  may_create: boolean
}

export type BachsOnboardingResult =
  | { state: 'UNCERTAIN'; claimId: string }
  | {
      state: 'LINK_READY'
      claimId: string
      accountId: string
      destinationId: string
      destinationActive: boolean
      firstWithdrawalReviewStatus: 'PENDING' | 'CLEARED' | 'BLOCKED'
      onboardingUrl: string
      expiresAt: string
    }

/** Account setup is a one-time provider write, then read/sync/link operations.
 * Re-entry on an unresolved reservation never re-POSTs account creation. */
export async function startBachsAccountOnboarding(input: {
  supabase: any
  tailorProfileId: string
  route: Route
  email: string
  displayName: string
  returnUrl: string
  refreshUrl: string
  checkedAt: string
  createAccount: (request: {
    email: string
    displayName: string
    country: string
    feesCollector: 'PLATFORM' | 'CONNECTED_ACCOUNT'
    idempotencyKey: string
  }) => Promise<BachsAccount>
  retrieveAccount: (accountId: string) => Promise<BachsAccount>
  createOnboardingLink: (request: {
    accountId: string
    refreshUrl: string
    returnUrl: string
    idempotencyKey: string
  }) => Promise<{ id: string; account: string; url: string; expires_at: string }>
}): Promise<BachsOnboardingResult> {
  const { route } = input
  if (
    route.provider !== 'BACHS' ||
    route.legal_entity !== 'DRAPE_MARKETPLACE_LIMITED' ||
    !/^[A-Z]{2}$/u.test(route.tailor_country_code) ||
    !/^[A-Z]{3}$/u.test(route.payout_currency) ||
    !['PLATFORM', 'CONNECTED_ACCOUNT'].includes(route.fees_collector)
  )
    throw new Error('BACHS_ONBOARDING_ROUTE_INVALID')

  const reserved = await input.supabase.rpc('reserve_bachs_account_setup', {
    p_tailor_profile_id: input.tailorProfileId,
    p_route_id: route.id,
    p_route_version: route.version,
  })
  if (reserved.error) {
    throw new Error(`BACHS_ONBOARDING_RESERVATION_FAILED:${reserved.error.message}`)
  }
  const claim = (
    Array.isArray(reserved.data) ? reserved.data[0] : reserved.data
  ) as SetupClaim | null
  if (!claim?.claim_id || !claim.provider_request_key) {
    throw new Error('BACHS_ONBOARDING_RESERVATION_INVALID')
  }

  let accountId = claim.provider_account_ref
  if (!accountId && claim.may_create && claim.state === 'RESERVED') {
    let created: BachsAccount
    try {
      created = await input.createAccount({
        email: input.email,
        displayName: input.displayName,
        country: route.tailor_country_code,
        feesCollector: route.fees_collector,
        idempotencyKey: claim.provider_request_key,
      })
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'uncertainWrite' in error &&
        error.uncertainWrite === true
      ) {
        return { state: 'UNCERTAIN', claimId: claim.claim_id }
      }
      throw error
    }
    // Save provider identity before making another provider request.
    const bound = await input.supabase.rpc('bind_bachs_account_setup', {
      p_claim_id: claim.claim_id,
      p_provider_account_ref: created.id,
    })
    if (bound.error || bound.data !== true) {
      return { state: 'UNCERTAIN', claimId: claim.claim_id }
    }
    accountId = created.id
  }
  if (!accountId || claim.state === 'REVIEW') {
    return { state: 'UNCERTAIN', claimId: claim.claim_id }
  }

  const account = await input.retrieveAccount(accountId)
  if (
    account.id !== accountId ||
    account.country !== route.tailor_country_code ||
    account.responsibilities?.fees?.collector !==
      (route.fees_collector === 'PLATFORM' ? 'platform' : 'bachs')
  ) {
    throw new Error('BACHS_ONBOARDING_ACCOUNT_ROUTE_MISMATCH')
  }
  const destination = await syncBachsPayoutDestination(input.supabase, {
    tailorProfileId: input.tailorProfileId,
    routeId: route.id,
    routeVersion: route.version,
    account,
    checkedAt: input.checkedAt,
  })
  if (!destination.persisted) {
    throw new Error(`BACHS_ONBOARDING_DESTINATION_NOT_PERSISTED:${destination.reason}`)
  }

  const link = await input.createOnboardingLink({
    accountId,
    refreshUrl: input.refreshUrl,
    returnUrl: input.returnUrl,
    // Links are single-use. A unique key identifies this link operation; account
    // creation itself continues to use the claim's fixed key.
    idempotencyKey: `drapeon-bachs-onboarding-link:${claim.claim_id}:${crypto.randomUUID()}`,
  })
  const linkUrl = new URL(link.url)
  if (
    link.account !== accountId ||
    linkUrl.protocol !== 'https:' ||
    !linkUrl.hostname.endsWith('.bachs.io') ||
    !link.expires_at
  ) {
    throw new Error('BACHS_ONBOARDING_LINK_INVALID')
  }
  return {
    state: 'LINK_READY',
    claimId: claim.claim_id,
    accountId,
    destinationId: destination.destinationId,
    destinationActive: destination.active,
    firstWithdrawalReviewStatus: destination.firstWithdrawalReviewStatus,
    onboardingUrl: link.url,
    expiresAt: link.expires_at,
  }
}
