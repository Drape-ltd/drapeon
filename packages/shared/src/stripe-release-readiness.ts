/** Refresh the immutable Stripe destination immediately before a reviewed release. */
export async function refreshPinnedStripeDestinationForRelease(input: {
  client: any
  orderId: string
  attemptId?: string
  expectedDestinationId?: string
  forceStripeRoute?: boolean
  supabaseUrl: string
  serviceRoleKey: string
  fetchImpl?: typeof fetch
  now?: () => Date
}): Promise<{ checkedAt: string | null }> {
  const { client, orderId, attemptId, supabaseUrl, serviceRoleKey } = input
  const { data: order, error: orderError } = await client.from('orders')
    .select('id_text,accepted_route_snapshot_at,charge_provider_snapshot,payout_destination_id')
    .eq('id_text', orderId).maybeSingle()
  if (orderError || !order) throw new Error('PAYOUT_RELEASE_ORDER_READ_FAILED')
  if (!order.accepted_route_snapshot_at ||
      (!input.forceStripeRoute && order.charge_provider_snapshot !== 'STRIPE')) {
    return { checkedAt: null }
  }
  const destinationId = order.payout_destination_id
  if (typeof destinationId !== 'string' || !destinationId) {
    throw new Error('PAYOUT_RELEASE_PINNED_DESTINATION_MISSING')
  }
  if (input.expectedDestinationId && destinationId !== input.expectedDestinationId) {
    throw new Error('PAYOUT_RELEASE_PINNED_DESTINATION_MISMATCH')
  }
  let response: Response
  try {
    response = await (input.fetchImpl ?? fetch)(
      `${supabaseUrl.replace(/\/+$/u, '')}/functions/v1/payout-account-action`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          'X-Drape-Service-Key': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'ops-refresh-stripe-destination', destinationId }),
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      },
    )
  } catch {
    throw new Error('PAYOUT_RELEASE_STRIPE_REFRESH_NETWORK_ERROR')
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok || payload?.ok !== true || payload.destinationId !== destinationId) {
    const code = typeof payload?.code === 'string' && /^[A-Z0-9_-]{1,80}$/u.test(payload.code)
      ? payload.code : `HTTP_${response.status}`
    throw new Error(`PAYOUT_RELEASE_STRIPE_REFRESH_FAILED:${code}`)
  }
  const { data: destination, error: destinationError } = await client.from('payout_destinations')
    .select('id,active,transfers_enabled,payouts_enabled,first_withdrawal_review_status,capability_checked_at')
    .eq('id', destinationId).maybeSingle()
  if (destinationError || !destination || destination.id !== destinationId) {
    throw new Error('PAYOUT_RELEASE_DESTINATION_READ_FAILED')
  }
  const checkedAt = destination.capability_checked_at
  const checkedMs = typeof checkedAt === 'string' ? Date.parse(checkedAt) : NaN
  const nowMs = (input.now ?? (() => new Date()))().getTime()
  if (!Number.isFinite(checkedMs) || checkedMs < nowMs - 15 * 60_000 || checkedMs > nowMs + 60_000) {
    throw new Error('PAYOUT_RELEASE_STRIPE_REFRESH_STALE')
  }
  if (destination.active !== true || destination.transfers_enabled !== true ||
      destination.payouts_enabled !== true || destination.first_withdrawal_review_status !== 'CLEARED') {
    throw new Error('PAYOUT_RELEASE_STRIPE_CAPABILITY_DISABLED')
  }
  if (attemptId) {
    const { data: attempt, error: attemptError } = await client.from('money_desk_execution_attempts')
      .update({ provider_readiness_checked_at: checkedAt })
      .eq('id', attemptId).eq('status', 'PROCESSING')
      .select('id').maybeSingle()
    if (attemptError || !attempt?.id) throw new Error('PAYOUT_RELEASE_REFRESH_EVIDENCE_NOT_RECORDED')
  }
  return { checkedAt }
}
