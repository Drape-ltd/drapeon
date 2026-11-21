import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1'
import { createBachsClient } from './bachs.ts'
import {
  createBachsCheckout,
  createBachsOnboardingLink,
  createBachsRefund,
  createBachsRecipientAccount,
  createBachsTransfer,
  createBachsRefundRecoveryTransfer,
  findBachsRefundRecoveryTransfer,
  createBachsPayout,
  assertBachsPayoutFeeMatchesTopUp,
  BachsPayoutFeeTopUpMismatchError,
  createBachsPayoutDestination,
  assertBachsTransferBalance,
  getBachsBalances,
  getBachsPayout,
  getBachsPayment,
  getBachsRefundByCharge,
  getBachsWebhookEvent,
  listBachsPayouts,
  listBachsPayoutDestinations,
  listBachsTransfers,
  listBachsNigerianBanks,
  resolveBachsNigerianBankAccount,
  type BachsTransfer,
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

Deno.test('Nigerian bank discovery always sends the explicit NG country scope', async () => {
  const banks = mockBachs({ country: 'NG', banks: [{ code: '033', name: 'Test Bank' }] })
  await listBachsNigerianBanks(banks.client)
  const listUrl = new URL(banks.calls[0].url)
  assertEquals(listUrl.pathname, '/v1/reference/banks')
  assertEquals(listUrl.searchParams.get('country'), 'NG')

  const resolution = mockBachs({
    resolved: true,
    lookup_supported: true,
    account_name: 'Test Bank Account - Success',
    bank_id: 'bank_test',
    bank_account_id: 'ba_test',
  })
  const result = await resolveBachsNigerianBankAccount(resolution.client, {
    accountNumber: '0000000000',
    bankCode: '033',
  })
  assertEquals(result.resolved, true)
  assertEquals(resolution.calls[0].body, {
    account_number: '0000000000',
    bank_code: '033',
    country: 'NG',
  })
  const resolutionKey = resolution.calls[0].headers.get('Idempotency-Key') ?? ''
  assertEquals(resolutionKey.startsWith('bank-account-resolve:NG:'), true)
  assertEquals(resolutionKey.includes('0000000000'), false)
})

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
      paymentMethodTypes: ['NGN_CARD'],
      idempotencyKey: 'order:test:initial',
    })
    assertEquals(calls[0].body.pricing, { amount: '7000.01', currency: 'NGN' })
    assertEquals(calls[0].body.customer_bears_fee, false)
    assertEquals(calls[0].body.expires_in_minutes, 30)
    assertEquals(calls[0].body.payment_method_types, ['NGN_CARD'])
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
        paymentMethodTypes: ['NGN_CARD'],
        idempotencyKey: 'order:test:initial',
      })
    )
    await assertRejects(() => createBachsCheckout(client, {
      amountMinor: 700001,
      currency: 'NGN',
      customerEmail: 'qa@example.invalid',
      reference: 'order:test:bank-transfer',
      successUrl: 'https://drapeon.co/payments/return',
      cancelUrl: 'https://drapeon.co/orders/test',
      expiresInMinutes: 30,
      paymentMethodTypes: ['NGN_BANK_TRANSFER'],
      idempotencyKey: 'order:test:bank-transfer',
    }))
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
    metadata: { drapeon_claim_key: 'tranche:test' },
  })
  await createBachsTransfer(client, {
    destinationAccountId: 'acct_test',
    amountMinor: 560001,
    currency: 'NGN',
    transferGroup: 'order:test',
    description: 'Tailor earning',
    metadata: { drapeon_claim_key: 'tranche:test' },
    idempotencyKey: 'claim:test:op:1',
  })
  assertEquals(calls[0].body.amount, '5600.01')
  assertEquals(calls[0].body.transfer_group, 'order:test')
  assertEquals(calls[0].body.metadata, { drapeon_claim_key: 'tranche:test' })
  assertEquals(calls[0].headers.get('Idempotency-Key'), 'claim:test:op:1')
})

