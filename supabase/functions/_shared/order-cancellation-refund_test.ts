import { assertEquals } from 'jsr:@std/assert@1'
import {
  finalizeOrderCancellationRefund,
  readOrderCancellationRefundContext,
} from './order-cancellation-refund.ts'

Deno.test('cancellation refund context accepts one evidenced review or dispute source', () => {
  const base = { kind: 'ORDER_CANCELLATION' as const, moneyDeskRequestId: 'request-1' }
  assertEquals(readOrderCancellationRefundContext({ ...base, disputeId: 'dispute-1' }),
    { ...base, disputeId: 'dispute-1' })
  assertEquals(readOrderCancellationRefundContext({ ...base,
    reviewRequestedAt: '2026-11-07T19:20:32.628Z', reviewIssueId: 'issue-1' }),
    { ...base, reviewRequestedAt: '2026-11-07T19:20:32.628Z', reviewIssueId: 'issue-1' })
  assertEquals(readOrderCancellationRefundContext(base), null)
  assertEquals(readOrderCancellationRefundContext({ ...base, disputeId: 'dispute-1',
    reviewRequestedAt: '2026-11-07T19:20:32.628Z', reviewIssueId: 'issue-1' }), null)
})

Deno.test('review-backed cancellation finalization passes a null dispute to the guarded RPC', async () => {
  let rpcName = ''
  let rpcArgs: Record<string, unknown> = {}
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcName = name
      rpcArgs = args
      return Promise.resolve({ data: { status: 'PROCESSING' }, error: null })
    },
  }
  const result = await finalizeOrderCancellationRefund(client as never, {
    context: {
      kind: 'ORDER_CANCELLATION', moneyDeskRequestId: 'request-1',
      reviewRequestedAt: '2026-11-07T19:20:32.628Z', reviewIssueId: 'issue-1',
    },
    orderId: 'order-1', source: 'test',
  })
  assertEquals(result.completed, false)
  assertEquals(rpcName, 'finalize_ops_order_cancellation_refund')
  assertEquals(rpcArgs.p_dispute_id, null)
  assertEquals(rpcArgs.p_money_desk_request_id, 'request-1')
})
