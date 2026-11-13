export type SettlementMonitorMode = 'FULL' | 'ELIGIBILITY_ONLY' | 'ALERT_ONLY'

export function settlementMonitorMode(mode: unknown, orderId: string | null): SettlementMonitorMode {
  if (mode == null) return 'FULL'
  if (mode !== 'ELIGIBILITY_ONLY' && mode !== 'ALERT_ONLY') {
    throw new Error('Unsupported monitor mode.')
  }
  if (orderId) throw new Error('Scheduled scans cannot target one order.')
  return mode
}
