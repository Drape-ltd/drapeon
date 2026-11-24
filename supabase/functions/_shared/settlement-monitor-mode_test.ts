import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  BACHS_TRANSFER_MONITOR_BATCH_SIZE,
  BACHS_TRANSFER_MONITOR_STATUSES,
  bachsTransferScanWindow,
  settlementMonitorMode,
} from './settlement-monitor-mode.ts'

Deno.test('alert-only mode is explicit and cannot target an order', () => {
  assertEquals(settlementMonitorMode('ALERT_ONLY', null), 'ALERT_ONLY')
  assertThrows(() => settlementMonitorMode('ALERT_ONLY', 'order-1'), Error, 'Scheduled scans')
})

Deno.test('existing full and eligibility modes retain their gates', () => {
  assertEquals(settlementMonitorMode(undefined, null), 'FULL')
  assertEquals(settlementMonitorMode(undefined, 'order-1'), 'FULL')
  assertEquals(settlementMonitorMode('ELIGIBILITY_ONLY', null), 'ELIGIBILITY_ONLY')
  assertThrows(() => settlementMonitorMode('ELIGIBILITY_ONLY', 'order-1'), Error, 'Scheduled scans')
  assertThrows(() => settlementMonitorMode('PAYOUT_RELEASE', null), Error, 'Unsupported monitor mode')
})

Deno.test('Bachs transfer scan is bounded and never selects an unstarted claim', () => {
  assertEquals(settlementMonitorMode('BACHS_TRANSFER_ONLY', null), 'BACHS_TRANSFER_ONLY')
  assertThrows(() => settlementMonitorMode('BACHS_TRANSFER_ONLY', 'order-1'), Error, 'Scheduled scans')
  assertEquals(BACHS_TRANSFER_MONITOR_BATCH_SIZE, 50)
  assertEquals(BACHS_TRANSFER_MONITOR_STATUSES.includes('RESERVED' as never), false)
  assertEquals(bachsTransferScanWindow(0, 0), { from: 0, to: 49, pages: 1 })
  assertEquals(bachsTransferScanWindow(120, 0), { from: 0, to: 49, pages: 3 })
  assertEquals(bachsTransferScanWindow(120, 15 * 60 * 1000), { from: 50, to: 99, pages: 3 })
  assertEquals(bachsTransferScanWindow(120, 30 * 60 * 1000), { from: 100, to: 149, pages: 3 })
})
