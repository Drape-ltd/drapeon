async function safeQuery<T>(
  label: string,
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
) {
  const result = await query
  if (result.error) {
    return { label, data: null, error: result.error.message }
  }
  return { label, data: result.data ?? null, error: null }
}

async function collectRows<T>(label: string, page: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  const pageSize = 500
  for (let offset = 0; offset < 20 * pageSize; offset += pageSize) {
    const result = await page(offset, offset + pageSize - 1)
    if (result.error) return { label, data: null, error: result.error.message }
    rows.push(...(result.data ?? []))
    if ((result.data ?? []).length < pageSize) return { label, data: rows, error: null }
  }
  return { label, data: null, error: 'Export exceeds the safe page limit and needs manual privacy review.' }
}

export async function buildTailorExportPackage(
  supabase: any,
  tailorUserId: string,
  tailorProfileId: string,
) {
  const generatedAt = new Date().toISOString()

  const [
    account,
    profile,
    portfolio,
    shopItems,
    orders,
    reviews,
    payouts,
  ] = await Promise.all([
    safeQuery('account', supabase.from('users')
      .select('id,email,display_name,role,created_at,updated_at')
      .eq('id', tailorUserId).maybeSingle()),
    safeQuery(
      'profile',
      supabase
        .from('tailor_profiles')
        .select('id, user_id, display_name, bio, location, languages, specialty_tags, price_range_min, price_range_max, currency, availability, is_verified, is_live, avg_rating, total_reviews, total_orders, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, created_at, updated_at')
        .eq('id', tailorProfileId)
        .maybeSingle(),
    ),
    collectRows(
      'portfolio',
      (start, end) => supabase
        .from('portfolio_photos')
        .select('id, public_url, caption, display_order, created_at')
        .eq('tailor_profile_id', tailorProfileId)
        .order('display_order', { ascending: true }).range(start, end),
    ),
    collectRows(
      'shop_items',
      (start, end) => supabase
        .from('seller_items')
        .select('id, title, description, category, sizes, price_amount, currency, photo_urls, is_live, stock_status, inventory_quantity, size_inventory, pickup_available, delivery_available, shipping_available, created_at, updated_at')
        .eq('tailor_profile_id', tailorProfileId)
        .order('updated_at', { ascending: false }).range(start, end),
    ),
    collectRows(
      'orders',
      (start, end) => supabase
        .from('orders')
        .select('id, reference, order_kind, garment_type, item_title, item_size, item_quantity, stage, quoted_amount, currency, quoted_currency, delivery_method, fulfillment_option, tailor_payout_currency_locked, tailor_payout_provider_locked, created_at, updated_at, stage_updated_at')
        .eq('tailor_id', tailorUserId)
        .order('created_at', { ascending: false })
        .range(start, end),
    ),
    collectRows(
      'reviews',
      (start, end) => supabase
        .from('reviews')
        .select('id, order_id, rating, body, tags, reviewer_name, tailor_response, published_at, created_at')
        .eq('tailor_profile_id', tailorProfileId)
        .order('created_at', { ascending: false })
        .range(start, end),
    ),
    collectRows(
      'payouts',
      (start, end) => supabase
        .from('payouts')
        .select('id, order_id, amount, currency, provider, status, blocked_reason, provider_payout_id, initiated_at, completed_at, failed_at, processed_at')
        .eq('tailor_profile_id', tailorProfileId)
        .order('processed_at', { ascending: false })
        .range(start, end),
    ),
  ])

  const queryResults = [account, profile, portfolio, shopItems, orders, reviews, payouts]
  const errors = queryResults
    .filter((result) => result.error)
    .map((result) => ({ section: result.label, error: result.error }))

  return {
    version: 'tailor-portability-v1',
    generatedAt,
    expiresAt: new Date(Date.now() + REQUEST_WINDOW_MS).toISOString(),
    scope: 'TAILOR_PORTABILITY',
    privacyNotes: [
      'Customer contact details and measurements are not exported unless a customer has an explicit sharing path.',
      'Payment provider secrets, raw identity documents, and internal risk signals are excluded.',
      'Internal audit logs are excluded from this self-service package and remain available only to ops for compliance review.',
      'Order records are included as platform history so the tailor can understand their own business activity.',
    ],
    sections: {
      account: account.data,
      profile: profile.data,
      portfolio: portfolio.data ?? [],
      shopItems: shopItems.data ?? [],
      orderHistory: orders.data ?? [],
      reviews: reviews.data ?? [],
      payouts: payouts.data ?? [],
    },
    generationWarnings: errors,
  }
}

export async function buildCustomerExportPackage(supabase: any, customerUserId: string) {
  const generatedAt = new Date().toISOString()
  const [account, profile, orders] = await Promise.all([
    safeQuery('account', supabase.from('users')
      .select('id,email,display_name,role,created_at,updated_at')
      .eq('id', customerUserId).maybeSingle()),
    safeQuery('profile', supabase.from('customer_profiles')
      .select('id,user_id,display_name,created_at,updated_at')
      .eq('user_id', customerUserId).maybeSingle()),
    collectRows('orders', (start, end) => supabase.from('orders')
      .select('id,reference,order_kind,stage,quoted_amount,currency,delivery_method,created_at,updated_at')
      .eq('customer_id', customerUserId).order('created_at', { ascending: false }).range(start, end)),
  ])
  return {
    version: 'customer-access-v1',
    generatedAt,
    expiresAt: new Date(Date.now() + REQUEST_WINDOW_MS).toISOString(),
    scope: 'ACCOUNT_ACCESS',
    privacyNotes: ['Other people’s contact details, payment credentials, and internal safety records are excluded.'],
    sections: { account: account.data, profile: profile.data, orderHistory: orders.data ?? [] },
    generationWarnings: [account, profile, orders].filter((result) => result.error)
      .map((result) => ({ section: result.label, error: result.error })),
  }
}

const REQUEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

