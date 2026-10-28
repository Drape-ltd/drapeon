import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  assessBachsTransferWatchdog,
  shouldNotifyBachsTransferWatchdog,
} from './bachs-transfer-watchdog.ts'

const nowMs = Date.parse('2026-10-28T18:00:00.000Z')

Deno.test('Bachs pending transfer watchdog warns without paging during the first day', () => {
  assertEquals(assessBachsTransferWatchdog({
    operationCreatedAt: '2026-10-28T00:01:00.000Z',
    nowMs,
  }), {
    ageHours: 17,
    severity: 'MEDIUM',
    notifyOps: false,
    reason: 'PENDING_WITHIN_SLA',
  })
})

Deno.test('Bachs pending transfer watchdog pages once a transfer is overdue', () => {
  assertEquals(assessBachsTransferWatchdog({
    operationCreatedAt: '2026-10-27T18:00:00.000Z',
    nowMs,
  }), {
    ageHours: 24,
    severity: 'HIGH',
    notifyOps: true,
    reason: 'PENDING_OVERDUE',
  })
})

Deno.test('Bachs pending transfer watchdog escalates very old transfers to critical', () => {
  assertEquals(assessBachsTransferWatchdog({
    operationCreatedAt: '2026-10-25T18:00:00.000Z',
    nowMs,
  }), {
    ageHours: 72,
    severity: 'CRITICAL',
    notifyOps: true,
    reason: 'PENDING_CRITICAL',
  })
})

Deno.test('missing, invalid, or future operation timestamps fail closed to Ops', () => {
  for (const operationCreatedAt of [null, 'not-a-time', '2026-10-29T00:00:00.000Z']) {
    assertEquals(assessBachsTransferWatchdog({ operationCreatedAt, nowMs }), {
      ageHours: null,
      severity: 'HIGH',
      notifyOps: true,
      reason: 'OPERATION_AGE_MISSING',
    })
  }
})

Deno.test('watchdog pages for a new or previously resolved overdue issue only', () => {
  const overdue = assessBachsTransferWatchdog({
    operationCreatedAt: '2026-10-27T18:00:00.000Z',
    nowMs,
  })
  assertEquals(shouldNotifyBachsTransferWatchdog({ assessment: overdue, existingIssue: null }), true)
  assertEquals(shouldNotifyBachsTransferWatchdog({
    assessment: overdue,
    existingIssue: { status: 'OPEN', canonical_status: 'IN_PROGRESS' },
  }), false)
  assertEquals(shouldNotifyBachsTransferWatchdog({
    assessment: overdue,
    existingIssue: { status: 'OPEN', canonical_status: 'RESOLVED' },
  }), true)
})
