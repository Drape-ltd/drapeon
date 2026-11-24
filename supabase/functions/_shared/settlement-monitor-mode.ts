export type SettlementMonitorMode = 'FULL' | 'ELIGIBILITY_ONLY' | 'ALERT_ONLY' | 'BACHS_TRANSFER_ONLY'

export const BACHS_TRANSFER_MONITOR_STATUSES = [
  'PROVIDER_UNKNOWN',
  'PROVIDER_PENDING',
  'TRANSFERRED',
] as const

export const BACHS_TRANSFER_MONITOR_BATCH_SIZE = 50

export function bachsTransferScanWindow(total: number, nowMs = Date.now()) {
  const pages = Math.max(1, Math.ceil(total / BACHS_TRANSFER_MONITOR_BATCH_SIZE))
  const page = Math.floor(nowMs / (15 * 60 * 1000)) % pages
  return {
    from: page * BACHS_TRANSFER_MONITOR_BATCH_SIZE,
    to: (page + 1) * BACHS_TRANSFER_MONITOR_BATCH_SIZE - 1,
    pages,
  }
}

export function settlementMonitorMode(mode: unknown, orderId: string | null): SettlementMonitorMode {
  if (mode == null) return 'FULL'
  if (mode !== 'ELIGIBILITY_ONLY' && mode !== 'ALERT_ONLY' && mode !== 'BACHS_TRANSFER_ONLY') {
    throw new Error('Unsupported monitor mode.')
  }
  if (orderId) throw new Error('Scheduled scans cannot target one order.')
  return mode
}
