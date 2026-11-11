import { assertEquals } from 'jsr:@std/assert'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createOrRefreshOpsIssue, planOpsIssueRefresh } from './ops-issues.ts'

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

Deno.test('settlement escalation keeps an in-review Ops case in its workflow state', async () => {
  let update: Record<string, unknown> = {}
  let auditAfter: Record<string, unknown> = {}
  const existing = {
    id: 'issue-1', issue_number: 1, case_number: 'OPS-TEST',
    status: 'IN_REVIEW', canonical_status: 'IN_PROGRESS', severity: 'HIGH',
    title: 'Settlement release overdue', description: 'Old wait',
    recommended_action: 'Review release', metadata: {},
    actor_id: null, actor_role: 'SYSTEM', order_id: 'order-1', user_id: null,
    tailor_profile_id: null, related_entity_type: null, related_entity_id: null,
    provider: null, stage: null,
  }
  const client = {
    rpc: async () => ({ data: 'DEVELOPMENT', error: null }),
    from: (table: string) => table === 'ops_issues' ? {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }),
      update: (payload: Record<string, unknown>) => {
        update = payload
        return { eq: () => ({ select: () => ({ single: async () => ({
          data: { id: existing.id, issue_number: existing.issue_number,
            case_number: existing.case_number }, error: null,
        }) }) }) }
      },
    } : {
      insert: async (payload: { after_state: Record<string, unknown> }) => {
        auditAfter = payload.after_state
        return { error: null }
      },
    },
  } as unknown as SupabaseClient
  const result = await createOrRefreshOpsIssue(client, {
    issueType: 'SYSTEM_ALERT', severity: 'HIGH', source: 'settlement-test',
    actorRole: 'SYSTEM', orderId: 'order-1',
    title: existing.title, description: 'New wait',
    recommendedAction: existing.recommended_action,
    dedupeKey: 'settlement-eligible:tranche-1',
    preserveWorkflowState: true,
  })
  assertEquals(result?.id, existing.id)
  assertEquals(Object.hasOwn(update, 'status'), false)
  assertEquals(Object.hasOwn(update, 'canonical_status'), false)
  assertEquals(Object.hasOwn(update, 'resolved_at'), false)
  assertEquals(Object.hasOwn(update, 'closed_at'), false)
  assertEquals(auditAfter.status, 'IN_REVIEW')
  assertEquals(auditAfter.canonical_status, 'IN_PROGRESS')
})
