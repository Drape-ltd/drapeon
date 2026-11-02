import { assertEquals } from 'jsr:@std/assert'
import { planOpsIssueRefresh } from './ops-issues.ts'

const common = {
  status: 'OPEN' as const,
  canonical_status: 'NEW',
  title: 'Tax review due soon',
  description: 'Review the source.',
  recommended_action: 'Record the owner decision.',
  metadata: { country_code: 'XY', review_due_at: '2030-01-31' },
}

Deno.test('an open HIGH issue notifies once when it becomes CRITICAL and not on repeat', () => {
  const escalation = planOpsIssueRefresh(
    { ...common, severity: 'HIGH' },
    {
      severity: 'CRITICAL',
      title: 'Tax review expired',
      description: 'Checkout is blocked.',
      recommendedAction: common.recommended_action,
      metadata: common.metadata,
    },
  )
  assertEquals(escalation, { kind: 'ESCALATE', write: true, notify: true, wasTerminal: false })

  const repeat = planOpsIssueRefresh(
    {
      ...common,
      severity: 'CRITICAL',
      title: 'Tax review expired',
      description: 'Checkout is blocked.',
    },
    {
      severity: 'CRITICAL',
      title: 'Tax review expired',
      description: 'Checkout is blocked.',
      recommendedAction: common.recommended_action,
      metadata: { review_due_at: '2030-01-31', country_code: 'XY' },
    },
  )
  assertEquals(repeat, { kind: 'UNCHANGED', write: false, notify: false, wasTerminal: false })
})
