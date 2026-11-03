export type DispatchClient = {
  rpc(name: string, args: Record<string, unknown>): any
  from(table: string): any
  storage: { from(bucket: string): { upload(path: string, body: Blob, options: Record<string, unknown>): Promise<{ error: { message: string } | null }>; remove(paths: string[]): Promise<unknown> } }
}

export type DispatchActor = { principalId: string | null; label: string; role: 'admin' | 'ops' }

const EVIDENCE_REQUIRED = new Set(['CARRIER_ACCEPTED', 'COLLECTED', 'DELIVERED', 'PICKUP_READY', 'PICKED_UP'])
const EVENT_TYPES = new Set(['BOOKED', 'CARRIER_ACCEPTED', 'COLLECTED', 'AT_HUB', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED', 'DELIVERED', 'PICKUP_READY', 'PICKED_UP', 'RETURNING', 'RETURNED', 'CANCELLED', 'EXCEPTION_RECORDED'])

export class DispatchCommandError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

export function dispatchEventErrorFeedback(message: string): { code: string; detail: string } {
  if (message.includes('Trusted custody proof is required before delivery')) {
    return {
      code: 'dispatch-custody-proof-required',
      detail: 'This parcel is already marked in transit, but its earlier handoff photo was not saved. Add the missing provider-acceptance or collection proof; tracking will remain in transit and delivery will then unlock.',
    }
  }
  if (message.includes('Trusted custody proof is required before tracking transit')) {
    return {
      code: 'dispatch-custody-proof-required',
      detail: 'Add a clear provider-acceptance or parcel-collection photo. The parcel cannot enter transit without a recorded handoff.',
    }
  }
  if (message.includes('Dispatch handoff proof is required for this update')) {
    return { code: 'dispatch-photo-proof-required', detail: 'Add a clear handoff or delivery photo, then save the update again.' }
  }
  if (message.includes('Dispatch funding must be ready before booking')) {
    return { code: 'dispatch-funding-not-ready', detail: 'The provider quote or customer payment is not complete. Finish dispatch funding before booking the provider.' }
  }
  if (message.includes('Carrier delivery events are not valid for local collection')) {
    return { code: 'dispatch-method-mismatch', detail: 'This order is set to pickup. Use a pickup handoff update or complete the fulfillment-method change first.' }
  }
  return { code: 'dispatch-event-save-failed', detail: 'The delivery update was not saved. Review the current dispatch step and required proof, then try again.' }
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
  const result = await client.from('audit_logs').insert({ ...(actor.principalId ? { actor_id: actor.principalId } : {}), actor_role: actor.role.toUpperCase(), severity: 'info', event, payload: { ...payload, actor_label: actor.label } })
  if (result.error) throw new DispatchCommandError('AUDIT_WRITE_FAILED', 'The dispatch update was not fully audited.', 503)
}

async function orderRecipients(client: DispatchClient, orderId: string) {
  const result = await client.from('orders').select('id,reference,order_kind,item_title,garment_type,item_size,delivery_method,customer_id,tailor_id,currency,quoted_currency,quoted_amount,total_amount').eq('id', orderId).maybeSingle()
  if (result.error || !result.data) throw new DispatchCommandError('ORDER_CONTEXT_UNAVAILABLE', 'The dispatch update was saved, but its notification context is unavailable.', 503)
  return result.data as Record<string, unknown> & { id: string; reference: string; customer_id: string; tailor_id: string | null; currency: string }
}

async function enqueue(client: DispatchClient, args: Record<string, unknown>) {
  const result = await client.rpc('enqueue_domain_event', args)
  if (result.error) throw new DispatchCommandError('DISPATCH_FOLLOWUP_FAILED', 'The dispatch update was saved, but a required follow-up could not be queued.', 503)
}

function formatMinorMoney(amount: number, currency: unknown) {
  const code = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : 'USD'
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(amount / 100) } catch { return `${code} ${(amount / 100).toFixed(2)}` }
}

async function syncIssue(client: DispatchClient, actor: DispatchActor, input: { issueType: string; relatedEntityType: string; relatedEntityId: string; actionTaken: string; reason: string }) {
  const issueResult = await client.from('ops_issues').select('id,status,assigned_to,resolved_at').eq('issue_type', input.issueType).eq('related_entity_type', input.relatedEntityType).eq('related_entity_id', input.relatedEntityId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (issueResult.error) throw new DispatchCommandError('OPS_CASE_SYNC_FAILED', 'The dispatch update was saved, but its Ops case could not be read.', 503)
  const issue = issueResult.data
  if (!issue?.id) return
  const resolvedAt = new Date().toISOString()
  const update = await client.from('ops_issues').update({ status: 'RESOLVED', assigned_to: actor.label, resolved_at: resolvedAt }).eq('id', issue.id)
  if (update.error) throw new DispatchCommandError('OPS_CASE_SYNC_FAILED', 'The dispatch update was saved, but its Ops case could not be resolved.', 503)
  const auditResult = await client.from('ops_audit_logs').insert({ issue_id: issue.id, action_taken: input.actionTaken, performed_by: actor.label, performed_role: actor.role.toUpperCase(), reason: input.reason,
    before_state: { status: issue.status, assigned_to: issue.assigned_to ?? null, resolved_at: issue.resolved_at ?? null },
    after_state: { status: 'RESOLVED', assigned_to: actor.label, resolved_at: resolvedAt } })
  if (auditResult.error) throw new DispatchCommandError('OPS_CASE_AUDIT_FAILED', 'The dispatch update was saved, but its case audit could not be written.', 503)
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
      if (result.error.message.includes('FULFILLMENT_TAX_ATTRIBUTION_REQUIRED')) throw new DispatchCommandError('FULFILLMENT_TAX_ATTRIBUTION_REQUIRED', 'Review the delivery tax attribution before recording this quote.', 409)
      throw new DispatchCommandError('QUOTE_REJECTED', 'The provider quote could not be recorded.', 409)
    }
    const outcome = record(result.data)
    if (typeof outcome.runId === 'string' && Number(outcome.customerRefundTotalAmount ?? 0) > 0) {
      await enqueue(client, { p_event_type: 'dispatch.refund_requested', p_aggregate_type: 'order_fulfillment_run', p_idempotency_key: `dispatch-refund:${outcome.runId}:queued`,
        p_payload: { runId: outcome.runId, orderId }, p_aggregate_id: outcome.runId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId,
        p_metadata: { source: 'ops-dispatch-command' }, p_jobs: ['PROCESS_DISPATCH_REFUND'], p_priority: 30, p_max_attempts: 8, p_run_at: new Date().toISOString() })
    }
    const order = await orderRecipients(client, orderId)
    const runId = typeof outcome.runId === 'string' ? outcome.runId : null
    const runResult = runId ? await client.from('order_fulfillment_runs').select('captured_allowance_amount').eq('id', runId).maybeSingle() : { data: null, error: null }
    if (runResult.error) throw new DispatchCommandError('RUN_CONTEXT_UNAVAILABLE', 'The quote was saved, but its funding context is unavailable.', 503)
    const isAdditionalDeliveryPayment = Number(runResult.data?.captured_allowance_amount ?? 0) > 0
    const needsDecision = outcome.status === 'AWAITING_CUSTOMER_DECISION'
    const customerDueAmount = Number(outcome.customerDueAmount ?? 0)
    if (order.customer_id) {
      const customerBody = needsDecision
        ? isAdditionalDeliveryPayment
          ? `The provider quote is above the protected delivery amount. ${formatMinorMoney(customerDueAmount, order.currency)} is due. Review the provider proof and exact breakdown before anything changes.`
          : `No delivery amount was paid at checkout. The confirmed provider price is ${formatMinorMoney(customerDueAmount, order.currency)}. Review the provider proof and exact breakdown before you pay or choose pickup.`
        : 'The provider quote fits within your protected delivery amount. We are moving the parcel into dispatch.'
      const customerPushBody = needsDecision
        ? isAdditionalDeliveryPayment
          ? `${formatMinorMoney(customerDueAmount, order.currency)} is due. Review the provider proof, then pay the difference, use pickup, or request a cheaper option.`
          : `${formatMinorMoney(customerDueAmount, order.currency)} is due for delivery. Review the provider proof, then pay, use pickup, or request a cheaper option.`
        : 'Drapeon Dispatch can now book the provider.'
      await enqueue(client, { p_event_type: 'notification.dispatch_quote_recorded', p_aggregate_type: 'order', p_idempotency_key: `dispatch-quote:${runId ?? orderId}:customer-delivery`,
        p_payload: { userId: order.customer_id, recipientUserId: order.customer_id, audience: 'CUSTOMER', order,
          subject: needsDecision ? 'Your delivery price is ready' : 'Your delivery cost is confirmed',
          headline: needsDecision ? isAdditionalDeliveryPayment ? 'Review the additional delivery cost' : 'Review the delivery price' : 'Drapeon Dispatch is ready to book',
          body: customerBody, ctaLabel: 'Review delivery', webPath: `/account/orders/${orderId}`, appUrl: `drape://orders/${orderId}`,
          action: 'DISPATCH_QUOTE_RECORDED', evidenceImageUrl: evidence.path, evidenceStorageBucket: 'commercial-evidence',
          notification: { title: needsDecision ? 'Delivery decision needed' : 'Delivery cost confirmed', body: customerPushBody, preferenceKey: 'orderUpdates', data: { destination: 'ORDER_DETAIL', orderId } } },
        p_aggregate_id: orderId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId, p_metadata: { runId, refundTotal: Number(outcome.customerRefundTotalAmount ?? 0) },
        p_jobs: ['SEND_PUSH', 'SEND_ORDER_EVENT_EMAIL'], p_priority: 40, p_max_attempts: 6, p_run_at: new Date().toISOString() })
      if (needsDecision) {
        const smsBody = `Order ${order.reference}: ${formatMinorMoney(customerDueAmount, order.currency)} is due ${isAdditionalDeliveryPayment ? 'as an additional delivery payment' : 'for delivery'}. Open Drapeon to review the provider proof and pay, request a cheaper option, or switch to pickup.`
        await enqueue(client, { p_event_type: 'notification.dispatch_quote_sms_requested', p_aggregate_type: 'order', p_idempotency_key: `dispatch-quote:${runId ?? orderId}:customer-sms`,
          p_payload: { userId: order.customer_id, audience: 'CUSTOMER', orderId, event: 'DISPATCH_DECISION_REQUIRED', body: smsBody },
          p_aggregate_id: orderId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId, p_metadata: { runId }, p_jobs: ['SEND_SMS'], p_priority: 20, p_max_attempts: 5, p_run_at: new Date().toISOString() })
      }
    }
    if (order.tailor_id) {
      const tailorBody = needsDecision
        ? isAdditionalDeliveryPayment
          ? 'The provider quote is above the protected delivery amount. The customer can pay the exact difference, request a cheaper option, or switch to pickup.'
          : 'No delivery amount was paid at checkout. The customer can pay the confirmed provider price, request a cheaper option, or switch to pickup.'
        : 'The provider quote fits within the protected delivery amount. Drapeon is arranging the provider handoff.'
      await enqueue(client, { p_event_type: 'notification.dispatch_quote_recorded_tailor', p_aggregate_type: 'order', p_idempotency_key: `dispatch-quote:${runId ?? orderId}:tailor-delivery`,
        p_payload: { userId: order.tailor_id, recipientUserId: order.tailor_id, audience: 'TAILOR', order,
          subject: needsDecision ? isAdditionalDeliveryPayment ? 'The customer is reviewing the delivery difference' : 'The customer is reviewing the delivery price' : 'Drapeon Dispatch is arranging collection',
          headline: needsDecision ? 'Delivery decision pending' : 'Delivery cost confirmed', body: tailorBody, ctaLabel: 'View order', webPath: `/account/orders/${orderId}`, appUrl: `drape://orders/${orderId}`,
          action: 'DISPATCH_QUOTE_RECORDED', evidenceImageUrl: evidence.path, evidenceStorageBucket: 'commercial-evidence',
          notification: { title: needsDecision ? 'Customer delivery decision pending' : 'Drapeon Dispatch is arranging collection',
            body: needsDecision ? isAdditionalDeliveryPayment ? 'No action is needed from you while the customer reviews the exact difference.' : 'No action is needed from you while the customer reviews the delivery price.' : 'Keep the parcel ready for the provider handoff.', preferenceKey: 'newOrders', data: { destination: 'ORDER_DETAIL', orderId } } },
        p_aggregate_id: orderId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId, p_metadata: { runId, refundTotal: Number(outcome.customerRefundTotalAmount ?? 0) },
        p_jobs: ['SEND_PUSH', 'SEND_ORDER_EVENT_EMAIL'], p_priority: 45, p_max_attempts: 6, p_run_at: new Date().toISOString() })
    }
    if (runId) await syncIssue(client, actor, { issueType: 'DELIVERY_REVIEW', relatedEntityType: 'ORDER_FULFILLMENT_RUN', relatedEntityId: runId, actionTaken: 'DISPATCH_PROVIDER_QUOTE_RECORDED', reason: 'The provider quote and private proof were recorded.' })
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
    const contactName = text(form.get('contactName'), 180)
    const contactPhone = text(form.get('contactPhone'), 80)
    const etaAt = text(form.get('etaAt'), 80)
    const etaDate = etaAt ? new Date(etaAt) : null
    if (etaDate && Number.isNaN(etaDate.getTime())) throw new DispatchCommandError('ETA_INVALID', 'Choose a valid estimated arrival date and time.')
    const latitudeText = text(form.get('latitude'), 40)
    const longitudeText = text(form.get('longitude'), 40)
    const latitude = latitudeText ? Number(latitudeText) : null
    const longitude = longitudeText ? Number(longitudeText) : null
    if ((latitude == null) !== (longitude == null) || (latitude != null && !Number.isFinite(latitude)) || (longitude != null && !Number.isFinite(longitude))) throw new DispatchCommandError('LOCATION_INVALID', 'Use both latitude and longitude, or clear both fields.')
    const locationLabel = text(form.get('locationLabel'), 300)
    const location = locationLabel || (latitude != null && longitude != null) ? { ...(locationLabel ? { label: locationLabel } : {}), ...(latitude != null ? { latitude } : {}), ...(longitude != null ? { longitude } : {}) } : null
    const idempotencyKey = `ops:dispatch-event:${orderId}:${eventType}:${await fingerprint(`${providerReference}|${trackingNumber}|${text(form.get('customerNote'))}|${etaDate?.toISOString() ?? ''}|${locationLabel}|${latitudeText}|${longitudeText}|${proof?.file.size ?? 0}`)}`
    const result = await client.rpc('record_order_fulfillment_event', {
      p_order_id: orderId, p_parcel_number: 1, p_event_type: eventType, p_source: 'OPS', p_actor_id: null, p_actor_role: 'OPS',
      p_provider_event_id: null, p_idempotency_key: idempotencyKey, p_provider_name: text(form.get('providerName'), 120) || null,
      p_service_level: text(form.get('serviceLevel'), 80).toUpperCase() || null, p_provider_reference: providerReference || null,
      p_tracking_number: trackingNumber || null, p_tracking_url: text(form.get('trackingUrl'), 500) || null,
      p_contact_name: contactName || null, p_contact_phone: contactPhone || null, p_customer_note: text(form.get('customerNote')) || null,
      p_internal_note: text(form.get('internalNote')) || null, p_evidence_media: evidence.media, p_location: location,
      p_eta_at: etaDate?.toISOString() ?? null, p_eta_timezone: text(form.get('etaTimezone'), 80) || null, p_occurred_at: occurredAt, p_payload: {},
    })
    if (result.error) {
      if (evidence.path) await client.storage.from('commercial-evidence').remove([evidence.path])
      const feedback = dispatchEventErrorFeedback(result.error.message)
      throw new DispatchCommandError(feedback.code.toUpperCase().replaceAll('-', '_'), feedback.detail, 409)
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
        const issueWrite = await client.from('ops_issues').upsert({ issue_type: 'PAYOUT_BLOCKED', severity: 'HIGH', status: 'OPEN', source: 'ops-dispatch-event', order_id: orderId,
          related_entity_type: outcome.runId ? 'ORDER_FULFILLMENT_RUN' : 'ORDER', related_entity_id: outcome.runId ?? orderId,
          title: 'Dispatch settlement evidence did not sync', description: 'The custody event is recorded, but its payout evidence did not reach the settlement ledger.',
          recommended_action: 'Retry the same dispatch event idempotently after repairing the settlement evidence call.',
          dedupe_key: `dispatch-settlement-evidence:${orderId}:${evidenceKind}`, metadata: { dispatch_event_type: eventType, dispatch_event_id: outcome.eventId ?? null, error: settlement.error.message }, resolved_at: null, last_seen_at: occurredAt }, { onConflict: 'dedupe_key' })
        if (issueWrite.error) throw new DispatchCommandError('PAYOUT_BLOCK_CASE_FAILED', 'The custody update was saved, but its payout block could not be persisted.', 503)
        throw new DispatchCommandError('SETTLEMENT_EVIDENCE_BLOCKED', 'The custody update was saved, but payout evidence did not sync. Do not create a new event.', 409)
      }
      await syncIssue(client, actor, { issueType: 'PAYOUT_BLOCKED', relatedEntityType: outcome.runId ? 'ORDER_FULFILLMENT_RUN' : 'ORDER', relatedEntityId: String(outcome.runId ?? orderId), actionTaken: 'DISPATCH_SETTLEMENT_EVIDENCE_SYNCED', reason: `${evidenceKind} evidence reached the settlement ledger.` })
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
        p_payload: { userId: recipient.userId, recipientUserId: recipient.userId, audience: recipient.audience, order,
          subject: 'Drapeon Dispatch update', headline: `Delivery update: ${eventLabel}`, body: text(form.get('customerNote')) || `Your order is now ${eventLabel}.`,
          ctaLabel: 'Track order', webPath: `/account/orders/${orderId}`, appUrl: `drape://orders/${orderId}`, action: `DISPATCH_${eventType}`,
          evidenceImageUrl: evidence.path, evidenceStorageBucket: evidence.path ? 'commercial-evidence' : null,
          notification: { title: 'Drapeon Dispatch update', body: text(form.get('customerNote')) || `Your order is now ${eventLabel}.`, preferenceKey: 'orderUpdates', data: { destination: 'ORDER_DETAIL', orderId } } },
        p_aggregate_id: orderId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId, p_metadata: { eventType, eventId: outcome.eventId ?? null },
        p_jobs: ['SEND_PUSH', 'SEND_ORDER_EVENT_EMAIL'], p_priority: 45, p_max_attempts: 6, p_run_at: new Date().toISOString() })
      if (['OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP_READY', 'PICKED_UP'].includes(eventType)) {
        await enqueue(client, { p_event_type: 'notification.dispatch_event_sms_requested', p_aggregate_type: 'order', p_idempotency_key: `dispatch-event:${String(outcome.eventId ?? idempotencyKey)}:${recipient.userId}:sms`,
          p_payload: { userId: recipient.userId, audience: recipient.audience, orderId, event: `DISPATCH_${eventType}`, body: text(form.get('customerNote')) || `Order ${order.reference}: ${eventLabel}. Open Drapeon for the latest Drapeon Dispatch details.` },
          p_aggregate_id: orderId, p_actor_id: null, p_actor_role: 'OPS', p_order_id: orderId, p_metadata: { eventType, eventId: outcome.eventId ?? null }, p_jobs: ['SEND_SMS'], p_priority: 20, p_max_attempts: 5, p_run_at: new Date().toISOString() })
      }
    }
    await audit(client, actor, 'ops.dispatch_event_recorded', { order_id: orderId, run_id: outcome.runId ?? null, event_id: outcome.eventId ?? null, event_type: eventType, evidence_path: evidence.path })
    return { ok: true, action, outcome, evidencePath: evidence.path }
  }
  throw new DispatchCommandError('ACTION_INVALID', 'Choose a dispatch action.')
}
