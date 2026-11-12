export type PayoutTransferIdentity = {
  status: string
  amount: number
  currency: string
  providerDestinationId: string | null
  providerTransferId: string | null
}

export type ProviderTransferIdentity = {
  id: string
  amount: number | null
  currency: string | null
  destination: string | null
}

export function assessPayoutTransferEvent(input: {
  payout: PayoutTransferIdentity
  transfer: ProviderTransferIdentity
  eventType: 'transfer.created' | 'transfer.reversed'
}) {
  const mismatches: string[] = []
  const transferCurrency = input.transfer.currency?.trim().toUpperCase() ?? null
  const payoutCurrency = input.payout.currency.trim().toUpperCase()
  if (!input.transfer.destination || input.transfer.destination !== input.payout.providerDestinationId) {
    mismatches.push('DESTINATION')
  }
  if (input.transfer.amount !== input.payout.amount) mismatches.push('AMOUNT')
  if (transferCurrency !== payoutCurrency) mismatches.push('CURRENCY')
  if (input.payout.providerTransferId && input.payout.providerTransferId !== input.transfer.id) {
    mismatches.push('TRANSFER_ID')
  }

  const alreadyTerminal = input.payout.status === 'PAID' || input.payout.status === 'REVERSED'
  return {
    matches: mismatches.length === 0,
    mismatches,
    nextStatus: input.eventType === 'transfer.reversed'
      ? 'REVERSED'
      : alreadyTerminal
      ? input.payout.status
      : 'PROCESSING',
    preserveCompletedAt: input.eventType === 'transfer.created' && alreadyTerminal,
  }
}

