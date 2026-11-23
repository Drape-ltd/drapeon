import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** Close an approved retry only after Postgres confirms its exact provider
 * operation was definitively rejected without sending funds. */
export async function closeDefiniteReviewedTrancheRetry(
  supabase: SupabaseClient,
  requestId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'close_unstarted_reviewed_claimed_retry',
    { p_request_id: requestId },
  )
  if (error || data?.outcome !== 'CLOSED_DEFINITE_REJECTION') {
    throw new Error(error?.message ??
      'Definitively rejected reviewed retry could not close its Money Desk attempt')
  }
}
