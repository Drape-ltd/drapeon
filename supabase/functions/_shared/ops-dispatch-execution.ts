export type DispatchClient = {
  rpc(name: string, args: Record<string, unknown>): any
  from(table: string): any
  storage: { from(bucket: string): { upload(path: string, body: Blob, options: Record<string, unknown>): Promise<{ error: { message: string } | null }>; remove(paths: string[]): Promise<unknown> } }
}

export type DispatchActor = { principalId: string; label: string; role: 'admin' | 'ops' }

const EVIDENCE_REQUIRED = new Set(['CARRIER_ACCEPTED', 'COLLECTED', 'DELIVERED', 'PICKUP_READY', 'PICKED_UP'])
const EVENT_TYPES = new Set(['BOOKED', 'CARRIER_ACCEPTED', 'COLLECTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP_READY', 'PICKED_UP', 'EXCEPTION', 'CANCELLED'])

export class DispatchCommandError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

function text(value: FormDataEntryValue | null, max = 2_000) {
  if (typeof value !== 'string') return ''
  const result = value.trim()
  return result.length <= max ? result : ''
}

function money(value: string, optional = false) {
  if (!value && optional) return 0
  if (!/^\d+(?:\.\d{1,2})?$/u.test(value)) throw new DispatchCommandError('INVALID_AMOUNT', 'Enter a valid amount with no more than two decimal places.')
  return Math.round(Number(value) * 100)
}

function image(file: FormDataEntryValue | null, required: boolean) {
  if (!(file instanceof File) || file.size === 0) {
    if (required) throw new DispatchCommandError('PHOTO_PROOF_REQUIRED', 'Add a clear photo before saving this dispatch update.')
    return null
  }
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : null
  if (!extension || file.size > 8 * 1024 * 1024) throw new DispatchCommandError('PHOTO_PROOF_INVALID', 'Use a JPG, PNG, or WebP image smaller than 8 MB.')
  return { file, extension }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)
}

async function uploadEvidence(client: DispatchClient, orderId: string, category: string, proof: ReturnType<typeof image>) {
  if (!proof) return { path: null as string | null, media: [] as Array<Record<string, string>> }
  const path = `${orderId}/${category}/${crypto.randomUUID()}.${proof.extension}`
  const upload = await client.storage.from('commercial-evidence').upload(path, proof.file, { contentType: proof.file.type, upsert: false })
  if (upload.error) throw new DispatchCommandError('EVIDENCE_UPLOAD_FAILED', 'The private evidence could not be saved.', 503)
  return { path, media: [{ storageBucket: 'commercial-evidence', storageObjectPath: path, mimeType: proof.file.type, mediaType: 'IMAGE' }] }
}

async function audit(client: DispatchClient, actor: DispatchActor, event: string, payload: Record<string, unknown>) {
  const result = await client.from('audit_logs').insert({ actor_id: actor.principalId, actor_role: actor.role.toUpperCase(), severity: 'info', event, payload: { ...payload, actor_label: actor.label } })
  if (result.error) throw new DispatchCommandError('AUDIT_WRITE_FAILED', 'The dispatch update was not fully audited.', 503)
}

async function orderRecipients(client: DispatchClient, orderId: string) {
  const result = await client.from('orders').select('id,reference,customer_id,tailor_id,currency').eq('id', orderId).maybeSingle()
  if (result.error || !result.data) throw new DispatchCommandError('ORDER_CONTEXT_UNAVAILABLE', 'The dispatch update was saved, but its notification context is unavailable.', 503)
  return result.data as { id: string; reference: string; customer_id: string; tailor_id: string | null; currency: string }
}

async function enqueue(client: DispatchClient, args: Record<string, unknown>) {
  const result = await client.rpc('enqueue_domain_event', args)
  if (result.error) throw new DispatchCommandError('DISPATCH_FOLLOWUP_FAILED', 'The dispatch update was saved, but a required follow-up could not be queued.', 503)
}

