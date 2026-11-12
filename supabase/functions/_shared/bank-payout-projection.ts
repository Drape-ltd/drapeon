import {
  projectBankPayoutEvents,
  type BankPayoutEvent,
} from '../../../packages/shared/src/provider-bank-payouts.ts'

export async function loadProjectedBankPayoutEvents(supabase: any, tailorProfileId: string) {
  const collected: BankPayoutEvent[] = []
  const pageSize = 100
  const visibleLimit = 40
  // The table is an event log. Read enough pages to return 40 distinct bank
  // payouts rather than treating each status event as another withdrawal.
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase
      .from('provider_payout_events')
      .select('id,provider,provider_event_id,provider_bank_payout_id,amount,currency,status,arrival_at,failure_code,failure_message,occurred_at,processed_at,created_at')
      .eq('tailor_profile_id', tailorProfileId)
      .order('occurred_at', { ascending: false, nullsFirst: false })
      .order('processed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (error) throw error
    collected.push(...((data ?? []) as BankPayoutEvent[]))
    const projected = projectBankPayoutEvents(collected)
    if ((data ?? []).length < pageSize || projected.length >= visibleLimit) {
      return projected.slice(0, visibleLimit)
    }
  }
  throw new Error('BANK_PAYOUT_EVENT_PAGE_LIMIT')
}
