import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import {
  BachsRequestError,
  bachsAmount,
  bachsAmountMinor,
  bachsEnvironmentForSupabaseUrl,
  createBachsClient,
  getBachsSandboxPayoutsClient,
  selectBachsKey,
} from './bachs.ts'

Deno.test('Bachs key and host are selected from the exact Supabase environment', () => {
  assertEquals(bachsEnvironmentForSupabaseUrl('https://pqptfuqogvrajozfsqzi.supabase.co'), 'SANDBOX')
  assertEquals(bachsEnvironmentForSupabaseUrl('https://wkfsrunetmgjdtcurmoj.supabase.co'), 'PRODUCTION')
  assertThrows(() => bachsEnvironmentForSupabaseUrl('https://pqptfuqogvrajozfsqzi.supabase.co.evil.test'))
  assertEquals(selectBachsKey('SANDBOX', { sandbox: 'sk_sandbox_example', live: 'sk_live_example' }), 'sk_sandbox_example')
  assertThrows(() => selectBachsKey('PRODUCTION', { legacy: 'sk_sandbox_example' }))
})

Deno.test('the payout-proof client is Dev-only and denies non-payout writes', async () => {
  const oldUrl = Deno.env.get('SUPABASE_URL')
  const oldKey = Deno.env.get('BACHS_SANDBOX_PAYOUTS_API_KEY')
  try {
    Deno.env.set('SUPABASE_URL', 'https://pqptfuqogvrajozfsqzi.supabase.co')
    Deno.env.set('BACHS_SANDBOX_PAYOUTS_API_KEY', 'sk_sandbox_test_only')
    const client = getBachsSandboxPayoutsClient()
    assertThrows(() => client.request({
      method: 'POST',
      path: '/v1/transfers',
      body: {},
      idempotencyKey: 'not-allowed',
    }), Error, 'cannot call this Bachs endpoint')

    Deno.env.set('SUPABASE_URL', 'https://wkfsrunetmgjdtcurmoj.supabase.co')
    assertThrows(() => getBachsSandboxPayoutsClient(), Error, 'only available in Supabase Dev')
  } finally {
    if (oldUrl === undefined) Deno.env.delete('SUPABASE_URL')
    else Deno.env.set('SUPABASE_URL', oldUrl)
    if (oldKey === undefined) Deno.env.delete('BACHS_SANDBOX_PAYOUTS_API_KEY')
    else Deno.env.set('BACHS_SANDBOX_PAYOUTS_API_KEY', oldKey)
  }
})

Deno.test('Bachs decimal strings round-trip through shared minor-unit helper', () => {
  for (const currency of ['NGN', 'GBP', 'USD']) {
    assertEquals(bachsAmount(700001, currency), '7000.01')
    assertEquals(bachsAmountMinor('7000.01', currency), 700001)
  }
  assertThrows(() => bachsAmountMinor('7000.001', 'NGN'))
  assertEquals(bachsAmountMinor('109.650000000000000000', 'NGN'), 10965)
  assertThrows(() => bachsAmountMinor('109.650000000000000001', 'NGN'))
})

Deno.test('Bachs writes require one fixed key and send JSON to the sandbox only', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const client = createBachsClient({
    environment: 'SANDBOX',
    key: 'sk_sandbox_example',
    fetcher: ((url: string, init: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify({ id: 'tr_test' }), { status: 201 }))
    }) as typeof fetch,
  })
  await assertRejects(() => client.request({ method: 'POST', path: '/v1/transfers', body: { amount: '7.00' } }))
  assertEquals(calls.length, 0)
  assertEquals(await client.request<{ id: string }>({
    method: 'POST', path: '/v1/transfers', body: { amount: '7.00' }, idempotencyKey: 'claim:test:op:1',
  }), { id: 'tr_test' })
  assertEquals(calls[0].url, 'https://sandbox-api.bachs.io/v1/transfers')
  assertEquals(new Headers(calls[0].init.headers).get('Idempotency-Key'), 'claim:test:op:1')
  assertEquals(new Headers(calls[0].init.headers).get('User-Agent'), 'Drapeon-Server/1.0')
  assertEquals(calls[0].init.body, '{"amount":"7.00"}')
  await client.request({ method: 'GET', path: '/v1/balances' })
  assertEquals(new Headers(calls[1].init.headers).get('User-Agent'), 'Drapeon-Server/1.0')
})

Deno.test('Bachs bank discovery refuses requests that omit the explicit NG country scope', async () => {
  let calls = 0
  const client = createBachsClient({
    environment: 'SANDBOX',
    key: 'sk_sandbox_example',
    fetcher: (() => {
      calls++
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }) as typeof fetch,
  })

  await assertRejects(() => client.request({
    method: 'POST',
    path: '/v1/misc/bank-accounts/resolve',
    body: { account_number: '0000000000', bank_code: '033' },
    idempotencyKey: 'bank-resolve:test',
  }), Error, 'requires country=NG')
  await assertRejects(() => client.request({
    method: 'GET',
    path: '/v1/reference/banks',
  }), Error, 'requires country=NG')
  assertEquals(calls, 0)
})

