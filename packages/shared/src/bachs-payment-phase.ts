/** Payment phases whose Bachs collection, refund, and release paths are complete. */
export function isBachsPaymentPhaseAvailable(phase: string): boolean {
  return phase === 'INITIAL_ORDER' || phase === 'FULFILLMENT'
}
