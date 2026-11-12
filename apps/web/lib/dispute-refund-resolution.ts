import type { SupabaseClient } from '@supabase/supabase-js'

export async function resolveRefundedDispute(
  client: SupabaseClient,
  input: { disputeId: string; note: string; at: string },
) {
  return client.from('disputes')
    .update({
      status: 'RESOLVED_REFUNDED',
      resolution: input.note,
      resolved_at: input.at,
      // This legacy column is a user ID on some project lineages. Named
      // operator identity belongs in the Money Desk and Ops audit records.
      resolved_by: null,
      updated_at: input.at,
    })
    .eq('id', input.disputeId)
    .in('status', ['OPEN', 'UNDER_REVIEW'])
}
