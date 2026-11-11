const ACTIVE = new Set(['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'])
const TERMINAL_REVIEWABLE = new Set(['FAILED', 'CANCELLED', 'REJECTED'])
const inKeyFamily = (key, baseKey) =>
  key === baseKey || key?.startsWith(`${baseKey}:after:`)

/** Keep a double-submit on one key, but give a later reviewed operation its own key. */
export function keyAfterMoneyDeskHistory(baseKey, latest, hasSucceeded) {
  if (hasSucceeded || latest?.status === 'SUCCEEDED') {
    throw new Error('This money action already succeeded. Reconcile it before any new review.')
  }
  if (!latest) return baseKey
  if (ACTIVE.has(latest.status)) return latest.idempotency_key
  if (TERMINAL_REVIEWABLE.has(latest.status)) return `${baseKey}:after:${latest.id}`
  throw new Error('The previous money request has an unknown status. Reconcile it before review.')
}

export async function resolveMoneyDeskTargetRetryKey(client, { actionType, targetType, targetId, baseKey }) {
  const [succeededResult, activeResult, latestResult] = await Promise.all([
    client.from('money_desk_requests').select('id,idempotency_key')
      .eq('action_type', actionType).eq('target_type', targetType)
      .eq('target_id', targetId).eq('status', 'SUCCEEDED')
      .like('idempotency_key', `${baseKey}%`),
    client.from('money_desk_requests').select('id,status,idempotency_key')
      .eq('action_type', actionType).eq('target_type', targetType).eq('target_id', targetId)
      .in('status', [...ACTIVE]).limit(1),
    client.from('money_desk_requests').select('id,status,idempotency_key')
      .eq('action_type', actionType).eq('target_type', targetType).eq('target_id', targetId)
      .like('idempotency_key', `${baseKey}%`)
      .order('created_at', { ascending: false }).order('id', { ascending: false }),
  ])
  if (succeededResult.error || activeResult.error || latestResult.error) {
    throw new Error('Money request history could not be checked. No new review was prepared.')
  }
  const active = activeResult.data?.[0] ?? null
  if (active && !inKeyFamily(active.idempotency_key, baseKey)) {
    throw new Error('Another review for this target is still active. Finish it first.')
  }
  return keyAfterMoneyDeskHistory(baseKey,
    active ?? latestResult.data?.find((row) => inKeyFamily(row.idempotency_key, baseKey)) ?? null,
    succeededResult.data?.some((row) => inKeyFamily(row.idempotency_key, baseKey)) ?? false)
}

export function isUnclaimedTrancheForReview(tranche, plan, { orderId, amount, currency, claimCount }) {
  return Boolean(tranche && tranche.status === 'ELIGIBLE' && plan?.status === 'ACTIVE' &&
    tranche.order_id === orderId && tranche.amount === amount && tranche.currency === currency &&
    !tranche.payout_id && !tranche.money_desk_request_id &&
    !tranche.release_ledger_transaction_id && claimCount === 0)
}

export function isUnclaimedAdjustmentForReview(claimCount, releaseOperationCount) {
  return claimCount === 0 && releaseOperationCount === 0
}
