import { decimalStringToMinor, minorToDecimalString } from '../../../packages/shared/src/money-units.ts'
import { supabaseProjectEnvironment } from './env.ts'

export type BachsEnvironment = 'SANDBOX' | 'PRODUCTION'
type BachsMethod = 'GET' | 'POST' | 'PATCH'

export class BachsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
    readonly uncertainWrite: boolean,
    readonly requestId: string | null,
    readonly retryAfterSeconds: number | null,
    readonly validationFields: readonly string[] = [],
  ) {
    super(message)
    this.name = 'BachsRequestError'
  }
}

// Provider messages can contain customer data. Record only known field names.
function bachsValidationFields(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const data = payload as { error_code?: unknown; errors?: unknown; detail?: unknown }
  if (data.error_code !== 'VALIDATION_ERROR') return []
  const allowed = ['contact_email', 'display_name', 'country', 'entity_type', 'configuration', 'responsibilities']
  const raw = [
    ...(Array.isArray(data.errors) ? data.errors.map((entry: unknown) =>
      entry && typeof entry === 'object' ? (entry as { field?: unknown }).field : null
    ) : []),
    data.detail,
  ].filter((value): value is string => typeof value === 'string')
  return allowed.filter((field) => raw.some((value) =>
    new RegExp(`(^|[^a-zA-Z0-9_])${field}([^a-zA-Z0-9_]|$)`, 'u').test(value)
  ))
}

/** Bachs speaks major-unit decimal strings; Drapeon persists integer minor units. */
export function bachsAmount(amountMinor: number, currency: string): string {
  return minorToDecimalString(amountMinor, currency)
}

export function bachsAmountMinor(amount: string, currency: string): number {
  return decimalStringToMinor(amount, currency)
}

/** Balance endpoints may report debt; transaction amounts remain non-negative. */
export function bachsBalanceAmountMinor(amount: string, currency: string): number {
  const negative = amount.startsWith('-')
  const unsigned = negative ? amount.slice(1) : amount
  const minor = decimalStringToMinor(unsigned, currency)
  return negative ? -minor : minor
}

export function bachsEnvironmentForSupabaseUrl(supabaseUrl: string): BachsEnvironment {
  const environment = supabaseProjectEnvironment(supabaseUrl)
  if (environment === 'DEVELOPMENT') return 'SANDBOX'
  if (environment === 'PRODUCTION') return 'PRODUCTION'
  throw new Error('Bachs is unavailable for an unknown Supabase environment.')
}

export function selectBachsKey(
  environment: BachsEnvironment,
  keys: { sandbox?: string | null; live?: string | null; legacy?: string | null },
): string {
  const key = (environment === 'SANDBOX' ? keys.sandbox : keys.live)?.trim() || keys.legacy?.trim()
  const prefix = environment === 'SANDBOX' ? 'sk_sandbox_' : 'sk_live_'
  if (!key?.startsWith(prefix) || key.length <= prefix.length) {
    throw new Error(`Missing or mismatched Bachs ${environment.toLowerCase()} API key.`)
  }
  return key
}

function readRuntimeConfig(): { environment: BachsEnvironment; key: string } {
  const environment = bachsEnvironmentForSupabaseUrl(Deno.env.get('SUPABASE_URL') ?? '')
  const key = selectBachsKey(environment, {
    sandbox: Deno.env.get('BACHS_SANDBOX_API_KEY'),
    live: Deno.env.get('BACHS_LIVE_API_KEY'),
    legacy: Deno.env.get('BACHS_API_KEY'),
  })
  return { environment, key }
}

export function createBachsClient(options: {
  environment: BachsEnvironment
  key: string
  fetcher?: typeof fetch
}) {
  const key = selectBachsKey(options.environment, {
    sandbox: options.environment === 'SANDBOX' ? options.key : null,
    live: options.environment === 'PRODUCTION' ? options.key : null,
  })
  const base = options.environment === 'SANDBOX' ? 'https://sandbox-api.bachs.io' : 'https://api.bachs.io'
  const fetcher = options.fetcher ?? fetch

  return {
    async request<T>(input: {
      method: BachsMethod
      path: `/v1/${string}`
      body?: unknown
      idempotencyKey?: string
      accountId?: string
    }): Promise<T> {
      if (!input.path.startsWith('/v1/') || input.path.includes('://')) {
        throw new Error('Invalid Bachs API path.')
      }
      const write = input.method !== 'GET'
      const idempotencyKey = input.idempotencyKey?.trim()
      if (write && (!idempotencyKey || idempotencyKey.length > 255)) {
        throw new Error('A fixed Bachs idempotency key is required for every write.')
      }
      if (!write && input.body !== undefined) throw new Error('Bachs GET requests cannot have a body.')
      const headers: Record<string, string> = {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      }
      if (write) {
        headers['Content-Type'] = 'application/json'
        headers['Idempotency-Key'] = idempotencyKey!
      }
      if (input.accountId?.trim()) headers['X-Account-Id'] = input.accountId.trim()

      let response: Response
      try {
        response = await fetcher(`${base}${input.path}`, {
          method: input.method,
          headers,
          ...(write ? { body: JSON.stringify(input.body ?? {}) } : {}),
        })
      } catch {
        throw new BachsRequestError('Bachs request outcome could not be confirmed.', null, null, write, null, null)
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const code = typeof payload?.error_code === 'string' ? payload.error_code : null
        const retryAfterHeader = response.headers.get('Retry-After')
        const retryAfter = retryAfterHeader === null ? NaN : Number(retryAfterHeader)
        throw new BachsRequestError(
          `Bachs request failed (${response.status}${code ? ` ${code}` : ''}).`,
          response.status,
          code,
          write && (response.status >= 500 || code === 'IDEMPOTENCY_IN_PROGRESS'),
          response.headers.get('X-Request-Id'),
          Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
          bachsValidationFields(payload),
        )
      }
      if (!payload || typeof payload !== 'object') {
        throw new BachsRequestError('Bachs returned an invalid response.', response.status, null, write, response.headers.get('X-Request-Id'), null)
      }
      return payload as T
    },
  }
}

/** Only server-side Edge functions call this; never expose the key in a client bundle. */
export function getBachsClient() {
  return createBachsClient(readRuntimeConfig())
}
