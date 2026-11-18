import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import {
  prepareBachsCheckoutAttempt,
  type BachsCheckoutAttempt,
  type BachsCheckoutGateway,
  type BachsCheckoutStore,
} from './bachs-checkout-attempt.ts'
import { BachsRequestError } from './bachs.ts'

const initial: BachsCheckoutAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  idempotency_key: 'bachs-checkout:order-1:initial',
  provider: 'BACHS',
  provider_request_state: 'RESERVED',
  provider_payment_id: null,
  status: 'INITIATED',
  amount: 700123,
  currency: 'NGN',
}

const checkout = {
  checkout_id: 'chk_Test123', status: 'open', amount: '7001.23',
  currency: 'NGN', reference: initial.idempotency_key,
  checkout_url: 'https://checkout.bachs.io/test',
}

function fixture() {
  let row = { ...initial }
  let posts = 0
  let gets = 0
  let failBind = false
  let failReject = false
  let rejects = 0
  const store: BachsCheckoutStore = {
    async claim(_id, key) {
      assertEquals(key, row.idempotency_key)
      if (row.provider_request_state !== 'RESERVED' && row.provider_request_state !== 'REJECTED') return false
      row = { ...row, provider_request_state: 'SENT', status: 'INITIATED' }
      return true
    },
    async load() { return { ...row } },
    async bind(_id, _key, result) {
      if (failBind) throw new Error('database unavailable')
      row = { ...row, provider_request_state: 'BOUND', provider_payment_id: result.checkout_id, provider_checkout_url: result.checkout_url, status: 'PENDING' }
    },
    async reject(_id, _key, _evidence) {
      rejects++
      if (failReject) throw new Error('database unavailable')
      row = { ...row, provider_request_state: 'REJECTED' }
    },
  }
  const gateway: BachsCheckoutGateway = {
    async create() { posts++; return checkout },
    async retrieve(id) { gets++; assertEquals(id, checkout.checkout_id); return checkout },
  }
  return {
    store,
    gateway,
    get row() { return row },
    get posts() { return posts },
    get gets() { return gets },
    get rejects() { return rejects },
    set failBind(value: boolean) { failBind = value },
    set failReject(value: boolean) { failReject = value },
  }
}

Deno.test('one claimed checkout is bound and later calls retrieve without another POST', async () => {
  const f = fixture()
  const first = await prepareBachsCheckoutAttempt({ attempt: initial, expiresInMinutes: 20, store: f.store, gateway: f.gateway })
  const second = await prepareBachsCheckoutAttempt({ attempt: initial, expiresInMinutes: 20, store: f.store, gateway: f.gateway })
  assertEquals(first, { state: 'READY', checkout, reused: false })
  assertEquals(second, { state: 'READY', checkout, reused: true })
  assertEquals([f.posts, f.gets], [1, 2])
})

Deno.test('documented create response without amount is bound before GET verifies the accepted amount', async () => {
  const f = fixture()
  let posts = 0
  const result = await prepareBachsCheckoutAttempt({
    attempt: initial,
    expiresInMinutes: 20,
    store: f.store,
    gateway: {
      async create() {
        posts++
        return {
          checkout_id: checkout.checkout_id,
          status: 'open',
          reference: initial.idempotency_key,
          checkout_url: checkout.checkout_url,
        }
      },
      retrieve: f.gateway.retrieve,
    },
  })
  assertEquals(result.state, 'READY')
  assertEquals(f.row.provider_request_state, 'BOUND')
  assertEquals(posts, 1)
})

Deno.test('crash after request claim never sends a second checkout', async () => {
  const f = fixture()
  await f.store.claim(initial.id, initial.idempotency_key)
  const result = await prepareBachsCheckoutAttempt({ attempt: initial, expiresInMinutes: 20, store: f.store, gateway: f.gateway })
  assertEquals(result, { state: 'UNCERTAIN' })
  assertEquals(f.posts, 0)
})

Deno.test('failed bind after provider response keeps request uncertain and never re-POSTs', async () => {
  const f = fixture()
  f.failBind = true
  await assertRejects(() => prepareBachsCheckoutAttempt({ attempt: initial, expiresInMinutes: 20, store: f.store, gateway: f.gateway }))
  assertEquals(f.row.provider_request_state, 'SENT')
  const retry = await prepareBachsCheckoutAttempt({ attempt: initial, expiresInMinutes: 20, store: f.store, gateway: f.gateway })
  assertEquals(retry, { state: 'UNCERTAIN' })
  assertEquals(f.posts, 1)
})

