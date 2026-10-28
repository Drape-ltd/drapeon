import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { createBachsClient } from './bachs.ts'
import {
  createBachsCheckout,
  createBachsOnboardingLink,
  createBachsRecipientAccount,
  createBachsTransfer,
  assertBachsTransferBalance,
  getBachsBalances,
  getBachsPayment,
  getBachsWebhookEvent,
} from './bachs-operations.ts'

function mockBachs(response: Record<string, unknown>) {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
  const client = createBachsClient({
    environment: 'SANDBOX',
    key: 'sk_sandbox_example',
    fetcher: ((url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: new Headers(init.headers),
        body: init.body ? JSON.parse(String(init.body)) : {},
      })
      return Promise.resolve(new Response(JSON.stringify(response), { status: 201 }))
    }) as typeof fetch,
  })
  return { client, calls }
}

Deno.test(
  'recipient account requests only transfers and payouts with frozen collector',
  async () => {
    const { client, calls } = mockBachs({
      id: 'acct_test',
      country: 'NG',
      responsibilities: { fees: { collector: 'platform' } },
    })
    await createBachsRecipientAccount(client, {
      email: 'qa@example.invalid',
      displayName: 'QA Tailor',
      country: 'NG',
      feesCollector: 'PLATFORM',
      idempotencyKey: 'tailor:test:account',
    })
    assertEquals(calls[0].body.configuration, {
      recipient: {
        capabilities: {
          transfers: { requested: true },
          payouts: { requested: true },
        },
      },
    })
    assertEquals(calls[0].body.responsibilities, {
      fees: { collector: 'platform' },
    })
    assertEquals(calls[0].headers.get('Idempotency-Key'), 'tailor:test:account')
  }
)

Deno.test('read-only reconciliation retrieves the exact charge and event IDs', async () => {
  const payment = mockBachs({
    payment_id: 'ch_test',
    checkout_id: 'chk_test',
    reference: 'payment:test',
    status: 'succeeded',
    amount: '7000.00',
    currency: 'NGN',
  })
  assertEquals((await getBachsPayment(payment.client, 'ch_test')).checkout_id, 'chk_test')
  assertEquals(payment.calls[0].url.endsWith('/v1/payments/ch_test'), true)
  const event = mockBachs({
    event_id: 'evt_test',
    event_type: 'collection.succeeded',
    payload: { id: 'evt_test', type: 'collection.succeeded' },
  })
  assertEquals(
    (await getBachsWebhookEvent(event.client, 'evt_test')).event_type,
    'collection.succeeded'
  )
  assertEquals(event.calls[0].url.endsWith('/v1/webhooks/events/evt_test'), true)
})

Deno.test(
  'hosted onboarding link is account-bound and restricted to Bachs HTTPS hosts',
  async () => {
    const good = mockBachs({
      id: 'alnk_test',
      account: 'acct_test',
      url: 'https://onboarding.bachs.io/link',
      expires_at: '2026-10-27T13:00:00Z',
    })
    const link = await createBachsOnboardingLink(good.client, {
      accountId: 'acct_test',
      refreshUrl: 'https://drapeon.co/refresh',
      returnUrl: 'https://drapeon.co/return',
      idempotencyKey: 'onboarding-link:test:1',
    })
    assertEquals(link.url, 'https://onboarding.bachs.io/link')

    const hostile = mockBachs({
      id: 'alnk_test',
      account: 'acct_test',
      url: 'https://attacker.example/link',
      expires_at: '2026-10-27T13:00:00Z',
    })
    await assertRejects(() =>
      createBachsOnboardingLink(hostile.client, {
        accountId: 'acct_test',
        refreshUrl: 'https://drapeon.co/refresh',
        returnUrl: 'https://drapeon.co/return',
        idempotencyKey: 'onboarding-link:test:2',
      })
    )
  }
)

Deno.test(
  'checkout sends accepted total as decimal string and refuses amount mismatch',
  async () => {
    const { client, calls } = mockBachs({
      checkout_id: 'chk_test',
      status: 'open',
      amount: '7000.01',
      currency: 'NGN',
      checkout_url: 'https://checkout.bachs.io/c/test',
    })
    await createBachsCheckout(client, {
      amountMinor: 700001,
      currency: 'NGN',
      customerEmail: 'qa@example.invalid',
      reference: 'order:test:initial',
      successUrl: 'https://drapeon.co/payments/return',
      cancelUrl: 'https://drapeon.co/orders/test',
      expiresInMinutes: 30,
      idempotencyKey: 'order:test:initial',
    })
    assertEquals(calls[0].body.pricing, { amount: '7000.01', currency: 'NGN' })
    assertEquals(calls[0].body.customer_bears_fee, false)
    assertEquals(calls[0].body.expires_in_minutes, 30)
    const mismatch = mockBachs({
      checkout_id: 'chk_test',
      status: 'open',
      amount: '7000.02',
      currency: 'NGN',
      checkout_url: 'https://checkout.bachs.io/c/test',
    })
    await assertRejects(() =>
      createBachsCheckout(mismatch.client, {
        amountMinor: 700001,
        currency: 'NGN',
        customerEmail: 'qa@example.invalid',
        reference: 'order:test:initial',
        successUrl: 'https://drapeon.co/payments/return',
        cancelUrl: 'https://drapeon.co/orders/test',
        expiresInMinutes: 30,
        idempotencyKey: 'order:test:initial',
      })
    )
  }
)

Deno.test('transfer preserves the claim amount, destination, group and operation key', async () => {
  const { client, calls } = mockBachs({
    id: 'tr_test',
    destination: 'acct_test',
    amount: '5600.01',
    currency: 'NGN',
    status: 'pending',
    transfer_group: 'order:test',
  })
  await createBachsTransfer(client, {
    destinationAccountId: 'acct_test',
    amountMinor: 560001,
    currency: 'NGN',
    transferGroup: 'order:test',
    description: 'Tailor earning',
    idempotencyKey: 'claim:test:op:1',
  })
  assertEquals(calls[0].body.amount, '5600.01')
  assertEquals(calls[0].body.transfer_group, 'order:test')
  assertEquals(calls[0].headers.get('Idempotency-Key'), 'claim:test:op:1')
})

Deno.test('transfer balance preflight reads available balances only', async () => {
  const { client, calls } = mockBachs({
    account_id: 'org_test',
    balances: [
      { currency: 'NGN', available_balance: '7000.00', pending_balance: '900.00' },
      { currency: 'USD', available_balance: '10.00', pending_balance: '0.00' },
    ],
  })
  const balances = await getBachsBalances(client)
  assertEquals(calls[0].url.endsWith('/v1/balances'), true)
  assertEquals(calls[0].headers.has('Idempotency-Key'), false)
  assertBachsTransferBalance(balances, { amountMinor: 700000, currency: 'NGN' })
  await assertRejects(async () => assertBachsTransferBalance(
    balances,
    { amountMinor: 790000, currency: 'NGN' },
  ))
  await assertRejects(async () => assertBachsTransferBalance(
    balances,
    { amountMinor: 1, currency: 'KES' },
  ))
})

Deno.test('any negative platform currency blocks transfers, even if the target currency is funded', async () => {
  await assertRejects(async () => assertBachsTransferBalance({
    account_id: 'org_test',
    balances: [
      { currency: 'NGN', available_balance: '7000.00', pending_balance: '0.00' },
      { currency: 'USD', available_balance: '-1.00', pending_balance: '0.00' },
    ],
  }, { amountMinor: 100, currency: 'NGN' }))
})
