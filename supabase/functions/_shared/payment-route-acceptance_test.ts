import { acceptQuoteWithPaymentRouteSnapshot } from './payment-route-acceptance.ts'

class FakeQuery {
  constructor(private readonly data: unknown) {}

  select() { return this }
  eq() { return this }

  maybeSingle() {
    return Promise.resolve({ data: this.data, error: null })
  }

  then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
    return Promise.resolve({ data: this.data, error: null }).then(resolve, reject)
  }
}

Deno.test('custom acceptance trusts the configured route over a stale provider lock', async () => {
  const order = {
    id: 'order-1',
    stage: 'QUOTE_SENT',
    order_kind: 'CUSTOM',
    customer_id: 'customer-1',
    tailor_profile_id: 'tailor-1',
    delivery_method: 'LOCAL_COLLECTION',
    delivery_country_code: null,
    currency: 'USD',
    tailor_payout_currency_locked: 'USD',
    // A legacy profile-derived lock may be stale; acceptance must use the
    // configured route and atomically replace the provisional value.
    tailor_payout_provider_locked: 'PAYSTACK',
  }
  const quote = { id: 'quote-1', version: 2, status: 'ACTIVE', currency: 'USD' }
  const profile = { id: 'tailor-1', payout_country_code: 'US', payout_currency: 'USD' }
  const route = {
    id: 'route-1', version: 1, status: 'SANDBOX_ONLY', provider: 'STRIPE',
    tailor_country_code: 'US', charge_currency: 'USD', payout_currency: 'USD',
    legal_entity: 'O4_GROUP_LLC', fees_collector: 'PLATFORM',
    fee_schedule_version: 'no-commission-v1', confirmed_card_issuer_countries: ['US'],
  }
  const deliveryRule = {
    id: 'delivery-us-1', country_code: 'US', version: 1, status: 'READY',
    domestic_only: false, vat_registration_ready: false, collect_vat_under_gbp_135: false,
    duties_customer_pays: true, ioss_reviewed: false,
  }
  const destination = {
    id: 'destination-1', provider: 'STRIPE', legal_entity: 'O4_GROUP_LLC',
    country_code: 'US', currency: 'USD', transfers_enabled: true, payouts_enabled: true,
    fees_collector: 'PLATFORM', first_withdrawal_review_status: 'CLEARED', active: true,
  }
  const tables: Record<string, unknown> = {
    orders: order,
    order_quotes: quote,
    tailor_profiles: profile,
    payment_routes: [route],
    delivery_country_rules: [deliveryRule],
    payout_destinations: [destination],
  }
  const calls: Record<string, unknown>[] = []
  const supabase = {
    from(table: string) { return new FakeQuery(tables[table] ?? null) },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== 'accept_active_order_quote_with_route_snapshot') {
        throw new Error(`Unexpected RPC: ${name}`)
      }
      calls.push(args)
      return { data: { ok: true }, error: null }
    },
  }

  const result = await acceptQuoteWithPaymentRouteSnapshot({
    supabase,
    supabaseUrl: 'https://pqptfuqogvrajozfsqzi.supabase.co',
    orderId: order.id,
    customerId: order.customer_id,
    quoteId: quote.id,
    expectedQuoteVersion: quote.version,
  })

  if (result.error) throw new Error(`Acceptance failed: ${result.error.message}`)
  if (calls.length !== 1) throw new Error('The configured route was not sent for atomic snapshotting.')
  if (calls[0].p_payment_route_id !== route.id) {
    throw new Error('Acceptance did not send the configured route ID.')
  }
})
