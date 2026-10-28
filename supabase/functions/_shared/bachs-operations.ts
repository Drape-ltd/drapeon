import { bachsAmount, bachsAmountMinor, type createBachsClient } from './bachs.ts'

type BachsClient = ReturnType<typeof createBachsClient>
type BachsFeesCollector = 'PLATFORM' | 'CONNECTED_ACCOUNT'

export type BachsAccount = {
  id: string
  country: string
  capabilities?: {
    transfers?: { status?: string }
    payouts?: { status?: string }
  }
  responsibilities?: { fees?: { collector?: 'platform' | 'bachs' } }
  requirements?: {
    currently_due?: string[]
    past_due?: string[]
    pending_verification?: string[]
  }
}

export function bachsOnboardingProgress(account: BachsAccount) {
  if (!account.requirements) return null
  const due = new Set([
    ...(account.requirements.currently_due ?? []),
    ...(account.requirements.past_due ?? []),
  ].filter((field): field is string => typeof field === 'string' && field.length > 0))
  const pending = new Set(
    (account.requirements.pending_verification ?? []).filter(
      (field): field is string => typeof field === 'string' && field.length > 0,
    ),
  )
  return { dueCount: due.size, pendingCount: pending.size }
}

export type BachsCheckout = {
  checkout_id: string
  status: string
  amount?: string
  currency?: string
  reference?: string | null
  checkout_url?: string
  payment_status?: string | null
  charge_id?: string | null
}

export type BachsTransfer = {
  id: string
  destination: string
  amount: string
  currency: string
  status: 'pending' | 'paid'
  transfer_group?: string | null
}

export type BachsBalance = {
  currency: string
  available_balance: string
  pending_balance: string
}

export type BachsBalances = {
  account_id: string
  balances: BachsBalance[]
}

export type BachsPayment = {
  payment_id: string
  checkout_id: string | null
  reference: string | null
  status: string
  amount: string
  currency: string
  fees?: { amount: string; currency: string } | null
  fee_paid_by?: string | null
}

function requireProviderId(value: string, prefix: string): string {
  if (!value.startsWith(prefix) || value.length <= prefix.length) {
    throw new Error(`Bachs returned an invalid ${prefix.slice(0, -1)} identifier.`)
  }
  return value
}

function requireBachsCheckoutUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.bachs.io')) {
    throw new Error('Bachs returned an unexpected checkout URL.')
  }
  return value
}

/** The route's immutable collector value is set at account creation. */
export async function createBachsRecipientAccount(
  client: BachsClient,
  input: {
    email: string
    displayName: string
    country: string
    feesCollector: BachsFeesCollector
    idempotencyKey: string
  }
): Promise<BachsAccount> {
  const account = await client.request<BachsAccount>({
    method: 'POST',
    path: '/v1/accounts',
    idempotencyKey: input.idempotencyKey,
    body: {
      contact_email: input.email,
      display_name: input.displayName,
      country: input.country,
      configuration: {
        recipient: {
          capabilities: {
            transfers: { requested: true },
            payouts: { requested: true },
          },
        },
      },
      responsibilities: {
        fees: {
          collector: input.feesCollector === 'PLATFORM' ? 'platform' : 'bachs',
        },
      },
    },
  })
  requireProviderId(account.id, 'acct_')
  if (
    account.country !== input.country ||
    account.responsibilities?.fees?.collector !==
      (input.feesCollector === 'PLATFORM' ? 'platform' : 'bachs')
  ) {
    throw new Error('Bachs account does not match the route snapshot.')
  }
  return account
}

export async function getBachsAccount(
  client: BachsClient,
  accountId: string
): Promise<BachsAccount> {
  requireProviderId(accountId, 'acct_')
  const account = await client.request<BachsAccount>({
    method: 'GET',
    path: `/v1/accounts/${encodeURIComponent(accountId)}`,
  })
  if (account.id !== accountId) {
    throw new Error('Bachs returned a different account.')
  }
  return account
}