Deno.test('Bachs uncertain writes fail closed and do not auto-retry', async () => {
  let calls = 0
  const client = createBachsClient({
    environment: 'SANDBOX', key: 'sk_sandbox_example',
    fetcher: (() => { calls++; return Promise.reject(new Error('network timeout')) }) as typeof fetch,
  })
  const error = await assertRejects(() => client.request({
    method: 'POST', path: '/v1/checkout-sessions', body: {}, idempotencyKey: 'checkout:test',
  }), BachsRequestError)
  assertEquals(error.uncertainWrite, true)
  assertEquals(calls, 1)
})

Deno.test('Bachs errors expose status and retry delay without leaking response details', async () => {
  const client = createBachsClient({
    environment: 'PRODUCTION', key: 'sk_live_example',
    fetcher: (() => Promise.resolve(new Response(JSON.stringify({ error_code: 'RATE_LIMITED', detail: 'private data' }), {
      status: 429, headers: { 'Retry-After': '5', 'X-Request-Id': 'req_test' },
    }))) as typeof fetch,
  })
  const error = await assertRejects(() => client.request({ method: 'GET', path: '/v1/balances' }), BachsRequestError)
  assertEquals(error.retryAfterSeconds, 5)
  assertEquals(error.requestId, 'req_test')
  assertEquals(error.uncertainWrite, false)
  assertEquals(error.message.includes('private data'), false)
})

Deno.test('Bachs refund balance refusal is classified without retaining provider text', async () => {
  const client = createBachsClient({
    environment: 'SANDBOX', key: 'sk_sandbox_example',
    fetcher: (() => Promise.resolve(new Response(JSON.stringify({
      message: 'Insufficient balance to refund',
      detail: 'private account detail',
    }), { status: 400, headers: { 'X-Request-Id': 'req_refund_balance' } }))) as typeof fetch,
  })
  const error = await assertRejects(() => client.request({
    method: 'POST', path: '/v1/refunds', body: { charge_id: 'ch_test' }, idempotencyKey: 'refund:test',
  }), BachsRequestError)
  assertEquals(error.status, 400)
  assertEquals(error.safeReason, 'INSUFFICIENT_REFUND_BALANCE')
  assertEquals(error.requestId, 'req_refund_balance')
  assertEquals(JSON.stringify(error).includes('private account detail'), false)
  assertEquals(error.message.includes('Insufficient balance to refund'), false)
})

Deno.test('Bachs validation diagnostics retain only known field names', async () => {
  const client = createBachsClient({
    environment: 'SANDBOX', key: 'sk_sandbox_example',
    fetcher: (() => Promise.resolve(new Response(JSON.stringify({
      error_code: 'VALIDATION_ERROR',
      detail: 'contact_email failed for private@example.com',
      errors: [{ field: 'body.configuration.recipient', message: 'private@example.com' },
        { field: 'private@example.com', type: 'invalid' }],
    }), { status: 400 }))) as typeof fetch,
  })
  const error = await assertRejects(() => client.request({
    method: 'POST', path: '/v1/accounts', body: {}, idempotencyKey: 'account:test',
  }), BachsRequestError)
  assertEquals(error.validationFields, ['contact_email', 'configuration'])
  assertEquals(JSON.stringify(error).includes('private@example.com'), false)
  assertEquals(error.uncertainWrite, false)
})

Deno.test('Bachs validation diagnostics expose checkout field names without values', async () => {
  const client = createBachsClient({
    environment: 'SANDBOX', key: 'sk_sandbox_example',
    fetcher: (() => Promise.resolve(new Response(JSON.stringify({
      error_code: 'VALIDATION_ERROR',
      errors: [
        { field: 'body.payment_method_types', message: 'private provider detail' },
        { field: 'body.customer.email', message: 'buyer@example.com' },
      ],
    }), { status: 400 }))) as typeof fetch,
  })
  const error = await assertRejects(() => client.request({
    method: 'POST', path: '/v1/checkout-sessions', body: {}, idempotencyKey: 'checkout:test',
  }), BachsRequestError)
  assertEquals(error.validationFields, ['customer', 'email', 'payment_method_types'])
  assertEquals(JSON.stringify(error).includes('buyer@example.com'), false)
  assertEquals(error.uncertainWrite, false)
})

Deno.test('a concurrent idempotency conflict remains an uncertain write', async () => {
  const client = createBachsClient({
    environment: 'SANDBOX', key: 'sk_sandbox_example',
    fetcher: (() => Promise.resolve(new Response(JSON.stringify({ error_code: 'IDEMPOTENCY_IN_PROGRESS' }), {
      status: 409,
    }))) as typeof fetch,
  })
  const error = await assertRejects(() => client.request({
    method: 'POST', path: '/v1/transfers', body: { amount: '7.00' }, idempotencyKey: 'claim:test:op:1',
  }), BachsRequestError)
  assertEquals(error.uncertainWrite, true)
})

Deno.test('Bachs 408 and 409 write responses remain uncertain', async () => {
  for (const status of [408, 409]) {
    const client = createBachsClient({
      environment: 'SANDBOX', key: 'sk_sandbox_example',
      fetcher: (() => Promise.resolve(new Response(JSON.stringify({ error_code: 'CONFLICT' }), {
        status,
      }))) as typeof fetch,
    })
    const error = await assertRejects(() => client.request({
      method: 'POST', path: '/v1/checkout-sessions', body: {}, idempotencyKey: `checkout:${status}`,
    }), BachsRequestError)
    assertEquals(error.uncertainWrite, true)
  }
})
