import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { emailAddressHash, sha256Hex } from '../_shared/email-hash.ts'
import { getServiceRoleKey, getSupabaseUrl } from '../_shared/env.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  redactResendEvent,
  resendEmailId,
  resendOutcome,
  resendProviderEventId,
  resendRecipients,
  resendSuppressionReason,
  verifyResendWebhookSignature,
  type ResendWebhookEvent,
} from '../_shared/resend-webhook.ts'

const FN = 'resend-email-webhook'

function json(headers: Record<string, string>, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function persistSuppression(supabase: SupabaseClient, email: string, reason: string, providerReference: string | null) {
  const addressHash = await emailAddressHash(email)
  const { data: existing, error: lookupError } = await supabase
    .from('communication_suppressions')
    .select('id')
    .eq('address_hash', addressHash)
    .eq('channel', 'EMAIL')
    .eq('purpose', 'ALL_OPTIONAL')
    .eq('active', true)
    .limit(1)
  if (lookupError) throw lookupError
  if (existing?.[0]?.id) return

  const { error } = await supabase.from('communication_suppressions').insert({
    address_hash: addressHash,
    purpose: 'ALL_OPTIONAL',
    channel: 'EMAIL',
    reason,
    provider_reference: providerReference,
    active: true,
  })
  if (error && error.code !== '23505') throw error
}

async function applyDeliveryMeasurement(
  supabase: SupabaseClient,
  event: ResendWebhookEvent,
  eventId: string,
) {
  const emailId = resendEmailId(event)
  const outcome = resendOutcome(event.type)
  if (!emailId || !outcome) return

  const { error } = await supabase
    .from('notification_delivery_outcomes')
    .update({
      status: outcome,
      terminal_at: new Date().toISOString(),
      metadata: {
        resend_event_type: event.type,
        resend_webhook_event_id: eventId,
        delivery_observation: outcome === 'DELIVERED' ? 'PROVIDER_DELIVERED' : 'PROVIDER_FAILED',
      },
    })
    .eq('channel', 'EMAIL')
    .eq('provider', 'RESEND')
    .eq('provider_reference', emailId)
  if (error) throw error
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(cors, 405, { error: 'METHOD_NOT_ALLOWED' })

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')?.trim()
  if (!secret) return json(cors, 503, { error: 'WEBHOOK_NOT_CONFIGURED' })

  const rawBody = await req.text()
  const verified = await verifyResendWebhookSignature({
    payload: rawBody,
    webhookId: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
    secret,
  })
  if (!verified) return json(cors, 401, { error: 'INVALID_SIGNATURE' })

  let event: ResendWebhookEvent
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>
    if (typeof parsed.type !== 'string' || !parsed.type.startsWith('email.')) throw new Error('Unsupported event')
    event = {
      type: parsed.type,
      created_at: typeof parsed.created_at === 'string' ? parsed.created_at : undefined,
      data: typeof parsed.data === 'object' && parsed.data !== null ? parsed.data as Record<string, unknown> : {},
    }
  } catch {
    return json(cors, 400, { error: 'INVALID_EVENT' })
  }

  const eventId = resendProviderEventId(event, req.headers.get('svix-id'))
  if (!eventId) return json(cors, 400, { error: 'EVENT_ID_REQUIRED' })

  const supabase = createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const redactedPayload = await redactResendEvent(event)
  const existing = await supabase
    .from('communication_provider_events')
    .select('id,status')
    .eq('provider', 'RESEND')
    .eq('provider_event_id', eventId)
    .maybeSingle()
  if (existing.error) return json(cors, 500, { error: 'EVENT_LOOKUP_FAILED' })
  if (existing.data?.id) return json(cors, 200, { ok: true, duplicate: true })

  const { data: inserted, error: insertError } = await supabase
    .from('communication_provider_events')
    .insert({
      provider: 'RESEND',
      provider_event_id: eventId,
      channel: 'EMAIL',
      signature_verified: true,
      payload_hash: await sha256Hex(rawBody),
      payload: redactedPayload,
      status: 'PROCESSING',
      attempts: 1,
    })
    .select('id')
    .maybeSingle()
  if (insertError) {
    if (insertError.code === '23505') return json(cors, 200, { ok: true, duplicate: true })
    return json(cors, 500, { error: 'EVENT_RECORD_FAILED' })
  }

  try {
    await applyDeliveryMeasurement(supabase, event, eventId)
    const reason = resendSuppressionReason(event.type, event.data)
    if (reason) {
      const recipients = resendRecipients(event)
      for (const recipient of recipients) await persistSuppression(supabase, recipient, reason, resendEmailId(event))
    }
    await supabase.from('communication_provider_events').update({
      status: 'PROCESSED',
      processed_at: new Date().toISOString(),
      last_error: null,
    }).eq('id', inserted?.id)
    return json(cors, 200, { ok: true, processed: true })
  } catch (error) {
    await supabase.from('communication_provider_events').update({
      status: 'RETRY',
      next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      last_error: error instanceof Error ? error.message.slice(0, 500) : 'Processing failed',
    }).eq('id', inserted?.id)
    console.error(`[${FN}] processing failed`, error instanceof Error ? error.message : String(error))
    return json(cors, 500, { error: 'EVENT_PROCESSING_FAILED' })
  }
})
