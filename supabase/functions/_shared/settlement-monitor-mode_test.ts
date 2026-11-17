import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { settlementMonitorMode } from './settlement-monitor-mode.ts'

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
