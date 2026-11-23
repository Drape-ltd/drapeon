import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { confirmedTipRefundEvidence } from './tip-refund-reconciliation.ts'

const target = { refundId: 're_one', paymentIntentId: 'pi_one', amount: 500 }
const refund = { id: 're_one', status: 'succeeded', payment_intent: 'pi_one', amount: 500 }

Deno.test('accepts one exact succeeded provider refund as retrieval evidence', () => {
  assertEquals(confirmedTipRefundEvidence(target, [refund], '2026-11-12T00:00:00Z'), {
    ok: true, evidence: { status: 'succeeded', refund_id: 're_one',
      payment_intent: 'pi_one', amount: 500, observed_at: '2026-11-12T00:00:00Z' },
  })
})

Deno.test('refuses missing, duplicate, pending and mismatched provider refunds', () => {
  const observedAt = '2026-11-12T00:00:00Z'
  assertEquals(confirmedTipRefundEvidence(target, [], observedAt),
    { ok: false, code: 'TIP_REFUND_NOT_UNIQUE' })
  assertEquals(confirmedTipRefundEvidence(target, [refund, refund], observedAt),
    { ok: false, code: 'TIP_REFUND_NOT_UNIQUE' })
  assertEquals(confirmedTipRefundEvidence(target, [refund,
    { id: 're_other', status: 'succeeded', payment_intent: 'pi_one', amount: 1 }], observedAt),
    { ok: false, code: 'TIP_REFUND_NOT_UNIQUE' })
  assertEquals(confirmedTipRefundEvidence(target, [refund,
    { id: 're_failed', status: 'failed', payment_intent: 'pi_one', amount: 500 }], observedAt).ok,
    true)
  assertEquals(confirmedTipRefundEvidence(target, [{ ...refund, status: 'pending' }], observedAt),
    { ok: false, code: 'TIP_REFUND_NOT_SUCCEEDED' })
  assertEquals(confirmedTipRefundEvidence(target, [{ ...refund, amount: 499 }], observedAt),
    { ok: false, code: 'TIP_REFUND_PROVIDER_IDENTITY_MISMATCH' })
  assertEquals(confirmedTipRefundEvidence(target, [{ ...refund, payment_intent: 'pi_other' }], observedAt),
    { ok: false, code: 'TIP_REFUND_PROVIDER_IDENTITY_MISMATCH' })
})

Deno.test('reviewed execution retrieves an existing refund and uses the atomic database finalizer', async () => {
  const edge = await Deno.readTextFile(new URL('../reconcile-dev-tip-refund/index.ts', import.meta.url))
  assertEquals(edge.includes('listStripeRefundsForPaymentIntent('), true)
  assertEquals(edge.includes("client.rpc('complete_dev_reviewed_tip_refund_reconciliation'"), true)
  assertEquals(edge.includes('createStripeRefund('), false)
  const route = await Deno.readTextFile(new URL('../../../apps/ops/app/ops/api/actions/money/route.ts', import.meta.url))
  assertEquals(route.includes("body?.recoveryKind === 'TIP_REFUND_RECONCILIATION'"), true)
  assertEquals(route.includes("session.mode !== 'local-supabase-mfa'"), true)
  const tipBranch = route.split("body?.recoveryKind === 'TIP_REFUND_RECONCILIATION'")[1]
    ?.split("body?.recoveryKind === 'FAILED_REFUND_JOURNAL'")[0] ?? ''
  assertEquals(tipBranch.includes('recordPreparedMoneyApprovalNotice({'), true)
  assertEquals(tipBranch.indexOf('recordPreparedMoneyApprovalNotice({') >
    tipBranch.indexOf('submitMoneyDeskRequest(client, session, grant,'), true)
  const webAdapter = await Deno.readTextFile(new URL('../../../apps/web/lib/money-desk-execution.ts', import.meta.url))
  const edgeAdapter = await Deno.readTextFile(new URL('./ops-money-execution.ts', import.meta.url))
  for (const adapter of [webAdapter, edgeAdapter]) {
    assertEquals(adapter.includes("moneyRequest.target_type === 'TIP_REFUND_RECONCILIATION'"), true)
    assertEquals(adapter.includes("'reconcile-dev-tip-refund'"), true)
  }
})
