import { deriveBachsPayoutPresentation, type BachsPayoutPresentation, type BachsPayoutStatusInput } from '@drape/shared'
import { createClient } from './supabase'

/** Owner-scoped status; never infer Bachs readiness from legacy profile flags. */
export async function loadOwnBachsPayoutPresentation(): Promise<BachsPayoutPresentation | null> {
  const { data, error } = await createClient().functions.invoke<{
    profile?: { bachsPayoutDestination?: BachsPayoutStatusInput | null }
  }>('payout-account-action', { body: { action: 'get-status' } })
  if (error || !data?.profile?.bachsPayoutDestination) return null
  return deriveBachsPayoutPresentation(data.profile.bachsPayoutDestination)
}
