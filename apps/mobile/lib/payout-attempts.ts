// A payout attempt that failed and was then replaced by a later attempt for the
// same order, purpose and amount is history, not an open problem. Keep the
// current attempt in front and fold the replaced ones under it.

type PayoutAttemptLike = {
  id: string
  orderId: string | null
  purpose: string
  amount: number
  currency: string
  status: string
  initiatedAt: string
  failedAt: string | null
}

const UNSUCCESSFUL = new Set(['FAILED', 'REVERSED', 'CANCELED'])

export type CollapsedPayout<T extends PayoutAttemptLike> = T & {
  replacedAttempts: Array<{ id: string; failedAt: string | null; initiatedAt: string }>
}

export function collapseReplacedPayoutAttempts<T extends PayoutAttemptLike>(rows: readonly T[]): CollapsedPayout<T>[] {
  const replacedBy = new Map<string, string>()
  for (const row of rows) {
    if (!UNSUCCESSFUL.has(row.status) || !row.orderId) continue
    const replacement = rows
      .filter((candidate) =>
        candidate.id !== row.id &&
        !UNSUCCESSFUL.has(candidate.status) &&
        candidate.orderId === row.orderId &&
        candidate.purpose === row.purpose &&
        candidate.amount === row.amount &&
        candidate.currency === row.currency &&
        Date.parse(candidate.initiatedAt) >= Date.parse(row.initiatedAt))
      .sort((a, b) => Date.parse(a.initiatedAt) - Date.parse(b.initiatedAt))[0]
    if (replacement) replacedBy.set(row.id, replacement.id)
  }
  return rows
    .filter((row) => !replacedBy.has(row.id))
    .map((row) => ({
      ...row,
      replacedAttempts: rows
        .filter((candidate) => replacedBy.get(candidate.id) === row.id)
        .map((candidate) => ({ id: candidate.id, failedAt: candidate.failedAt, initiatedAt: candidate.initiatedAt })),
    }))
}
