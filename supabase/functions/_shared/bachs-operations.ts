import { bachsAmount, bachsAmountMinor, type createBachsClient } from './bachs.ts'

type BachsClient = ReturnType<typeof createBachsClient>
type BachsFeesCollector = 'PLATFORM' | 'CONNECTED_ACCOUNT'

export type BachsAccount = {
  id: string
  country: string
  capabilities?: { transfers?: { status?: string }; payouts?: { status?: string } }
  responsibilities?: { fees?: { collector?: 'platform' | 'bachs' } }
  requirements?: { currently_due?: string[]; past_due?: string[]; pending_verification?: string[] }
}

export type BachsCheckout = {
  checkout_id: string
  status: string
  amount: string
  currency: string
  checkout_url: string
  payment_status?: string | null
  charge_id?: string | null
}

export type BachsTransfer = {
  id: string
  destination: string
  amount: string
  currency: string
  status: string
  transfer_group?: string | null
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
export async function createBachsRecipientAccount(client: BachsClient, input: {
  email: string
  displayName: string
  country: string
  feesCollector: BachsFeesCollector
  idempotencyKey: string
}): Promise<BachsAccount> {
  const account = await client.request<BachsAccount>({
    method: 'POST', path: '/v1/accounts', idempotencyKey: input.idempotencyKey,
    body: {
      contact_email: input.email,
      display_name: input.displayName,
      country: input.country,
      configuration: { recipient: { capabilities: { transfers: { requested: true }, payouts: { requested: true } } } },
      responsibilities: { fees: { collector: input.feesCollector === 'PLATFORM' ? 'platform' : 'bachs' } },
    },
  })
  requireProviderId(account.id, 'acct_')
  if (account.country !== input.country || account.responsibilities?.fees?.collector !== (input.feesCollector === 'PLATFORM' ? 'platform' : 'bachs')) {
    throw new Error('Bachs account does not match the route snapshot.')
  }
  return account
}

export async function getBachsAccount(client: BachsClient, accountId: string): Promise<BachsAccount> {
  requireProviderId(accountId, 'acct_')
  const account = await client.request<BachsAccount>({ method: 'GET', path: `/v1/accounts/${encodeURIComponent(accountId)}` })
  if (account.id !== accountId) throw new Error('Bachs returned a different account.')
  return account
}

export async function createBachsOnboardingLink(client: BachsClient, input: {
  accountId: string
  refreshUrl: string
  returnUrl: string
  idempotencyKey: string
}): Promise<{ id: string; account: string; url: string; expires_at: string }> {
  requireProviderId(input.accountId, 'acct_')
  const link = await client.request<{ id: string; account: string; url: string; expires_at: string }>({
    method: 'POST', path: `/v1/accounts/${encodeURIComponent(input.accountId)}/account-links`,
    idempotencyKey: input.idempotencyKey,
    body: { type: 'onboarding', refresh_url: input.refreshUrl, return_url: input.returnUrl },
  })
  requireProviderId(link.id, 'alnk_')
  if (link.account !== input.accountId) throw new Error('Bachs onboarding link returned for another account.')
  return link
}

/** A redirect never confirms payment; only signed provider evidence does. */
export async function createBachsCheckout(client: BachsClient, input: {
  amountMinor: number
  currency: string
  customerEmail: string
  reference: string
  successUrl: string
  cancelUrl: string
  expiresInMinutes: number
  idempotencyKey: string
  metadata?: Record<string, string>
}): Promise<BachsCheckout> {
  if (!Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 1 || input.expiresInMinutes > 1440) {
    throw new Error('Bachs checkout expiry must be between 1 and 1440 minutes.')
  }
  const amount = bachsAmount(input.amountMinor, input.currency)
  if (input.amountMinor <= 0) throw new Error('Bachs checkout amount must be positive.')
  const checkout = await client.request<BachsCheckout>({
    method: 'POST', path: '/v1/checkout-sessions', idempotencyKey: input.idempotencyKey,
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
  requireBachsCheckoutUrl(checkout.checkout_url)
  if (checkout.currency !== input.currency || bachsAmountMinor(checkout.amount, checkout.currency) !== input.amountMinor) {
    throw new Error('Bachs checkout amount or currency differs from the accepted total.')
  }
  return checkout
}

export async function getBachsCheckout(client: BachsClient, checkoutId: string): Promise<BachsCheckout> {
  requireProviderId(checkoutId, 'chk_')
  const checkout = await client.request<BachsCheckout>({ method: 'GET', path: `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}` })
  if (checkout.checkout_id !== checkoutId) throw new Error('Bachs returned a different checkout.')
  return checkout
}

export async function createBachsTransfer(client: BachsClient, input: {
  destinationAccountId: string
  amountMinor: number
  currency: string
  transferGroup: string
  description: string
  idempotencyKey: string
}): Promise<BachsTransfer> {
  requireProviderId(input.destinationAccountId, 'acct_')
  if (input.amountMinor <= 0) throw new Error('Bachs transfer amount must be positive.')
  const transfer = await client.request<BachsTransfer>({
    method: 'POST', path: '/v1/transfers', idempotencyKey: input.idempotencyKey,
    body: {
      destination: input.destinationAccountId,
      amount: bachsAmount(input.amountMinor, input.currency),
      currency: input.currency,
      transfer_group: input.transferGroup,
      description: input.description,
    },
  })
  requireProviderId(transfer.id, 'tr_')
  if (transfer.destination !== input.destinationAccountId || transfer.currency !== input.currency ||
    bachsAmountMinor(transfer.amount, transfer.currency) !== input.amountMinor || transfer.transfer_group !== input.transferGroup) {
    throw new Error('Bachs transfer does not match the payout claim.')
  }
  return transfer
}

export async function getBachsTransfer(client: BachsClient, transferId: string): Promise<BachsTransfer> {
  requireProviderId(transferId, 'tr_')
  const transfer = await client.request<BachsTransfer>({ method: 'GET', path: `/v1/transfers/${encodeURIComponent(transferId)}` })
  if (transfer.id !== transferId) throw new Error('Bachs returned a different transfer.')
  return transfer
}