Deno.test('refund recovery transfers only from connected available balance back to platform', async () => {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
  const responses = [
    { account_id: 'acct_tailor', balances: [{ currency: 'NGN', available_balance: '100.00', pending_balance: '500.00' }] },
    {
      id: 'tr_recovery', source: 'acct_tailor', destination: 'self', amount: '75.00', currency: 'NGN',
      status: 'paid', transfer_group: 'refund-claim:claim-1',
      metadata: { refund_claim_id: 'claim-1', operation: 'refund_recovery' },
    },
  ]
  const client = createBachsClient({
    environment: 'SANDBOX', key: 'sk_sandbox_example',
    fetcher: ((url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : {} })
      return Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: calls.length === 1 ? 200 : 201 }))
    }) as typeof fetch,
  })
  const transfer = await createBachsRefundRecoveryTransfer(client, {
    sourceAccountId: 'acct_tailor', amountMinor: 7500, currency: 'NGN',
    transferGroup: 'refund-claim:claim-1', description: 'Reviewed refund recovery',
    metadata: { refund_claim_id: 'claim-1', operation: 'refund_recovery' },
    idempotencyKey: 'refund-recovery:claim-1:v1',
  })
  assertEquals(transfer.id, 'tr_recovery')
  assertEquals(new URL(calls[0].url).pathname, '/v1/balances')
  assertEquals(calls[0].headers.get('X-Account-Id'), 'acct_tailor')
  assertEquals(new URL(calls[1].url).pathname, '/v1/transfers')
  assertEquals(calls[1].headers.get('X-Account-Id'), 'acct_tailor')
  assertEquals(calls[1].headers.get('Idempotency-Key'), 'refund-recovery:claim-1:v1')
  assertEquals(calls[1].body, {
    destination: 'self', amount: '75.00', currency: 'NGN',
    transfer_group: 'refund-claim:claim-1', description: 'Reviewed refund recovery',
    metadata: { refund_claim_id: 'claim-1', operation: 'refund_recovery' },
  })
})

Deno.test('refund recovery refuses to transfer from pending or insufficient connected funds', async () => {
  let calls = 0
  const client = createBachsClient({
    environment: 'SANDBOX', key: 'sk_sandbox_example',
    fetcher: ((url: string) => {
      calls++
      return Promise.resolve(new Response(JSON.stringify({
        account_id: 'acct_tailor',
        balances: [{ currency: 'NGN', available_balance: '20.00', pending_balance: '500.00' }],
      }), { status: 200 }))
    }) as typeof fetch,
  })
  await assertRejects(() => createBachsRefundRecoveryTransfer(client, {
    sourceAccountId: 'acct_tailor', amountMinor: 7500, currency: 'NGN',
    transferGroup: 'refund-claim:claim-1', description: 'Reviewed refund recovery',
    metadata: { refund_claim_id: 'claim-1' }, idempotencyKey: 'refund-recovery:claim-1:v1',
  }), Error, 'available balance is insufficient')
  assertEquals(calls, 1)
})

Deno.test('transfer recovery lists only payout movements involving the pinned account', async () => {
  const { client, calls } = mockBachs({ items: [], total: 0, limit: 50, offset: 0 })
  const page = await listBachsTransfers(client, {
    limit: 50,
    offset: 0,
    connectedAccountId: 'acct_test',
  })
  assertEquals(page.total, 0)
  const url = new URL(calls[0].url)
  assertEquals(url.pathname, '/v1/transfers')
  assertEquals(url.searchParams.get('connected_account_id'), 'acct_test')
  assertEquals(url.searchParams.get('kind'), null)
  assertEquals(url.searchParams.get('limit'), '50')
  assertEquals(calls[0].headers.has('Idempotency-Key'), false)
})

