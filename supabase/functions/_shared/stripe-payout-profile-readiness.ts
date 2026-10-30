import { stripeTransfersAndPayoutsReady, type StripeConnectAccount } from './stripe.ts'

export type StripePayoutReadinessSyncResult = {
  transitioned: boolean
  verified: boolean
}

export async function syncStripePayoutProfileReadiness(
  supabase: any,
  input: {
    profileId: string
    account: StripeConnectAccount
    observedAt: string
  }
): Promise<StripePayoutReadinessSyncResult> {
  const verified = stripeTransfersAndPayoutsReady(input.account)
  const { data, error } = await supabase.rpc('sync_stripe_payout_profile_readiness', {
    p_profile_id: input.profileId,
    p_stripe_account_id: input.account.id,
    p_verified: verified,
    p_country_code: input.account.country?.trim().toUpperCase() || null,
    p_observed_at: input.observedAt,
  })
  if (error) throw new Error(`STRIPE_PAYOUT_PROFILE_READINESS_SYNC_FAILED:${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return { transitioned: row?.transitioned === true, verified }
}