export async function createBachsOnboardingLink(
  client: BachsClient,
  input: {
    accountId: string
    refreshUrl: string
    returnUrl: string
    idempotencyKey: string
  }
): Promise<{ id: string; account: string; url: string; expires_at: string }> {
  requireProviderId(input.accountId, 'acct_')
  const link = await client.request<{
    id: string
    account: string
    url: string
    expires_at: string
  }>({
    method: 'POST',
    path: `/v1/accounts/${encodeURIComponent(input.accountId)}/account-links`,
    idempotencyKey: input.idempotencyKey,
    body: {
      type: 'onboarding',
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
    },
  })
  requireProviderId(link.id, 'alnk_')
  if (link.account !== input.accountId) {
    throw new Error('Bachs onboarding link returned for another account.')
  }
  const url = new URL(link.url)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.bachs.io')) {
    throw new Error('Bachs returned an unexpected onboarding URL.')
  }
  return link
}

/** A redirect never confirms payment; only signed provider evidence does. */
export async function createBachsCheckout(
  client: BachsClient,
  input: {
    amountMinor: number
    currency: string
    customerEmail: string
    reference: string
    successUrl: string
    cancelUrl: string
    expiresInMinutes: number
    idempotencyKey: string
    metadata?: Record<string, string>
  }
): Promise<BachsCheckout> {
  if (
    !Number.isInteger(input.expiresInMinutes) ||
    input.expiresInMinutes < 1 ||
    input.expiresInMinutes > 1440
  ) {
    throw new Error('Bachs checkout expiry must be between 1 and 1440 minutes.')
  }
  const amount = bachsAmount(input.amountMinor, input.currency)
  if (input.amountMinor <= 0) {
    throw new Error('Bachs checkout amount must be positive.')
  }
  const checkout = await client.request<BachsCheckout>({
    method: 'POST',
    path: '/v1/checkout-sessions',
    idempotencyKey: input.idempotencyKey,
    body: {
      pricing: { amount, currency: input.currency },
      billing_currency: input.currency,
      customer: { email: input.customerEmail },
      customer_bears_fee: false,
      reference: input.reference,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_in_minutes: input.expiresInMinutes,
      metadata: input.metadata ?? {},
    },
  })
  requireProviderId(checkout.checkout_id, 'chk_')
  if (!checkout.checkout_url) {
    throw new Error('Bachs did not return a checkout URL.')
  }
  requireBachsCheckoutUrl(checkout.checkout_url)
  if (checkout.reference != null && checkout.reference !== input.reference) {
    throw new Error('Bachs checkout reference differs from the reserved attempt.')
  }
  if (
    checkout.currency != null &&
    checkout.amount != null &&
    (checkout.currency !== input.currency ||
      bachsAmountMinor(checkout.amount, checkout.currency) !== input.amountMinor)
  ) {
    throw new Error('Bachs checkout amount or currency differs from the accepted total.')
  }
  return checkout
}

export async function getBachsCheckout(
  client: BachsClient,
  checkoutId: string
): Promise<BachsCheckout> {
  requireProviderId(checkoutId, 'chk_')
  const checkout = await client.request<BachsCheckout>({
    method: 'GET',
    path: `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`,
  })
  if (checkout.checkout_id !== checkoutId) {
    throw new Error('Bachs returned a different checkout.')
  }
  return checkout
}

export async function getBachsPayment(
  client: BachsClient,
  chargeId: string
): Promise<BachsPayment> {
  requireProviderId(chargeId, 'ch_')
  const payment = await client.request<BachsPayment>({
    method: 'GET',
    path: `/v1/payments/${encodeURIComponent(chargeId)}`,
  })
  if (payment.payment_id !== chargeId) {
    throw new Error('Bachs returned a different charge.')
  }
  return payment
}

export async function getBachsWebhookEvent(
  client: BachsClient,
  eventId: string
): Promise<{
  event_id: string
  event_type: string
  payload: Record<string, unknown>
}> {
  requireProviderId(eventId, 'evt_')
  const event = await client.request<{
    event_id: string
    event_type: string
    payload: Record<string, unknown>
  }>({
    method: 'GET',
    path: `/v1/webhooks/events/${encodeURIComponent(eventId)}`,
  })
  if (
    event.event_id !== eventId ||
    !event.payload ||
    typeof event.payload !== 'object' ||
    event.payload.id !== eventId ||
    event.payload.type !== event.event_type
  ) {
    throw new Error('Bachs returned a mismatched webhook event.')
  }
  return event
}

