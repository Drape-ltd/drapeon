const TERMINAL = new Set(['RESOLVED', 'CLOSED', 'CANCELLED'])

export function hasOpenOrderReview(cases) {
  return cases.some((entry) => entry.type === 'ORDER_REVIEW' && !TERMINAL.has(entry.status.toUpperCase()))
}
