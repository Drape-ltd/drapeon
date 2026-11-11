export type StagedReleaseBreakdown = {
  inProviderBalance: number
  pending: number
  currency: string
}

export function stagedReleaseBreakdownForOrder(input: {
  status: string
  netAmount: number
  netCurrency: string
  summary: {
    currency: string
    total: number
    inProviderBalance: number
    pending: number
  } | null
}): StagedReleaseBreakdown | null {
  const { status, netAmount, netCurrency, summary } = input
  if (status !== 'IN_PROVIDER_BALANCE' || !summary) return null
  if (summary.currency !== netCurrency || summary.total !== netAmount) return null
  if (summary.inProviderBalance <= 0 || summary.pending <= 0) return null
  if (summary.inProviderBalance + summary.pending !== netAmount) return null
  return {
    inProviderBalance: summary.inProviderBalance,
    pending: summary.pending,
    currency: summary.currency,
  }
}
