const WARNING = 'The review is prepared, but its founder notification needs attention.'

/**
 * Record the outcome of a prepared Money Desk request's founder notice.
 * A notice failure does not undo an already-created review request.
 * @param {{
 *   client: any, requestId: string, actorEmail: string, actorRole: string,
 *   correlationId: string,
 *   sendPrimary: () => Promise<{ok: boolean, skipped: boolean, deliveryId?: string | null}>,
 *   sendFallback: () => Promise<{ok: boolean, skipped: boolean, deliveryId?: string | null}>
 * }} input
 */
export async function recordPreparedMoneyApprovalNotice(input) {
  if (!input.requestId) return { email: 'failed', warning: WARNING }
  const prior = await input.client.from('money_desk_events').select('id')
    .eq('request_id', input.requestId).eq('event_type', 'FOUNDER_APPROVAL_EMAIL_SENT')
    .limit(1).maybeSingle()
  if (prior.error) return { email: 'failed', warning: WARNING }
  if (prior.data?.id) return { email: 'sent', warning: null }

  let outcome
  try {
    outcome = await input.sendPrimary()
  } catch {
    outcome = { ok: false, skipped: false }
  }
  if (!outcome.ok) {
    try {
      const fallback = await input.sendFallback()
      outcome = fallback ?? { ok: false, skipped: false }
    } catch {
      // The request is durable; preserve its notification failure for Ops.
      outcome = { ok: false, skipped: false }
    }
  }
  const status = outcome.ok ? 'sent' : outcome.skipped ? 'skipped' : 'failed'
  const event = await input.client.from('money_desk_events').insert({
    request_id: input.requestId,
    event_type: outcome.ok ? 'FOUNDER_APPROVAL_EMAIL_SENT' :
      outcome.skipped ? 'FOUNDER_APPROVAL_EMAIL_SKIPPED' : 'FOUNDER_APPROVAL_EMAIL_FAILED',
    actor_email: input.actorEmail,
    actor_role: input.actorRole,
    payload: { deliveryId: outcome.deliveryId ?? null },
    correlation_id: input.correlationId,
  })
  const email = event.error ? 'failed' : status
  return { email, warning: email === 'failed' ? WARNING : null }
}
