import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createBachsClaimedPayoutProvider } from './bachs-claimed-payout.ts'
import { executeReservedPayout, type ClaimedPayoutResult } from './claimed-payout-execution.ts'
import type { PayoutClaimIdentity, PayoutClaimReservation } from './payout-claims.ts'
import { finalizeClaimedBachsTranche } from './claimed-tranche-payout.ts'

export type BachsTrancheClaimRow = {
  id: string
  source_kind: string
  source_id: string
  order_id: string
  tailor_profile_id: string
  provider: string
  provider_destination_id: string
  currency: string
  amount: number
  route_version: string
  earning_policy_version: string
  tailor_terms_version: string | null
  provider_idempotency_key: string
  status: string
  provider_transfer_id: string | null
  payout_id: string | null
  payout_ledger_transaction_id: string | null
}

export function bachsTrancheClaimIdentity(row: BachsTrancheClaimRow): PayoutClaimIdentity {
  if (row.source_kind !== 'SETTLEMENT_TRANCHE' || row.provider !== 'BACHS'
    || !['RESERVED', 'PROVIDER_UNKNOWN', 'PROVIDER_PENDING', 'TRANSFERRED'].includes(row.status)
    || !row.source_id || !row.order_id || !row.tailor_profile_id
    || !row.provider_destination_id || !row.route_version || !row.earning_policy_version
    || !row.payout_id || !Number.isSafeInteger(row.amount) || row.amount <= 0
    || row.provider_idempotency_key !== `tranche:${row.source_id}:op:1`) {
    throw new Error('Bachs tranche claim is missing its immutable payout identity')
  }
  return {
    businessKey: `tranche:${row.source_id}`,
    sourceKind: 'SETTLEMENT_TRANCHE',
    sourceId: row.source_id,
    orderId: row.order_id,
    tailorProfileId: row.tailor_profile_id,
    provider: 'BACHS',
    destinationId: row.provider_destination_id,
    currency: row.currency,
    amount: row.amount,
    routeVersion: row.route_version,
    earningPolicyVersion: row.earning_policy_version,
    tailorTermsVersion: row.tailor_terms_version,
    providerIdempotencyKey: row.provider_idempotency_key,
  }
}

export async function reconcileBachsTrancheClaim(
  supabase: SupabaseClient,
  row: BachsTrancheClaimRow,
  existingReservation?: PayoutClaimReservation,
): Promise<ClaimedPayoutResult> {
  const identity = bachsTrancheClaimIdentity(row)
  const reservation: PayoutClaimReservation = existingReservation ?? {
    outcome: 'EXISTING',
    claim_id: row.id,
    status: row.status as PayoutClaimReservation['status'],
    provider_idempotency_key: row.provider_idempotency_key,
    provider_transfer_id: row.provider_transfer_id,
    payout_id: row.payout_id,
  }
  const provider = createBachsClaimedPayoutProvider({
    destinationAccountId: row.provider_destination_id,
    amountMinor: row.amount,
    currency: row.currency,
    transferGroup: `order:${row.order_id}`,
    description: `Drapeon staged settlement ${row.source_id}`,
  })
  return await executeReservedPayout(
    supabase,
    identity,
    reservation,
    provider,
    async (transferId) => {
      await finalizeClaimedBachsTranche(supabase, {
        claimId: row.id,
        payoutId: row.payout_id!,
        transferId,
      })
    },
    undefined,
    { reconcileOnly: row.status !== 'RESERVED' },
  )
}