export async function createBachsTransfer(
  client: BachsClient,
  input: {
    destinationAccountId: string
    amountMinor: number
    currency: string
    transferGroup: string
    description: string
    idempotencyKey: string
  }
): Promise<BachsTransfer> {
  requireProviderId(input.destinationAccountId, 'acct_')
  if (input.amountMinor <= 0) {
    throw new Error('Bachs transfer amount must be positive.')
  }
  const transfer = await client.request<BachsTransfer>({
    method: 'POST',
    path: '/v1/transfers',
    idempotencyKey: input.idempotencyKey,
    body: {
      destination: input.destinationAccountId,
      amount: bachsAmount(input.amountMinor, input.currency),
      currency: input.currency,
      transfer_group: input.transferGroup,
      description: input.description,
    },
  })
  requireProviderId(transfer.id, 'tr_')
  if (
    transfer.destination !== input.destinationAccountId ||
    transfer.currency !== input.currency ||
    bachsAmountMinor(transfer.amount, transfer.currency) !== input.amountMinor ||
    transfer.transfer_group !== input.transferGroup
  ) {
    throw new Error('Bachs transfer does not match the payout claim.')
  }
  if (transfer.status !== 'pending' && transfer.status !== 'paid') {
    throw new Error('Bachs transfer returned an unknown status.')
  }
  return transfer
}

export async function getBachsTransfer(
  client: BachsClient,
  transferId: string
): Promise<BachsTransfer> {
  requireProviderId(transferId, 'tr_')
  const transfer = await client.request<BachsTransfer>({
    method: 'GET',
    path: `/v1/transfers/${encodeURIComponent(transferId)}`,
  })
  if (transfer.id !== transferId) {
    throw new Error('Bachs returned a different transfer.')
  }
  if (transfer.status !== 'pending' && transfer.status !== 'paid') {
    throw new Error('Bachs transfer returned an unknown status.')
  }
  return transfer
}

/** Read platform balances before creating a transfer; pending funds are not movable. */
export async function getBachsBalances(client: BachsClient): Promise<BachsBalances> {
  const result = await client.request<BachsBalances>({
    method: 'GET',
    path: '/v1/balances',
  })
  if (!result.account_id || !Array.isArray(result.balances)) {
    throw new Error('Bachs returned invalid platform balance data.')
  }
  for (const balance of result.balances) {
    if (
      typeof balance.currency !== 'string' ||
      typeof balance.available_balance !== 'string' ||
      typeof balance.pending_balance !== 'string'
    ) {
      throw new Error('Bachs returned an invalid currency balance.')
    }
    // Parse both values through the shared currency-aware money-unit conversion.
    bachsAmountMinor(balance.available_balance, balance.currency)
    bachsAmountMinor(balance.pending_balance, balance.currency)
  }
  return result
}

/**
 * Fail closed on a negative balance in any currency: Bachs blocks all outbound
 * transfers while the platform is in debt, even when this transfer's currency
 * itself has funds. Pending settlement is never eligible for transfer.
 */
export function assertBachsTransferBalance(
  balances: BachsBalances,
  input: { amountMinor: number; currency: string },
): void {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Bachs transfer amount must be positive minor units.')
  }
  const parsed = balances.balances.map((balance) => ({
    currency: balance.currency,
    available: bachsAmountMinor(balance.available_balance, balance.currency),
  }))
  if (parsed.some((balance) => balance.available < 0)) {
    throw new Error('Bachs platform has a negative balance; transfers are blocked.')
  }
  const currencyBalance = parsed.find((balance) => balance.currency === input.currency)
  if (!currencyBalance || currencyBalance.available < input.amountMinor) {
    throw new Error('Bachs available balance is insufficient for this transfer.')
  }
}
