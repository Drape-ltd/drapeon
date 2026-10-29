import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import {
  prepareBachsCheckoutAttempt,
  type BachsCheckoutAttempt,
  type BachsCheckoutGateway,
  type BachsCheckoutStore,
} from './bachs-checkout-attempt.ts'

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
  const store: BachsCheckoutStore = {
    async claim(_id, key) {
      assertEquals(key, row.idempotency_key)
      if (row.provider_request_state !== 'RESERVED') return false
      row = { ...row, provider_request_state: 'SENT' }
      return true
    },
    async load() { return { ...row } },
    async bind(_id, _key, result) {
      if (failBind) throw new Error('database unavailable')
      row = { ...row, provider_request_state: 'BOUND', provider_payment_id: result.checkout_id, provider_checkout_url: result.checkout_url, status: 'PENDING' }
    },
  }
  const gateway: BachsCheckoutGateway = {
    async create() { posts++; return checkout },
    async retrieve(id) { gets++; assertEquals(id, checkout.checkout_id); return checkout },
  }
  return { store, gateway, get row() { return row }, get posts() { return posts }, get gets() { return gets }, set failBind(value: boolean) { failBind = value } }
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