export async function executeOpsDispatchCommand(client: DispatchClient, actor: DispatchActor, form: FormData) {
  const action = text(form.get('action'), 24).toUpperCase()
  const orderId = text(form.get('orderId'), 80)
  if (!orderId) throw new DispatchCommandError('ORDER_REQUIRED', 'Choose an order.')

  if (action === 'QUOTE') {
    const providerName = text(form.get('providerName'), 120)
    const providerQuoteReference = text(form.get('providerQuoteReference'), 180)
    if (!providerName) throw new DispatchCommandError('PROVIDER_REQUIRED', 'Enter the delivery provider.')
    const actualProviderCostAmount = money(text(form.get('actualProviderCost'), 24))
    const shortfallTaxAmount = money(text(form.get('shortfallTax'), 24), true)
    const shortfallFeeAmount = money(text(form.get('shortfallFee'), 24), true)
    const proof = image(form.get('evidence'), true)
    const evidence = await uploadEvidence(client, orderId, 'dispatch-quotes', proof)
    const idempotencyKey = `ops:dispatch-quote:${orderId}:${await fingerprint(`${providerName}|${providerQuoteReference}|${actualProviderCostAmount}|${proof?.file.size ?? 0}`)}`
    const result = await client.rpc('record_order_fulfillment_quote', {
      p_order_id: orderId, p_provider_name: providerName, p_provider_quote_reference: providerQuoteReference || null,
      p_actual_provider_cost_amount: actualProviderCostAmount, p_shortfall_tax_amount: shortfallTaxAmount,
      p_shortfall_fee_amount: shortfallFeeAmount, p_evidence_media: evidence.media,
      p_customer_note: text(form.get('customerNote')) || null, p_internal_note: text(form.get('internalNote')) || null,
      p_actor_id: null, p_idempotency_key: idempotencyKey,
    })
    if (result.error) {
      if (evidence.path) await client.storage.from('commercial-evidence').remove([evidence.path])
      throw new DispatchCommandError('QUOTE_REJECTED', 'The provider quote could not be recorded.', 409)
    }
    const outcome = record(result.data)
    if (typeof outcome.runId === 'string' && Number(outcome.customerRefundTotalAmount ?? 0) > 0) {
      await enqueue(client, { p_event_type: 'dispatch.refund_requested', p_aggregate_type: 'order_fulfillment_run', p_idempotency_key: `dispatch-refund:${outcome.runId}:queued`,
        p_payload: { runId: outcome.runId, orderId }, p_aggregate_id: outcome.runId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId,
        p_metadata: { source: 'ops-dispatch-command' }, p_jobs: ['PROCESS_DISPATCH_REFUND'], p_priority: 30, p_max_attempts: 8, p_run_at: new Date().toISOString() })
    }
    const order = await orderRecipients(client, orderId)
    for (const recipient of [{ userId: order.customer_id, audience: 'CUSTOMER' }, { userId: order.tailor_id, audience: 'TAILOR' }].filter((entry) => entry.userId)) {
      await enqueue(client, { p_event_type: 'notification.dispatch_quote_recorded', p_aggregate_type: 'order', p_idempotency_key: `dispatch-quote:${String(outcome.runId ?? orderId)}:${recipient.userId}`,
        p_payload: { userId: recipient.userId, recipientUserId: recipient.userId, audience: recipient.audience, orderId, subject: 'Drapeon Dispatch quote update',
          headline: 'Delivery quote recorded', body: 'Open the order to review the confirmed delivery details.', ctaLabel: 'Review delivery', webPath: `/account/orders/${orderId}`, appUrl: `drape://orders/${orderId}` },
        p_aggregate_id: orderId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId, p_metadata: { runId: outcome.runId ?? null },
        p_jobs: ['SEND_PUSH', 'SEND_ORDER_EVENT_EMAIL'], p_priority: 40, p_max_attempts: 6, p_run_at: new Date().toISOString() })
    }
    await audit(client, actor, 'ops.dispatch_quote_recorded', { order_id: orderId, run_id: outcome.runId ?? null, actual_cost_amount: actualProviderCostAmount, evidence_path: evidence.path })
    return { ok: true, action, outcome, evidencePath: evidence.path }
  }

  if (action === 'EVENT') {
    const eventType = text(form.get('eventType'), 40).toUpperCase()
    if (!EVENT_TYPES.has(eventType)) throw new DispatchCommandError('EVENT_TYPE_INVALID', 'Choose a supported dispatch event.')
    const proof = image(form.get('evidence'), EVIDENCE_REQUIRED.has(eventType))
    const evidence = await uploadEvidence(client, orderId, 'dispatch-events', proof)
    const occurredAt = new Date().toISOString()
    const providerReference = text(form.get('providerReference'), 180)
    const trackingNumber = text(form.get('trackingNumber'), 180)
    const idempotencyKey = `ops:dispatch-event:${orderId}:${eventType}:${await fingerprint(`${providerReference}|${trackingNumber}|${text(form.get('customerNote'))}|${proof?.file.size ?? 0}`)}`
    const result = await client.rpc('record_order_fulfillment_event', {
      p_order_id: orderId, p_parcel_number: 1, p_event_type: eventType, p_source: 'OPS', p_actor_id: null, p_actor_role: 'OPS',
      p_provider_event_id: null, p_idempotency_key: idempotencyKey, p_provider_name: text(form.get('providerName'), 120) || null,
      p_service_level: text(form.get('serviceLevel'), 80).toUpperCase() || null, p_provider_reference: providerReference || null,
      p_tracking_number: trackingNumber || null, p_tracking_url: text(form.get('trackingUrl'), 500) || null,
      p_contact_name: null, p_contact_phone: null, p_customer_note: text(form.get('customerNote')) || null,
      p_internal_note: text(form.get('internalNote')) || null, p_evidence_media: evidence.media, p_location: null,
      p_eta_at: null, p_eta_timezone: null, p_occurred_at: occurredAt, p_payload: {},
    })
    if (result.error) {
      if (evidence.path) await client.storage.from('commercial-evidence').remove([evidence.path])
      throw new DispatchCommandError('EVENT_REJECTED', 'The dispatch event could not be recorded.', 409)
    }
    const outcome = record(result.data)
    const evidenceKind = ['CARRIER_ACCEPTED', 'COLLECTED'].includes(eventType) ? 'CARRIER_ACCEPTED' : eventType === 'DELIVERED' ? 'VERIFIED_DELIVERY' : null
    if (evidenceKind) {
      const settlement = await client.rpc('record_order_settlement_evidence', {
        p_order_id: orderId, p_evidence_kind: evidenceKind, p_source: 'DRAPEON_OPS', p_occurred_at: occurredAt,
        p_external_reference: trackingNumber || providerReference || String(outcome.eventId ?? ''), p_recorded_by: null,
        p_metadata: { dispatch_event_type: eventType, dispatch_event_id: outcome.eventId ?? null, run_id: outcome.runId ?? null },
      })
      if (settlement.error && !settlement.error.message.includes('ledger-recorded initial payment')) {
        await client.from('ops_issues').upsert({ issue_type: 'PAYOUT_BLOCKED', severity: 'HIGH', status: 'OPEN', source: 'ops-dispatch-command', order_id: orderId,
          related_entity_type: outcome.runId ? 'ORDER_FULFILLMENT_RUN' : 'ORDER', related_entity_id: outcome.runId ?? orderId,
          title: 'Dispatch settlement evidence did not sync', description: 'The custody event is recorded, but its payout evidence did not reach the settlement ledger.',
          recommended_action: 'Retry the same dispatch event idempotently after repairing the settlement evidence call.',
          dedupe_key: `dispatch-settlement-evidence:${orderId}:${evidenceKind}`, metadata: { dispatch_event_type: eventType, dispatch_event_id: outcome.eventId ?? null }, last_seen_at: occurredAt }, { onConflict: 'dedupe_key' })
        throw new DispatchCommandError('SETTLEMENT_EVIDENCE_BLOCKED', 'The custody update was saved, but payout evidence did not sync. Do not create a new event.', 409)
      }
    }
    if (typeof outcome.runId === 'string' && ['DELIVERED', 'PICKED_UP'].includes(eventType)) {
      await enqueue(client, { p_event_type: 'dispatch.reconciliation_requested', p_aggregate_type: 'order_fulfillment_run',
        p_idempotency_key: `dispatch-reconciliation-request:${outcome.runId}:ops:${String(outcome.eventId ?? idempotencyKey)}`,
        p_payload: { runId: outcome.runId, sourceId: `ops:${String(outcome.eventId ?? idempotencyKey)}` }, p_aggregate_id: outcome.runId,
        p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId, p_metadata: { eventType }, p_jobs: ['RECONCILE_DISPATCH_RUN'], p_priority: 25, p_max_attempts: 8, p_run_at: new Date().toISOString() })
    }
    const order = await orderRecipients(client, orderId)
    const eventLabel = eventType.toLowerCase().replaceAll('_', ' ')
    for (const recipient of [{ userId: order.customer_id, audience: 'CUSTOMER' }, { userId: order.tailor_id, audience: 'TAILOR' }].filter((entry) => entry.userId)) {
      await enqueue(client, { p_event_type: 'notification.dispatch_event_recorded', p_aggregate_type: 'order', p_idempotency_key: `dispatch-event:${String(outcome.eventId ?? idempotencyKey)}:${recipient.userId}`,
        p_payload: { userId: recipient.userId, recipientUserId: recipient.userId, audience: recipient.audience, orderId, subject: 'Drapeon Dispatch update',
          headline: `Delivery update: ${eventLabel}`, body: text(form.get('customerNote')) || `Your order is now ${eventLabel}.`, ctaLabel: 'Track order', webPath: `/account/orders/${orderId}`, appUrl: `drape://orders/${orderId}` },
        p_aggregate_id: orderId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId, p_metadata: { eventType, eventId: outcome.eventId ?? null },
        p_jobs: ['SEND_PUSH', 'SEND_ORDER_EVENT_EMAIL'], p_priority: 45, p_max_attempts: 6, p_run_at: new Date().toISOString() })
    }
    await audit(client, actor, 'ops.dispatch_event_recorded', { order_id: orderId, run_id: outcome.runId ?? null, event_id: outcome.eventId ?? null, event_type: eventType, evidence_path: evidence.path })
    return { ok: true, action, outcome, evidencePath: evidence.path }
  }
  throw new DispatchCommandError('ACTION_INVALID', 'Choose a dispatch action.')
}