Deno.test('refund recovery lookup matches exact claim metadata and never guesses on ambiguity', async () => {
  const matching: BachsTransfer = {
    id: 'tr_recovery', destination: 'self', amount: '30.00', currency: 'NGN', status: 'paid',
    transfer_group: 'refund-recovery:claim-1',
    metadata: { drapeon_refund_claim_id: 'claim-1', drapeon_money_desk_request_id: 'request-1' },
  }
  const found = mockBachs({ items: [matching], total: 1, limit: 100, offset: 0 })
  assertEquals(await findBachsRefundRecoveryTransfer(found.client, {
    connectedAccountId: 'acct_tailor', transferGroup: 'refund-recovery:claim-1',
    expectedAmountMinor: 3000, currency: 'NGN',
    metadata: { drapeon_refund_claim_id: 'claim-1', drapeon_money_desk_request_id: 'request-1' },
  }), { kind: 'FOUND', transfer: matching })
  assertEquals(found.calls[0].headers.has('Idempotency-Key'), false)
  assertEquals(new URL(found.calls[0].url).searchParams.get('connected_account_id'), 'acct_tailor')

  const ambiguous = mockBachs({
    items: [matching, { ...matching, id: 'tr_recovery_duplicate' }], total: 2, limit: 100, offset: 0,
  })
  assertEquals(await findBachsRefundRecoveryTransfer(ambiguous.client, {
    connectedAccountId: 'acct_tailor', transferGroup: 'refund-recovery:claim-1',
    expectedAmountMinor: 3000, currency: 'NGN',
    metadata: { drapeon_refund_claim_id: 'claim-1', drapeon_money_desk_request_id: 'request-1' },
  }), { kind: 'AMBIGUOUS' })

  const mismatch = mockBachs({
    items: [{ ...matching, amount: '31.00' }], total: 1, limit: 100, offset: 0,
  })
  assertEquals(await findBachsRefundRecoveryTransfer(mismatch.client, {
    connectedAccountId: 'acct_tailor', transferGroup: 'refund-recovery:claim-1',
    expectedAmountMinor: 3000, currency: 'NGN',
    metadata: { drapeon_refund_claim_id: 'claim-1', drapeon_money_desk_request_id: 'request-1' },
  }), { kind: 'AMBIGUOUS' })
})

Deno.test('connected-account payout and balance reads carry the account scope', async () => {
  // Bachs' published payout-list example omits limit/offset echoes.
  const payoutResponse = { items: [], total: 0 }
  const payout = mockBachs(payoutResponse)
  await listBachsPayouts(payout.client, {
    limit: 20,
    offset: 0,
    accountId: 'acct_test',
  })
  assertEquals(new URL(payout.calls[0].url).pathname, '/v1/payouts')
  assertEquals(new URL(payout.calls[0].url).searchParams.get('limit'), '20')
  assertEquals(payout.calls[0].headers.get('X-Account-Id'), 'acct_test')

  const balance = mockBachs({
    account_id: 'acct_test',
    balances: [{
      currency: 'NGN',
      available_balance: '12.00',
      pending_balance: '3.00',
    }],
  })
  await getBachsBalances(balance.client, 'acct_test')
  assertEquals(balance.calls[0].headers.get('X-Account-Id'), 'acct_test')
})

Deno.test('sandbox withdrawal destination creation is account scoped and idempotent', async () => {
  const { client, calls } = mockBachs({
    id: 'pd_test', type: 'bank_account', currency: 'NGN', status: 'approved', is_usable: true,
  })
  const destination = await createBachsPayoutDestination(client, {
    accountId: 'acct_test', currency: 'NGN', bankCode: '999', accountNumber: '0001112223',
    idempotencyKey: 'qa-withdrawal:destination:v1',
  })
  assertEquals(destination.is_usable, true)
  assertEquals(new URL(calls[0].url).pathname, '/v1/payouts/destinations')
  assertEquals(calls[0].headers.get('X-Account-Id'), 'acct_test')
  assertEquals(calls[0].headers.get('Idempotency-Key'), 'qa-withdrawal:destination:v1')
  assertEquals(calls[0].body, {
    type: 'bank_account', currency: 'NGN', bank_code: '999', account_number: '0001112223',
  })
})

