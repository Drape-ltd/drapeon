import {
  acceptedOrderPayoutRoute,
  type AcceptedOrderPayoutRoute,
  type AcceptedOrderPayoutSnapshot,
  type PayoutDestinationRecord,
} from '../../../packages/shared/src/order-payout-route.ts'

/** Read the exact destination pinned at acceptance. Snapshot orders never fall back to profile fields. */
export async function loadAcceptedOrderPayoutRoute(
  supabase: any,
  order: AcceptedOrderPayoutSnapshot,
): Promise<AcceptedOrderPayoutRoute | null> {
  if (!order.accepted_route_snapshot_at) return null
  if (!order.payout_destination_id) {
    return acceptedOrderPayoutRoute(order, null)
  }
  const { data, error } = await supabase.from('payout_destinations')
    .select('id,tailor_profile_id,provider,legal_entity,currency,provider_account_ref,transfers_enabled,payouts_enabled,fees_collector,first_withdrawal_review_status,active,capability_checked_at')
    .eq('id', order.payout_destination_id)
    .maybeSingle()
  if (error) throw new Error(`PAYOUT_DESTINATION_READ_FAILED:${error.message}`)
  return acceptedOrderPayoutRoute(order, (data as PayoutDestinationRecord | null) ?? null)
}
