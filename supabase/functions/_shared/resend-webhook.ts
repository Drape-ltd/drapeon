import { emailAddressHash } from './email-hash.ts'

export const RESEND_WEBHOOK_MAX_AGE_SECONDS = 5 * 60

type ResendWebhookData = Record<string, unknown>

export type ResendWebhookEvent = {
  type: string
  created_at?: string
  data?: ResendWebhookData
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function signingKey(secret: string): Uint8Array {
  const encoded = secret.trim().replace(/^whsec_/u, '')
  if (!encoded) throw new Error('RESEND_WEBHOOK_SECRET is empty.')
  return decodeBase64(encoded)
}

/**
 * Verifies Resend/Svix signatures against the raw request body. The timestamp
 * check prevents an otherwise valid delivery event from being replayed later.
 */
export async function verifyResendWebhookSignature(input: {
  payload: string
  webhookId: string | null
  timestamp: string | null
  signature: string | null
  secret: string
  nowMs?: number
}): Promise<boolean> {
  const webhookId = input.webhookId?.trim()
  const timestamp = input.timestamp?.trim()
  const signatureHeader = input.signature?.trim()
  if (!webhookId || !timestamp || !signatureHeader) return false

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false
  if (Math.abs((input.nowMs ?? Date.now()) / 1000 - timestampSeconds) > RESEND_WEBHOOK_MAX_AGE_SECONDS) {
    return false
  }

  const key = await crypto.subtle.importKey(
    'raw',
    signingKey(input.secret).buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${webhookId}.${timestamp}.${input.payload}`),
  )
  const expected = (() => {
    let binary = ''
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
    return btoa(binary)
  })()

  return signatureHeader
    .split(' ')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('v1,'))
    .some((entry) => constantTimeEqual(entry.slice(3), expected))
}

export function resendProviderEventId(event: ResendWebhookEvent, webhookId: string | null): string | null {
  const id = webhookId?.trim()
  if (id) return id
  const emailId = typeof event.data?.email_id === 'string' ? event.data.email_id.trim() : ''
  return emailId ? `${event.type}:${emailId}` : null
}

export function resendEmailId(event: ResendWebhookEvent): string | null {
  const emailId = event.data?.email_id
  return typeof emailId === 'string' && emailId.trim() ? emailId.trim() : null
}

export function resendRecipients(event: ResendWebhookEvent): string[] {
  const raw = event.data?.to
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.includes('@'))
    .slice(0, 20)
}

export function resendOutcome(eventType: string): 'DELIVERED' | 'DEAD' | null {
  if (eventType === 'email.delivered') return 'DELIVERED'
  if (['email.bounced', 'email.complained', 'email.failed', 'email.suppressed'].includes(eventType)) return 'DEAD'
  return null
}

export function resendSuppressionReason(
  eventType: string,
  data: ResendWebhookData | undefined,
): 'HARD_BOUNCE' | 'COMPLAINT' | 'INVALID_DESTINATION' | 'PROVIDER' | null {
  if (eventType === 'email.complained') return 'COMPLAINT'
  if (eventType === 'email.suppressed') return 'PROVIDER'
  if (eventType === 'email.failed') return 'PROVIDER'
  if (eventType !== 'email.bounced') return null
  const bounce = data?.bounce
  return typeof bounce === 'object' && bounce !== null && (bounce as Record<string, unknown>).type === 'Permanent'
    ? 'HARD_BOUNCE'
    : 'INVALID_DESTINATION'
}

/** Never persist recipient addresses, subjects, or provider message content. */
export async function redactResendEvent(event: ResendWebhookEvent): Promise<Record<string, unknown>> {
  const recipients = await Promise.all(resendRecipients(event).map((recipient) => emailAddressHash(recipient)))
  const data = event.data ?? {}
  const bounce = data.bounce
  const bounceRecord = typeof bounce === 'object' && bounce !== null ? bounce as Record<string, unknown> : null
  return {
    type: event.type,
    created_at: typeof event.created_at === 'string' ? event.created_at : null,
    email_id: resendEmailId(event),
    recipient_hashes: recipients,
    template_id: typeof data.template_id === 'string' ? data.template_id : null,
    // Resend tags are caller-defined. Do not persist arbitrary tag values: a
    // future sender could accidentally put an email, token, or other secret in
    // them. Delivery measurement only needs the provider event and email id.
    tags: {},
    bounce: bounceRecord
      ? {
          type: typeof bounceRecord.type === 'string' ? bounceRecord.type : null,
          subType: typeof bounceRecord.subType === 'string' ? bounceRecord.subType : null,
        }
      : null,
  }
}
