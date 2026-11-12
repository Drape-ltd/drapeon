export type BankPayoutEvent = {
  id: string
  provider: string | null
  provider_bank_payout_id: string | null
  amount: number | null
  currency: string | null
  status: string | null
  occurred_at?: string | null
  arrival_at?: string | null
  processed_at?: string | null
  created_at?: string | null
}

export function bankPayoutEventTime(event: BankPayoutEvent): number {
  return Date.parse(event.occurred_at ?? event.processed_at ?? event.created_at ?? '') || 0
}

function statusPriority(status: string | null): number {
  switch (status) {
    case 'FAILED':
    case 'CANCELED': return 5
    case 'PAID': return 4
    case 'IN_TRANSIT': return 2
    default: return 1
  }
}

function isLater(candidate: BankPayoutEvent, current: BankPayoutEvent): boolean {
  const timeDiff = bankPayoutEventTime(candidate) - bankPayoutEventTime(current)
  if (timeDiff) return timeDiff > 0
  const priorityDiff = statusPriority(candidate.status) - statusPriority(current.status)
  if (priorityDiff) return priorityDiff > 0
  return Date.parse(candidate.processed_at ?? '') > Date.parse(current.processed_at ?? '')
}

export function projectBankPayoutEvents<T extends BankPayoutEvent>(events: T[]): T[] {
  const latest = new Map<string, T>()
  for (const event of events) {
    // Events without a bank payout reference cannot safely be merged.
    const key = event.provider_bank_payout_id
      ? `${event.provider}:${event.provider_bank_payout_id}`
      : `${event.provider}:event:${event.id}`
    const current = latest.get(key)
    if (current && current.amount !== null && event.amount !== null && current.amount !== event.amount) {
      throw new Error('BANK_PAYOUT_EVENT_AMOUNT_CONFLICT')
    }
    if (current && current.currency && event.currency && current.currency !== event.currency) {
      throw new Error('BANK_PAYOUT_EVENT_CURRENCY_CONFLICT')
    }
    if (!current || isLater(event, current)) latest.set(key, event)
  }
  return [...latest.values()].sort((a, b) =>
    bankPayoutEventTime(b) - bankPayoutEventTime(a) ||
    (Date.parse(b.processed_at ?? '') || 0) - (Date.parse(a.processed_at ?? '') || 0)
  )
}

export function withdrawnBankPayoutAmount<T extends BankPayoutEvent>(
  events: T[],
  currency: string,
  since: number,
): number {
  return projectBankPayoutEvents(events)
    .filter((event) => event.status === 'PAID' && event.currency === currency)
    .filter((event) => Date.parse(
      event.occurred_at ?? event.arrival_at ?? event.processed_at ?? event.created_at ?? '',
    ) >= since)
    .reduce((total, event) => total + (event.amount ?? 0), 0)
}