Deno.test('a second simultaneous call does not create a second checkout', async () => {
  const f = fixture()
  const results = await Promise.all([
    prepareBachsCheckoutAttempt({ attempt: initial, expiresInMinutes: 20, store: f.store, gateway: f.gateway }),
    prepareBachsCheckoutAttempt({ attempt: initial, expiresInMinutes: 20, store: f.store, gateway: f.gateway }),
  ])
  assertEquals(f.posts, 1)
  assertEquals(results.filter((result) => result.state === 'READY').length, 1)
})

Deno.test('a definite provider rejection is recorded and the same attempt can retry', async () => {
  const f = fixture()
  let rejects = 1
  const gateway: BachsCheckoutGateway = {
    async create() {
      if (rejects-- > 0) {
        throw new BachsRequestError(
          'Bachs request failed (400 VALIDATION_ERROR).',
          400,
          'VALIDATION_ERROR',
          false,
          'req_test',
          null,
          ['email'],
        )
      }
      return checkout
    },
    retrieve: f.gateway.retrieve,
  }
  const rejected = await prepareBachsCheckoutAttempt({
    attempt: initial, expiresInMinutes: 20, store: f.store, gateway,
  })
  assertEquals(rejected, {
    state: 'REJECTED', httpStatus: 400, providerCode: 'VALIDATION_ERROR',
    validationFields: ['email'],
  })
  assertEquals(f.row.provider_request_state, 'REJECTED')
  assertEquals(f.row.status, 'INITIATED')

  const retried = await prepareBachsCheckoutAttempt({
    attempt: initial, expiresInMinutes: 20, store: f.store, gateway,
  })
  assertEquals(retried, { state: 'READY', checkout, reused: false })
  assertEquals(f.row.provider_request_state, 'BOUND')
})

Deno.test('an uncertain provider failure remains SENT and cannot re-POST', async () => {
  const f = fixture()
  const gateway: BachsCheckoutGateway = {
    async create() {
      throw new BachsRequestError(
        'Bachs request outcome could not be confirmed.', null, null, true, null, null,
      )
    },
    retrieve: f.gateway.retrieve,
  }
  await assertRejects(() => prepareBachsCheckoutAttempt({
    attempt: initial, expiresInMinutes: 20, store: f.store, gateway,
  }), BachsRequestError)
  assertEquals(f.row.provider_request_state, 'SENT')
  const retry = await prepareBachsCheckoutAttempt({
    attempt: initial, expiresInMinutes: 20, store: f.store, gateway,
  })
  assertEquals(retry, { state: 'UNCERTAIN' })
})

Deno.test('408 and 409 responses remain uncertain and never mark the attempt rejected', async () => {
  for (const status of [408, 409]) {
    const f = fixture()
    const gateway: BachsCheckoutGateway = {
      async create() {
        throw new BachsRequestError(
          'Bachs request outcome could not be confirmed.', status, 'CONFLICT', false, null, null,
        )
      },
      retrieve: f.gateway.retrieve,
    }
    await assertRejects(() => prepareBachsCheckoutAttempt({
      attempt: initial, expiresInMinutes: 20, store: f.store, gateway,
    }), BachsRequestError)
    assertEquals(f.row.provider_request_state, 'SENT')
    assertEquals(f.rejects, 0)
    const retry = await prepareBachsCheckoutAttempt({
      attempt: initial, expiresInMinutes: 20, store: f.store, gateway,
    })
    assertEquals(retry, { state: 'UNCERTAIN' })
    assertEquals(f.posts, 0)
  }
})

Deno.test('failed rejection persistence leaves the attempt SENT and prevents a second POST', async () => {
  const f = fixture()
  f.failReject = true
  const gateway: BachsCheckoutGateway = {
    async create() {
      throw new BachsRequestError('Bachs validation failed.', 400, 'VALIDATION_ERROR', false, null, null)
    },
    retrieve: f.gateway.retrieve,
  }
  await assertRejects(() => prepareBachsCheckoutAttempt({
    attempt: initial, expiresInMinutes: 20, store: f.store, gateway,
  }))
  assertEquals(f.row.provider_request_state, 'SENT')
  assertEquals(f.posts, 0)
  const retry = await prepareBachsCheckoutAttempt({
    attempt: initial, expiresInMinutes: 20, store: f.store, gateway,
  })
  assertEquals(retry, { state: 'UNCERTAIN' })
  assertEquals(f.posts, 0)
})