Deno.test('withdrawal destinations list uses the provider destinations envelope', async () => {
  const { client, calls } = mockBachs({
    destinations: [{
      id: 'pd_test', type: 'bank_account', currency: 'NGN', status: 'approved', is_usable: true,
    }],
    total: 1,
    limit: 100,
    offset: 0,
  })
  const page = await listBachsPayoutDestinations(client, { accountId: 'acct_test' })
  assertEquals(page.destinations[0]?.id, 'pd_test')
  const url = new URL(calls[0].url)
  assertEquals(url.pathname, '/v1/payouts/destinations')
  assertEquals(url.searchParams.get('limit'), '100')
  assertEquals(url.searchParams.get('offset'), '0')
  assertEquals(calls[0].headers.get('X-Account-Id'), 'acct_test')
  assertEquals(calls[0].headers.has('Idempotency-Key'), false)
})

Deno.test('sandbox withdrawal checks destination, uses minor units and fixed idempotency', async () => {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
  const responses = [
    { id: 'pd_test', type: 'bank_account', currency: 'NGN', is_usable: true },
    {
      id: 'pay_test', status: 'processing', destination: 'pd_test', reference: 'qa-withdrawal-v1',
      amount: '1234.56', currency: 'NGN', source_currency: 'NGN', fee: '0.00', total_debited: '1234.56',
    },
  ]
  const client = createBachsClient({
    environment: 'SANDBOX', key: 'sk_sandbox_example',
    fetcher: ((url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : {} })
      return Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: calls.length === 1 ? 200 : 201 }))
    }) as typeof fetch,
  })
  const payout = await createBachsPayout(client, {
    accountId: 'acct_test', destinationId: 'pd_test', amountMinor: 123456, currency: 'NGN',
    reference: 'qa-withdrawal-v1', idempotencyKey: 'qa-withdrawal:payout:v1',
  })
  assertEquals(payout.id, 'pay_test')
  assertEquals(calls.length, 2)
  assertEquals(new URL(calls[0].url).pathname, '/v1/payouts/destinations/pd_test')
  assertEquals(calls[0].headers.get('X-Account-Id'), 'acct_test')
  assertEquals(new URL(calls[1].url).pathname, '/v1/payouts')
  assertEquals(calls[1].headers.get('X-Account-Id'), 'acct_test')
  assertEquals(calls[1].headers.get('Idempotency-Key'), 'qa-withdrawal:payout:v1')
  assertEquals(calls[1].body.amount, '1234.56')
  assertEquals(calls[1].body.reference, 'qa-withdrawal-v1')
})

Deno.test('unusable or wrong-currency withdrawal destination prevents payout creation', async () => {
  for (const destination of [
    { id: 'pd_test', type: 'bank_account', currency: 'NGN', is_usable: false },
    { id: 'pd_test', type: 'bank_account', currency: 'USD', is_usable: true },
  ]) {
    let calls = 0
    const client = createBachsClient({
      environment: 'SANDBOX', key: 'sk_sandbox_example',
      fetcher: (() => {
        calls++
        return Promise.resolve(new Response(JSON.stringify(destination), { status: 200 }))
      }) as typeof fetch,
    })
    await assertRejects(() => createBachsPayout(client, {
      accountId: 'acct_test', destinationId: 'pd_test', amountMinor: 100, currency: 'NGN',
      reference: 'qa-withdrawal-v1', idempotencyKey: 'qa-withdrawal:payout:v1',
    }), Error, 'not usable')
    assertEquals(calls, 1)
  }
})

Deno.test('payout fee must equal the reviewed platform top-up and reconcile to total debit', () => {
  const payout = {
    id: 'pay_test', status: 'pending' as const, amount: '7000.00', currency: 'NGN',
    source_currency: 'NGN', fee: '50.00', total_debited: '7050.00',
  }
  assertBachsPayoutFeeMatchesTopUp(payout, { platformTopUpMinor: 5000, currency: 'NGN' })
  assertThrows(() => assertBachsPayoutFeeMatchesTopUp(payout, {
    platformTopUpMinor: 10000, currency: 'NGN',
  }), BachsPayoutFeeTopUpMismatchError)
  assertThrows(() => assertBachsPayoutFeeMatchesTopUp({ ...payout, total_debited: '7100.00' }, {
    platformTopUpMinor: 5000, currency: 'NGN',
  }), BachsPayoutFeeTopUpMismatchError)
  assertThrows(() => assertBachsPayoutFeeMatchesTopUp({ ...payout, fee: null }, {
    platformTopUpMinor: 5000, currency: 'NGN',
  }), BachsPayoutFeeTopUpMismatchError)
})

