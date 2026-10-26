import { getPaystackSecretKey } from './env.ts'
import { providerAmountMinorUnits } from '../../../packages/shared/src/money-units.ts'

const PAYSTACK_API_BASE = 'https://api.paystack.co'
const PAYSTACK_REQUEST_TIMEOUT_MS = 8_000
const textEncoder = new TextEncoder()

export type PaystackTransaction = {
  id?: number
  status: string
  reference: string
  amount: number
  currency: string
  authorization_url?: string | null
  access_code?: string | null
  gateway_response?: string | null
  message?: string | null
  metadata?: Record<string, unknown> | null
}

export type PaystackRefund = {
  id?: number
  status?: string | null
  transaction?: number | string | null
  amount?: number | null
  currency?: string | null
  customer_note?: string | null
  merchant_note?: string | null
}

export type PaystackTransfer = {
  id?: number
  status?: string | null
  reference?: string | null
  transfer_code?: string | null
  amount?: number | null
  currency?: string | null
}

function authHeaders() {
  return {
    Authorization: `Bearer ${getPaystackSecretKey()}`,
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

async function fetchPaystack(url: string, init: RequestInit, context: string) {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(PAYSTACK_REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Paystack ${context} timed out. Please try again.`)
    }
    throw error
  }
}

async function parsePaystackError(response: Response): Promise<never> {
  const payload = await response.json().catch(() => ({}))
  const message =
    typeof payload?.message === 'string'
      ? payload.message
      : `Paystack request failed with status ${response.status}`
  throw new Error(`Paystack error: ${message}`)
}

export async function initializePaystackTransaction(options: {
  amount: number
  currency: string
  email: string
  reference: string
  callbackUrl: string
  metadata?: Record<string, unknown>
}): Promise<PaystackTransaction> {
  const amount = providerAmountMinorUnits(options.amount, options.currency)
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: String(amount),
      currency: options.currency.toUpperCase(),
      email: options.email,
      reference: options.reference,
      callback_url: options.callbackUrl,
      metadata: options.metadata ?? {},
    }),
  }, 'transaction initialization')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data?.reference || !payload?.data?.authorization_url) {
    throw new Error('Paystack did not return a usable checkout session.')
  }

  return payload.data as PaystackTransaction
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackTransaction> {
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: authHeaders(),
  }, 'payment verification')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data?.reference) {
    throw new Error('Paystack did not return a valid verification payload.')
  }

  return payload.data as PaystackTransaction
}

export async function verifyPaystackTransfer(reference: string): Promise<PaystackTransfer> {
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transfer/verify/${encodeURIComponent(reference)}`, {
    headers: authHeaders(),
  }, 'transfer verification')

  if (!response.ok) await parsePaystackError(response)
  const payload = await response.json()
  if (!payload?.status || !payload?.data) {
    throw new Error('Paystack did not return a valid transfer verification payload.')
  }
  return payload.data as PaystackTransfer
}

export async function retrievePaystackRefund(refundId: string): Promise<PaystackRefund> {
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/refund/${encodeURIComponent(refundId)}`, {
    headers: authHeaders(),
  }, 'refund reconciliation')

  if (!response.ok) await parsePaystackError(response)
  const payload = await response.json()
  if (!payload?.status || !payload?.data) {
    throw new Error('Paystack did not return a valid refund reconciliation payload.')
  }
  return payload.data as PaystackRefund
}

export async function refundPaystackTransaction(options: {
  reference: string
  amount?: number
  currency?: string | null
  reasonNote?: string | null
}): Promise<PaystackRefund> {
  const amount = typeof options.amount === 'number'
    ? providerAmountMinorUnits(options.amount, options.currency)
    : undefined
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/refund`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transaction: options.reference,
      ...(amount !== undefined && amount > 0 ? { amount } : {}),
      ...(options.currency?.trim() ? { currency: options.currency.trim().toUpperCase() } : {}),
      ...(options.reasonNote?.trim()
        ? {
            customer_note: options.reasonNote.trim(),
            merchant_note: options.reasonNote.trim(),
          }
        : {}),
    }),
  }, 'refund request')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status) {
    throw new Error('Paystack did not confirm the refund request.')
  }

  return payload.data as PaystackRefund
}

export async function createPaystackTransfer(options: {
  amount: number
  recipientCode: string
  reason: string
  reference: string
  currency?: string | null
}): Promise<PaystackTransfer> {
  const amount = providerAmountMinorUnits(options.amount, options.currency)
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transfer`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: 'balance',
      amount,
      recipient: options.recipientCode.trim(),
      reason: options.reason.trim(),
      reference: options.reference.trim(),
      ...(options.currency?.trim() ? { currency: options.currency.trim().toUpperCase() } : {}),
    }),
  }, 'transfer request')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data) {
    throw new Error('Paystack did not confirm the transfer request.')
  }

  return payload.data as PaystackTransfer
}

export async function finalizePaystackTransfer(options: {
  transferCode: string
  otp: string
}): Promise<PaystackTransfer> {
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transfer/finalize_transfer`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transfer_code: options.transferCode.trim(),
      otp: options.otp.trim(),
    }),
  }, 'transfer OTP finalization')

  if (!response.ok) {
    await parsePaystackError(response)
  }

  const payload = await response.json()
  if (!payload?.status || !payload?.data) {
    throw new Error('Paystack did not confirm the transfer finalization.')
  }

  return payload.data as PaystackTransfer
}

export async function resendPaystackTransferOtp(transferCode: string): Promise<void> {
  const response = await fetchPaystack(`${PAYSTACK_API_BASE}/transfer/resend_otp`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transfer_code: transferCode.trim(),
      reason: 'transfer',
    }),
  }, 'transfer OTP resend')

  if (!response.ok) await parsePaystackError(response)
  const payload = await response.json()
  if (!payload?.status) {
    throw new Error('Paystack did not confirm the transfer OTP resend.')
  }
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

export async function verifyPaystackWebhookSignature(options: {
  payload: string
  signatureHeader: string
}) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(getPaystackSecretKey()),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign('HMAC', key, textEncoder.encode(options.payload))
  const expected = hex(digest)

  if (!secureEqual(options.signatureHeader, expected)) {
    throw new Error('No Paystack webhook signatures matched the expected signature.')
  }
}
