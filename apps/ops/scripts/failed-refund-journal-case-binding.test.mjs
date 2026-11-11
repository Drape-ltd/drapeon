import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const webRoute = readFileSync(new URL('../app/ops/api/actions/money/route.ts', import.meta.url), 'utf8')
const edgeRoute = readFileSync(new URL('../../../supabase/functions/ops-money-action/index.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../../supabase/migrations/20261111183000_failed_refund_journal_ops_issue_binding.sql', import.meta.url), 'utf8')

test('failed-refund review links the Ops issue through payload, not financial case_id', () => {
  const webBranch = webRoute.split("body?.recoveryKind === 'FAILED_REFUND_JOURNAL'")[1]?.split("if (action === 'PREPARE')")[0]
  const edgeBranch = edgeRoute.split("body.recoveryKind === 'FAILED_REFUND_JOURNAL'")[1]?.split("const payoutChangeRequestId")[0]
  assert.ok(webBranch)
  assert.ok(edgeBranch)
  assert.match(webBranch, /caseId:\s*null,\s*reason,\s*actionPayload:\s*prepared\.actionPayload/u)
  assert.match(edgeBranch, /p_case_id:\s*null/u)
  assert.match(migration, /or v_request\.case_id is not null/u)
  assert.match(migration, /v_request\.action_payload->>'opsIssueId'/u)
})