Deno.test('withdrawal retrieval is account scoped and never submits a new payout', async () => {
  const { client, calls } = mockBachs({
    id: 'pay_test', status: 'completed', destination: 'pd_test', reference: 'qa-withdrawal-v1',
    amount: '1234.56', currency: 'NGN', source_currency: 'NGN', fee: '0.00', total_debited: '1234.56',
  })
  const payout = await getBachsPayout(client, { accountId: 'acct_test', payoutId: 'pay_test' })
  assertEquals(payout.status, 'completed')
  assertEquals(new URL(calls[0].url).pathname, '/v1/payouts/pay_test')
  assertEquals(calls[0].headers.get('X-Account-Id'), 'acct_test')
  assertEquals(calls[0].headers.has('Idempotency-Key'), false)
})

Deno.test('transfer creation rejects a response without the immutable claim metadata', async () => {
  const { client } = mockBachs({
    id: 'tr_test',
    destination: 'acct_test',
    amount: '5600.01',
    currency: 'NGN',
    status: 'pending',
    transfer_group: 'order:test',
    metadata: {},
  })
  await assertRejects(() => createBachsTransfer(client, {
    destinationAccountId: 'acct_test',
    amountMinor: 560001,
    currency: 'NGN',
    transferGroup: 'order:test',
    description: 'Tailor earning',
    metadata: { drapeon_claim_key: 'tranche:test' },
    idempotencyKey: 'claim:test:op:1',
  }), Error, 'does not match')
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
  const { client } = mockBachs({
    account_id: 'org_test',
    balances: [
      { currency: 'NGN', available_balance: '7000.00', pending_balance: '0.00' },
      { currency: 'USD', available_balance: '-1.00', pending_balance: '0.00' },
    ],
  })
  const balances = await getBachsBalances(client)
  await assertRejects(
    async () => assertBachsTransferBalance(balances, { amountMinor: 100, currency: 'NGN' }),
    Error,
    'negative balance',
  )
})

Deno.test('Bachs refund uses a fixed claim key and org-funded fee', async () => {
  const response = {
    refund_id: 'rfnd_test',
    charge_id: 'ch_test',
    reference: 'refund:payment:test:0:700000',
    status: 'processing',
    requested_amount: '7000.00',
    refunded_amount: null,
    fee_bearer: 'org',
  }
  const { client, calls } = mockBachs(response)
  await createBachsRefund(client, {
    chargeId: 'ch_test',
    amountMinor: 700000,
    currency: 'NGN',
    reference: response.reference,
    idempotencyKey: 'refund-claim:test',
    reason: 'Approved cancellation',
  })
  assertEquals(calls[0].url.endsWith('/v1/refunds'), true)
  assertEquals(calls[0].headers.get('Idempotency-Key'), 'refund-claim:test')
  assertEquals(calls[0].body.charge_id, 'ch_test')
  assertEquals(calls[0].body.amount, '7000.00')
  assertEquals(calls[0].body.fee_bearer, 'org')
  assertEquals(calls[0].body.idempotency_key, 'refund-claim:test')
  assertEquals('currency' in calls[0].body, false)
  const mismatched = mockBachs({ ...response, requested_amount: '7000.01' })
  await assertRejects(() => createBachsRefund(mismatched.client, {
    chargeId: 'ch_test', amountMinor: 700000, currency: 'NGN',
    reference: response.reference, idempotencyKey: 'refund-claim:test',
  }))
})

Deno.test('Bachs refund recovery is an exact by-charge read', async () => {
  const { client, calls } = mockBachs({
    refund_id: 'some-bachs-refund-id',
    charge_id: 'ch_test',
    reference: 'refund:payment:test',
    status: 'success',
    requested_amount: '7000.00',
    refunded_amount: '7000.00',
    fee_bearer: 'org',
  })
  const refund = await getBachsRefundByCharge(client, 'ch_test')
  assertEquals(refund.status, 'success')
  assertEquals(calls[0].url.endsWith('/v1/refunds/by-charge/ch_test'), true)
})
