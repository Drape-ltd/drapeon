import { friendlyActionError, isDisplayableActionError } from '@drape/shared/action-errors'
import type { MarketplaceMedia } from '@drape/shared'
import { createClient } from '../../../lib/supabase'
import { QUOTE_NEGOTIATION_UI_ENABLED } from './account-realtime-config'
import {
  emptyEarningsSurfaceData,
  emptyItemDetailSurfaceData,
  emptyOrderDetailSurfaceData,
  emptyProfileSurfaceData,
  emptyWorkSurfaceData,
} from './account-empty-data'
import type {
  AccountBenefitReservation,
  AccountCommercialAdjustment,
  AccountCommercialReceipt,
  AccountMessage,
  AccountMessageReaction,
  AccountOrder,
  AccountOrderEvent,
  AccountOrderQuote,
  AccountOrderTip,
  AccountPayment,
  AccountPayout,
  AccountProviderDispute,
  AccountProviderPayoutEvent,
  AccountQuoteRevision,
  AccountResolutionProposal,
  AccountReturnRequest,
  AccountReview,
  AccountSettlementPlan,
  AccountSettlementTranche,
  AccountShellData,
  CheckoutSurfaceData,
  ConsultationBookingSnapshot,
  CustomOrderDetail,
  CustomerProfile,
  EarningsSurfaceData,
  ExploreSurfaceData,
  ItemDetailSurfaceData,
  JoinedProfile,
  MaterialAdvance,
  MessagesSurfaceData,
  OrderDetailSurfaceData,
  OrdersSurfaceData,
  PortfolioItem,
  ProductionEvidence,
  ProfileSurfaceData,
  SavedSurfaceData,
  SellerItem,
  SettingsSurfaceData,
  ShopSurfaceData,
  StageUpdate,
  SupportSurfaceData,
  TailorPickupDetails,
  TailorProfile,
  WishlistCollection,
  WishlistItem,
  WorkSurfaceData,
} from './account-data-contracts'

export function stringList(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

export function isTerminalOrder(order: AccountOrder) {
  return [
    'COMPLETE',
    'COMPLETED',
    'PARTIALLY_REFUNDED',
    'DECLINED',
    'EXPIRED',
    'CANCELLED',
    'REFUNDED',
  ].includes(order.stage ?? '')
}

export function isReadyMadeInquiryOrder(
  order: Pick<AccountOrder, 'order_kind' | 'stage' | 'seller_item_id'>
) {
  return (
    order.stage === 'PENDING_QUOTE' &&
    (order.order_kind === 'READY_MADE' ||
      (typeof order.seller_item_id === 'string' && order.seller_item_id.trim().length > 0))
  )
}

const publicTailorProfileSelect =
  'id, user_id, display_name, business_name, bio, location, languages, specialty_tags, price_range_min, price_range_max, currency, tier, availability, accepts_custom_orders_now, shop_paused, seller_type, is_live, is_verified, avg_rating, total_reviews, total_orders, supports_custom_orders, supports_ready_made, pickup_available, delivery_available, shipping_available, consultation_mode, consultation_requirement, consultation_fee_amount, consultation_currency, consultation_duration_minutes, consultation_call_type, consultation_fee_creditable, portfolio_photo_urls, portfolio_video_urls, avatar_url'

const ownTailorProfileSelect = `${publicTailorProfileSelect}, profile_completed, id_verification_status, id_verification_submitted_at, id_verification_rejection_reason, id_verification_rejected_at, id_verification_metadata, payout_currency, payout_provider, payout_reverification_required, payout_account_type, payout_account_verified, payout_account_verified_at, payout_account_change_count, payout_account_last_changed_at, payout_account_change_locked_until, payout_destination_hold_until`

const sellerItemSelect =
  'id, tailor_profile_id, title, description, category, sizes, size_inventory, price_amount, currency, photo_urls, stock_status, inventory_quantity, size_guide, is_live, pickup_available, delivery_available, shipping_available, updated_at, tailor_profiles(id, display_name, business_name, avatar_url, location, availability, shop_paused, is_live)'

export function hasNonEmptyText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

export function isPayoutReady(profile: TailorProfile | null | undefined) {
  if (!profile || profile.payout_reverification_required === true) return false
  if (profile.payout_account_verified === true) return true

  const manualBankStatus = String(profile.manual_bank_verification_status ?? '').toUpperCase()
  return (
    hasNonEmptyText(profile.paystack_recipient_code) ||
    hasNonEmptyText(profile.stripe_connect_account_id) ||
    hasNonEmptyText(profile.paystack_account_id) ||
    hasNonEmptyText(profile.stripe_account_id) ||
    (profile.manual_bank_entry === true && ['VERIFIED', 'APPROVED'].includes(manualBankStatus))
  )
}

const accountOrderSelect = `
  id, reference, order_kind, garment_type, item_title, item_size, garment_description, occasion, stage, delivery_method,
  delivery_address, recipient_name, recipient_phone,
  fabric_source, fabric_funding_policy_version, special_note, fabric_tracking, tracking_number, carrier, fulfillment_provider, fulfillment_reference, fulfillment_contact_name, fulfillment_contact_phone, reference_photos, customer_measurements_snapshot, quoted_amount, subtotal_amount, fulfillment_fee, shipping_amount,
  tax_amount, import_tax_amount, duty_amount, tax_collection_mode, tax_responsible_party, tax_rate_bps, tax_region, tax_fallback, platform_fee_amount, total_amount, currency, quoted_currency, created_at, updated_at, deadline,
  quoted_completion_date, quote_expires_at, customer_id, tailor_id, tailor_profile_id, seller_item_id, payment_provider,
  fulfillment_payment_requested_at, fulfillment_payment_paid_at, fulfillment_payment_provider, fulfillment_payment_intent_id, fulfillment_payment_checkout_url,
  consultation_fee, video_call_url, escrow_released, auto_release_at, collection_code, collection_code_expiry, collection_code_used,
  tailor_profiles!tailor_profile_id(display_name, business_name, avatar_url, location, consultation_call_type)
`

async function fetchNegotiationSurfaceData(
  supabase: ReturnType<typeof createClient>,
  orderIds: string[]
) {
  if (!QUOTE_NEGOTIATION_UI_ENABLED || orderIds.length === 0) {
    return {
      quotes: [] as AccountOrderQuote[],
      quoteRevisions: [] as AccountQuoteRevision[],
      orderEvents: [] as AccountOrderEvent[],
      warning: null as string | null,
    }
  }

  const [quotesRes, revisionsRes, eventsRes] = await Promise.all([
    supabase
      .from('order_quotes')
      .select(
        'id, order_id, version, status, change_kind, currency, subtotal_amount, tax_amount, platform_fee_amount, delivery_fee_amount, total_amount, completion_date, breakdown, assumptions, expires_at, created_at, fabric_funding_policy_version, fabric_source_snapshot, tailoring_amount, fabric_allowance_amount, fabric_allowance_coverage, fabric_sourcing_assumptions'
      )
      .in('order_id', orderIds)
      .order('version', { ascending: false }),
    supabase
      .from('quote_revision_requests')
      .select(
        'id, order_id, source_quote_id, source_quote_version, round_number, status, reason_codes, note, target_amount, currency, created_at, updated_at'
      )
      .in('order_id', orderIds)
      .order('created_at', { ascending: false }),
    supabase
      .from('order_events')
      .select(
        'id, order_id, event_type, actor_id, actor_role, quote_id, quote_version, revision_request_id, title, summary, metadata, created_at'
      )
      .in('order_id', orderIds)
      .order('created_at', { ascending: true })
      .limit(500),
  ])

  return {
    quotes: quotesRes.error ? [] : ((quotesRes.data ?? []) as AccountOrderQuote[]),
    quoteRevisions: revisionsRes.error ? [] : ((revisionsRes.data ?? []) as AccountQuoteRevision[]),
    orderEvents: eventsRes.error ? [] : ((eventsRes.data ?? []) as AccountOrderEvent[]),
    warning:
      quotesRes.error || revisionsRes.error || eventsRes.error
        ? 'Quote history is temporarily unavailable. Refresh before taking a quote action.'
        : null,
  }
}

async function hydrateOrderCustomerProfiles(
  supabase: ReturnType<typeof createClient>,
  orders: AccountOrder[]
): Promise<AccountOrder[]> {
  const customerIds = uniqueValues(orders.map((order) => order.customer_id))
  if (customerIds.length === 0) return orders

  const { data, error } = await supabase
    .from('customer_profiles')
    .select('user_id, display_name, avatar_url')
    .in('user_id', customerIds)

  if (error) return orders

  const profilesByUserId = new Map(
    (
      (data ?? []) as Array<{
        user_id?: string | null
        display_name?: string | null
        avatar_url?: string | null
      }>
    )
      .filter((profile) => profile.user_id)
      .map((profile) => [
        profile.user_id!,
        {
          display_name: profile.display_name ?? null,
          avatar_url: profile.avatar_url ?? null,
        } satisfies JoinedProfile,
      ])
  )

  return orders.map((order) => ({
    ...order,
    customer_profiles: order.customer_id
      ? (profilesByUserId.get(order.customer_id) ?? order.customer_profiles ?? null)
      : (order.customer_profiles ?? null),
  }))
}

export function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => !!value)))
}

async function functionHttpErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const context = (error as { context?: unknown }).context
  if (
    !context ||
    typeof context !== 'object' ||
    typeof (context as { clone?: unknown }).clone !== 'function'
  ) {
    return null
  }
  try {
    const text = await (context as Response).clone().text()
    if (!text.trim()) return null
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown; code?: unknown }
      const message =
        typeof parsed.message === 'string'
          ? parsed.message
          : typeof parsed.error === 'string'
            ? parsed.error
            : null
      const trimmed = message?.trim()
      return trimmed && isDisplayableActionError(trimmed) ? trimmed : null
    } catch {
      const trimmed = text.trim()
      return isDisplayableActionError(trimmed) ? trimmed : null
    }
  } catch {
    return null
  }
}

export async function invokeAccountFunction<T = Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>
): Promise<T> {
  const supabase = createClient()
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw new Error((await functionHttpErrorMessage(error)) ?? friendlyActionError(error))
  const payload = (data ?? {}) as Record<string, unknown>
  const message =
    typeof payload.message === 'string'
      ? payload.message
      : typeof payload.error === 'string'
        ? payload.error
        : null
  if (payload.error)
    throw new Error(message ?? 'That action could not finish right now. Please try again.')
  return payload as T
}

async function ensureDefaultWishlistCollection(userId: string) {
  const supabase = createClient()
  const name = 'My Go-To Tailors'
  const { data: existing, error: existingError } = await supabase
    .from('wishlist_collections')
    .select('id, name')
    .eq('customer_id', userId)
    .eq('name', name)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return existing as { id: string; name: string }

  const { data: created, error: createError } = await supabase
    .from('wishlist_collections')
    .insert({ customer_id: userId, name })
    .select('id, name')
    .single()

  if (createError) throw createError
  return created as { id: string; name: string }
}

export async function saveTailorDirectly(userId: string, tailorProfileId: string) {
  const collection = await ensureDefaultWishlistCollection(userId)
  const supabase = createClient()
  const { error: itemError } = await supabase.from('wishlist_items').insert({
    collection_id: collection.id,
    item_type: 'TAILOR',
    tailor_id: tailorProfileId,
  })

  if (itemError && (itemError as { code?: string }).code !== '23505') throw itemError
}

export async function removeSavedTailorDirectly(userId: string, tailorProfileId: string) {
  const supabase = createClient()
  const { data: collections, error: collectionsError } = await supabase
    .from('wishlist_collections')
    .select('id')
    .eq('customer_id', userId)

  if (collectionsError) throw collectionsError
  const collectionIds = (collections ?? []).map((collection: { id: string }) => collection.id)
  if (collectionIds.length > 0) {
    const { error: wishlistError } = await supabase
      .from('wishlist_items')
      .delete()
      .eq('item_type', 'TAILOR')
      .eq('tailor_id', tailorProfileId)
      .in('collection_id', collectionIds)

    if (wishlistError) throw wishlistError
  }
}

async function isTailorSavedDirectly(userId: string, tailorProfileId: string) {
  const supabase = createClient()
  const { data: collections, error: collectionsError } = await supabase
    .from('wishlist_collections')
    .select('id')
    .eq('customer_id', userId)

  if (collectionsError) return false
  const collectionIds = (collections ?? []).map((collection: { id: string }) => collection.id)
  if (collectionIds.length === 0) return false

  const { data, error } = await supabase
    .from('wishlist_items')
    .select('id')
    .eq('item_type', 'TAILOR')
    .eq('tailor_id', tailorProfileId)
    .in('collection_id', collectionIds)
    .limit(1)
    .maybeSingle()

  if (error) return false
  return Boolean(data)
}

export async function fetchAccountShellData(userId: string): Promise<AccountShellData> {
  const supabase = createClient()
  let warning: string | null = null

  const [accountRes, customerProfileRes, tailorProfileRes, pickupDetailsRes] = await Promise.all([
    supabase.from('users').select('default_currency').eq('id', userId).maybeSingle(),
    supabase
      .from('customer_profiles')
      .select('user_id, display_name, avatar_url, measurements, unit_preference, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tailor_profiles')
      .select(publicTailorProfileSelect)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tailor_pickup_details')
      .select(
        'user_id, pickup_address, pickup_address_line1, pickup_city, pickup_region, pickup_postal_code, pickup_country_code, pickup_instructions, updated_at'
      )
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  let tailorProfile = tailorProfileRes.error
    ? null
    : ((tailorProfileRes.data ?? null) as TailorProfile | null)
  if (tailorProfileRes.error) {
    warning = warning ?? 'Tailor profile could not load. Refresh to retry.'
  }
  if (tailorProfile?.id) {
    const ownTailorProfileRes = await supabase
      .from('tailor_profiles')
      .select(ownTailorProfileSelect)
      .eq('user_id', userId)
      .maybeSingle()

    if (ownTailorProfileRes.error) {
      warning = warning ?? 'Payout status could not load. Refresh to retry.'
    } else if (ownTailorProfileRes.data) {
      tailorProfile = {
        ...tailorProfile,
        ...(ownTailorProfileRes.data as TailorProfile),
      }
    }
  }
  const pickupDetails = pickupDetailsRes.error
    ? null
    : ((pickupDetailsRes.data ?? null) as TailorPickupDetails | null)
  const orderFilter = tailorProfile?.id
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfile.id}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  let activeOrderCount = 0
  let customerActiveOrderCount = 0
  let tailorActiveOrderCount = 0
  let unreadCount = 0
  let checkoutPendingCount = 0
  const ordersRes = await supabase
    .from('orders')
    .select('id, stage, order_kind, seller_item_id, customer_id, tailor_id, tailor_profile_id')
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  if (!ordersRes.error) {
    const orders = (ordersRes.data ?? []) as Array<{
      id: string
      stage: string | null
      order_kind: string | null
      seller_item_id: string | null
      customer_id: string | null
      tailor_id: string | null
      tailor_profile_id: string | null
    }>
    const activeOrders = orders.filter((order) => !isTerminalOrder(order as AccountOrder))
    const visibleCustomerActiveOrders = activeOrders.filter(
      (order) => order.customer_id === userId && !isReadyMadeInquiryOrder(order)
    )
    activeOrderCount = activeOrders.filter(
      (order) => order.customer_id !== userId || !isReadyMadeInquiryOrder(order)
    ).length
    customerActiveOrderCount = visibleCustomerActiveOrders.length
    tailorActiveOrderCount = activeOrders.filter(
      (order) =>
        order.tailor_id === userId ||
        Boolean(tailorProfile?.id && order.tailor_profile_id === tailorProfile.id)
    ).length
    checkoutPendingCount = orders.filter((order) =>
      ['QUOTE_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.stage ?? '')
    ).length

    const orderIds = orders.map((order) => order.id)
    if (orderIds.length > 0) {
      const messagesRes = await supabase
        .from('messages')
        .select('id, order_id, sender_id, read_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100)

      if (!messagesRes.error) {
        const messages = (messagesRes.data ?? []) as Array<{
          sender_id: string | null
          read_at: string | null
        }>
        unreadCount = messages.filter(
          (message) => message.sender_id !== userId && !message.read_at
        ).length
      }
    }
  }

  return {
    userId,
    accountCurrency: accountRes.error
      ? null
      : ((accountRes.data as { default_currency?: string | null } | null)?.default_currency ??
        null),
    customerProfile: customerProfileRes.error
      ? null
      : ((customerProfileRes.data ?? null) as CustomerProfile | null),
    tailorProfile,
    pickupDetails,
    activeOrderCount,
    customerActiveOrderCount,
    tailorActiveOrderCount,
    unreadCount,
    checkoutPendingCount,
    payoutNeedsSetup: Boolean(tailorProfile && !isPayoutReady(tailorProfile)),
    warning,
  }
}

export async function fetchExploreSurfaceData(userId: string): Promise<ExploreSurfaceData> {
  void userId
  const supabase = createClient()
  let warning: string | null = null

  const exploreTailorsRes = await supabase
    .from('tailor_profiles')
    .select(publicTailorProfileSelect)
    .eq('is_live', true)
    .order('avg_rating', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(24)

  if (exploreTailorsRes.error) {
    warning = 'Explore records could not load. Refresh to retry.'
  }

  return {
    exploreTailors: exploreTailorsRes.error
      ? []
      : ((exploreTailorsRes.data ?? []) as TailorProfile[]),
    exploreItems: [],
    warning,
  }
}

export async function fetchOrdersSurfaceData(
  userId: string,
  tailorProfileId?: string | null
): Promise<OrdersSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error
    ? []
    : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Order history could not load. Refresh to retry.'
  }

  let payments: AccountPayment[] = []
  let messages: AccountMessage[] = []
  let consultationAttendanceReviews: OrdersSurfaceData['consultationAttendanceReviews'] = []
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const [paymentsRes, messagesRes, attendanceReviewsRes] = await Promise.all([
      supabase
        .from('order_payments')
        .select(
          'id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at'
        )
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('messages')
        .select(
          'id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at, is_deleted, edited_at, reply_to_id'
        )
        .in('order_id', orderIds)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('consultation_attendance_reviews')
        .select('order_id, status, reported_by_role, resolution_code, created_at')
        .in('order_id', orderIds)
        .order('created_at', { ascending: false }),
    ])

    if (paymentsRes.error || messagesRes.error || attendanceReviewsRes.error) {
      warning = warning ?? 'Latest order updates are unavailable. Refresh to retry.'
    }
    payments = paymentsRes.error ? [] : ((paymentsRes.data ?? []) as AccountPayment[])
    messages = messagesRes.error ? [] : ((messagesRes.data ?? []) as AccountMessage[])
    consultationAttendanceReviews = attendanceReviewsRes.error
      ? []
      : (
          (attendanceReviewsRes.data ?? []) as Array<{
            order_id: string
            status: string | null
            reported_by_role: 'CUSTOMER' | 'TAILOR' | null
            resolution_code: string | null
            created_at: string
          }>
        ).map((review) => ({
          orderId: review.order_id,
          status: review.status,
          reportedByRole: review.reported_by_role,
          resolutionCode: review.resolution_code,
          createdAt: review.created_at,
        }))
  }

  return {
    orders,
    payments,
    messages,
    consultationAttendanceReviews,
    warning,
  }
}

export async function fetchOrderDetailSurfaceData(
  userId: string,
  orderId?: string,
  tailorProfileId?: string | null
): Promise<OrderDetailSurfaceData> {
  if (!orderId) return emptyOrderDetailSurfaceData

  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const orderRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .eq('id', orderId)
    .or(orderFilter)
    .maybeSingle()

  const order =
    orderRes.error || !orderRes.data
      ? null
      : ((await hydrateOrderCustomerProfiles(supabase, [orderRes.data as AccountOrder]))[0] ?? null)
  if (orderRes.error) {
    warning = 'Order detail could not load. Refresh to retry.'
  }
  if (!order) {
    return {
      ...emptyOrderDetailSurfaceData,
      warning,
    }
  }

  const [
    paymentsRes,
    receiptsRes,
    settlementPlanRes,
    settlementTranchesRes,
    providerDisputesRes,
    messagesRes,
    stageUpdatesRes,
    productionEvidenceRes,
    materialAdvancesRes,
    commercialAdjustmentsRes,
    returnRequestsRes,
    resolutionProposalsRes,
    benefitReservationsRes,
    tipsRes,
    customOrderDetailRes,
    reviewsRes,
    consultationBookingRes,
  ] = await Promise.all([
    supabase
      .from('order_payments')
      .select(
        'id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at'
      )
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('commercial_receipts')
      .select(
        'receipt_number, order_id, payment_id, provider, provider_reference, currency, subtotal_amount, consultation_credit_amount, promotion_amount, platform_fee_amount, tax_amount, import_tax_amount, duty_amount, tax_collection_mode, shipping_amount, total_amount, tax_jurisdiction, paid_at, fabric_funding_policy_version, tailoring_amount, fabric_allowance_amount'
      )
      .eq('order_id', order.id)
      .order('paid_at', { ascending: false })
      .limit(10),
    supabase
      .from('order_settlement_plans')
      .select(
        'id, order_id, method, currency, entitlement_amount, seller_subtotal_amount, excluded_fabric_allowance_amount, material_recovery_offset_amount, status, frozen_reason'
      )
      .eq('order_id', order.id)
      .maybeSingle(),
    supabase
      .from('order_settlement_tranches')
      .select('id, plan_id, code, sequence, amount, currency, status, eligible_at, released_at')
      .eq('order_id', order.id)
      .order('sequence'),
    supabase
      .from('provider_disputes')
      .select('status, amount, currency, evidence_due_at, money_movement_blocked, updated_at')
      .eq('order_id', order.id)
      .order('updated_at', { ascending: false })
      .limit(3),
    supabase
      .from('messages')
      .select(
        'id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at, is_deleted, edited_at, reply_to_id'
      )
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('order_stage_updates')
      .select('id, order_id, stage, note, photo_url, evidence_media, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('order_production_evidence')
      .select('id, order_id, stage_key, note, photo_urls, metadata, created_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('order_material_advances')
      .select(
        'id, order_id, customer_id, tailor_id, requested_by, title, description, amount, currency, status, release_status, estimate_photo_url, estimate_storage_bucket, estimate_storage_path, receipt_url, receipt_storage_bucket, receipt_storage_path, receipt_note, actual_spent_amount, reconciliation_status, reconciliation_outcome, reconciliation_resolution, customer_refund_amount, unapproved_overage_amount, acquired_storage_bucket, acquired_storage_path, reconciled_at, customer_response_note, customer_response_reason, payment_provider, provider_checkout_url, payment_id, created_at, updated_at, funding_source, provider_release_status'
      )
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('commercial_adjustments')
      .select(
        'id, reference, order_id, proposed_by_role, adjustment_type, status, summary, reason, responsibility, amount_delta, currency, original_deadline, proposed_deadline, requires_payment, created_at'
      )
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('order_return_requests')
      .select(
        'id, reference, order_id, requester_role, reason_code, requested_remedy, summary, eligibility_status, eligibility_reason, return_required, status, response_due_at, created_at'
      )
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('order_resolution_proposals')
      .select(
        'id, return_request_id, version, proposed_by_role, remedy, amount, currency, return_required, return_shipping_responsibility, note, status, created_at'
      )
      .eq('order_id', order.id)
      .order('version', { ascending: false })
      .limit(40),
    supabase
      .from('commercial_benefit_reservations')
      .select(
        'id, order_id, total_benefit_amount, customer_due_amount, currency, status, expires_at'
      )
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('order_tips')
      .select('id, order_id, amount, currency, status, customer_id, tailor_id')
      .eq('order_id', order.id)
      .limit(1),
    supabase
      .from('custom_order_details')
      .select(
        'order_id, garment_type_other, gender_presentation, social_reference_links, style_notes, body_note, fabric_description, fabric_budget_amount, fabric_budget_currency, fabric_sourcing_deadline_days, fabric_sourcing_deadline_at, fabric_approval_required, fabric_approval_status, fabric_approval_requested_at, fabric_approved_at, fabric_changes_requested_at, shipping_preference, delivery_instructions, target_delivery_date'
      )
      .eq('order_id', order.id)
      .maybeSingle(),
    supabase
      .from('reviews')
      .select('id, order_id, rating, created_at')
      .eq('order_id', order.id)
      .limit(80),
    supabase
      .from('consultation_bookings')
      .select(
        'status, scheduled_start_at, scheduled_end_at, fee_mode, fee_amount, fee_currency, payment_status, paid_at, call_type'
      )
      .eq('order_id', order.id)
      .eq('status', 'CONFIRMED')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (
    paymentsRes.error ||
    receiptsRes.error ||
    settlementPlanRes.error ||
    settlementTranchesRes.error ||
    providerDisputesRes.error ||
    messagesRes.error ||
    stageUpdatesRes.error ||
    productionEvidenceRes.error ||
    materialAdvancesRes.error ||
    commercialAdjustmentsRes.error ||
    returnRequestsRes.error ||
    resolutionProposalsRes.error ||
    benefitReservationsRes.error ||
    tipsRes.error ||
    customOrderDetailRes.error ||
    reviewsRes.error ||
    consultationBookingRes.error
  ) {
    warning = warning ?? 'Latest order updates are unavailable. Refresh to retry.'
  }
  const negotiation = await fetchNegotiationSurfaceData(supabase, [order.id])
  warning = warning ?? negotiation.warning

  const stageUpdates = await Promise.all(
    ((stageUpdatesRes.data ?? []) as StageUpdate[]).map(async (update) => {
      if (update.photo_url || !Array.isArray(update.evidence_media)) return update
      const asset = update.evidence_media.find((item) => item && typeof item === 'object') as
        | Record<string, unknown>
        | undefined
      const path =
        typeof asset?.displayPath === 'string'
          ? asset.displayPath
          : typeof asset?.originalPath === 'string'
            ? asset.originalPath
            : null
      if (!path) return update
      const { data: signed, error } = await supabase.storage
        .from('commercial-evidence')
        .createSignedUrl(path, 10 * 60)
      return { ...update, photo_url: error ? null : (signed?.signedUrl ?? null) }
    })
  )
  const productionEvidence = await Promise.all(
    ((productionEvidenceRes.data ?? []) as ProductionEvidence[]).map(async (row) => ({
      ...row,
      photo_urls: (
        await Promise.all(
          stringList(row.photo_urls).map(async (value) => {
            if (/^https?:\/\//iu.test(value)) return value
            if (!value.includes('/production/')) return null
            const { data: signed, error } = await supabase.storage
              .from('commercial-evidence')
              .createSignedUrl(value, 10 * 60)
            return error ? null : (signed?.signedUrl ?? null)
          })
        )
      ).filter((value): value is string => !!value),
    }))
  )

  return {
    order,
    payments: paymentsRes.error ? [] : ((paymentsRes.data ?? []) as AccountPayment[]),
    receipts: receiptsRes.error ? [] : ((receiptsRes.data ?? []) as AccountCommercialReceipt[]),
    settlementPlan: settlementPlanRes.error
      ? null
      : ((settlementPlanRes.data ?? null) as AccountSettlementPlan | null),
    settlementTranches: settlementTranchesRes.error
      ? []
      : ((settlementTranchesRes.data ?? []) as AccountSettlementTranche[]),
    providerDisputes: providerDisputesRes.error
      ? []
      : ((providerDisputesRes.data ?? []) as AccountProviderDispute[]),
    messages: messagesRes.error ? [] : ((messagesRes.data ?? []) as AccountMessage[]),
    stageUpdates: stageUpdatesRes.error ? [] : stageUpdates,
    productionEvidence: productionEvidenceRes.error ? [] : productionEvidence,
    materialAdvances: materialAdvancesRes.error
      ? []
      : ((materialAdvancesRes.data ?? []) as MaterialAdvance[]),
    commercialAdjustments: commercialAdjustmentsRes.error
      ? []
      : ((commercialAdjustmentsRes.data ?? []) as AccountCommercialAdjustment[]),
    returnRequests: returnRequestsRes.error
      ? []
      : ((returnRequestsRes.data ?? []) as AccountReturnRequest[]),
    resolutionProposals: resolutionProposalsRes.error
      ? []
      : ((resolutionProposalsRes.data ?? []) as AccountResolutionProposal[]),
    benefitReservations: benefitReservationsRes.error
      ? []
      : ((benefitReservationsRes.data ?? []) as AccountBenefitReservation[]),
    tips: tipsRes.error ? [] : ((tipsRes.data ?? []) as AccountOrderTip[]),
    customOrderDetail: customOrderDetailRes.error
      ? null
      : ((customOrderDetailRes.data ?? null) as CustomOrderDetail | null),
    reviews: reviewsRes.error ? [] : ((reviewsRes.data ?? []) as AccountReview[]),
    quotes: negotiation.quotes,
    quoteRevisions: negotiation.quoteRevisions,
    orderEvents: negotiation.orderEvents,
    consultationBooking: consultationBookingRes.error
      ? null
      : (consultationBookingRes.data ?? null),
    warning,
  }
}

export async function fetchSupportSurfaceData(
  userId: string,
  tailorProfileId?: string | null
): Promise<SupportSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(12)

  if (ordersRes.error) {
    warning = 'Support order context could not load. Refresh to retry.'
  }

  return {
    orders: ordersRes.error
      ? []
      : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[]),
    warning,
  }
}

export async function fetchShopSurfaceData(
  userId: string,
  tailorProfileId?: string | null
): Promise<ShopSurfaceData> {
  void userId
  const supabase = createClient()

  if (tailorProfileId) {
    const sellerItemsRes = await supabase
      .from('seller_items')
      .select(sellerItemSelect)
      .eq('tailor_profile_id', tailorProfileId)
      .order('updated_at', { ascending: false })
      .limit(30)

    return {
      sellerItems: sellerItemsRes.error ? [] : ((sellerItemsRes.data ?? []) as SellerItem[]),
      exploreItems: [],
      warning: sellerItemsRes.error ? 'Shop records could not load. Refresh to retry.' : null,
    }
  }

  const exploreItemsRes = await supabase
    .from('seller_items')
    .select(sellerItemSelect)
    .eq('is_live', true)
    .neq('stock_status', 'SOLD_OUT')
    .neq('stock_status', 'HIDDEN')
    .order('updated_at', { ascending: false })
    .limit(18)

  return {
    sellerItems: [],
    exploreItems: exploreItemsRes.error ? [] : ((exploreItemsRes.data ?? []) as SellerItem[]),
    warning: exploreItemsRes.error ? 'Ready-made pieces could not load. Refresh to retry.' : null,
  }
}

export async function fetchWorkSurfaceData(
  userId: string,
  tailorProfileId?: string | null
): Promise<WorkSurfaceData> {
  if (!tailorProfileId) return emptyWorkSurfaceData

  const supabase = createClient()
  let warning: string | null = null
  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .or(`tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error
    ? []
    : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Work queue could not load. Refresh to retry.'
  }

  let payments: AccountPayment[] = []
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const paymentsRes = await supabase
      .from('order_payments')
      .select(
        'id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at'
      )
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(80)

    if (paymentsRes.error) {
      warning = warning ?? 'Work payment state could not load. Refresh to retry.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
    }
  }

  const sellerItemsRes = await supabase
    .from('seller_items')
    .select(sellerItemSelect)
    .eq('tailor_profile_id', tailorProfileId)
    .order('updated_at', { ascending: false })
    .limit(30)

  if (sellerItemsRes.error) {
    warning = warning ?? 'Shop records could not load. Refresh to retry.'
  }

  return {
    orders,
    payments,
    sellerItems: sellerItemsRes.error ? [] : ((sellerItemsRes.data ?? []) as SellerItem[]),
    warning,
  }
}

export async function fetchMessagesSurfaceData(
  userId: string,
  tailorProfileId?: string | null
): Promise<MessagesSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select(
      `
        id, reference, order_kind, garment_type, item_title, item_size, stage, total_amount, quoted_amount,
        currency, quoted_currency, special_note, video_call_url, created_at, updated_at, customer_id, tailor_id, tailor_profile_id,
        tailor_profiles!tailor_profile_id(display_name, business_name, avatar_url, location)
      `
    )
    .or(orderFilter)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error
    ? []
    : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Message threads could not load. Refresh to retry.'
  }

  let messages: AccountMessage[] = []
  let reactions: AccountMessageReaction[] = []
  let quotes: AccountOrderQuote[] = []
  let quoteRevisions: AccountQuoteRevision[] = []
  let orderEvents: AccountOrderEvent[] = []
  let consultationBookings: Array<ConsultationBookingSnapshot & { order_id: string }> = []
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const messagesRes = await supabase
      .from('messages')
      .select(
        'id, order_id, sender_id, sender_role, sender_name, type, body, photo_url, voice_url, read_at, created_at, is_deleted, edited_at, reply_to_id'
      )
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(100)

    if (messagesRes.error) {
      warning = warning ?? 'Messages could not load. Refresh to retry.'
    } else {
      messages = (messagesRes.data ?? []) as AccountMessage[]
    }

    const messageIds = messages.map((message) => message.id)
    if (messageIds.length > 0) {
      const reactionsRes = await supabase
        .from('message_reactions')
        .select('id, message_id, order_id, user_id, emoji, created_at')
        .in('message_id', messageIds)
        .order('created_at', { ascending: true })
        .limit(500)

      if (reactionsRes.error) {
        console.warn('[messages] Message reactions could not load.', reactionsRes.error.message)
      } else {
        reactions = (reactionsRes.data ?? []) as AccountMessageReaction[]
      }
    }

    const negotiation = await fetchNegotiationSurfaceData(supabase, orderIds)
    quotes = negotiation.quotes
    quoteRevisions = negotiation.quoteRevisions
    orderEvents = negotiation.orderEvents
    warning = warning ?? negotiation.warning

    const consultationBookingsRes = await supabase
      .from('consultation_bookings')
      .select(
        'order_id,status,scheduled_start_at,scheduled_end_at,fee_mode,fee_amount,fee_currency,payment_status,paid_at,call_type,created_at'
      )
      .in('order_id', orderIds)
      .eq('status', 'CONFIRMED')
      .order('created_at', { ascending: false })
    if (consultationBookingsRes.error) {
      warning = warning ?? 'Consultation call details could not load. Refresh to retry.'
    } else {
      const seenOrderIds = new Set<string>()
      consultationBookings = (consultationBookingsRes.data ?? []).filter((booking) => {
        if (seenOrderIds.has(booking.order_id)) return false
        seenOrderIds.add(booking.order_id)
        return true
      }) as Array<ConsultationBookingSnapshot & { order_id: string }>
    }
  }

  return {
    orders,
    messages,
    reactions,
    quotes,
    quoteRevisions,
    orderEvents,
    consultationBookings,
    warning,
  }
}

export async function fetchSavedSurfaceData(userId: string): Promise<SavedSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null
  let wishlistCollections: WishlistCollection[] = []
  let wishlistItems: WishlistItem[] = []
  let savedTailors: TailorProfile[] = []
  let savedItems: SellerItem[] = []

  const wishlistCollectionsRes = await supabase
    .from('wishlist_collections')
    .select('id, name, cover_image_url, item_count, created_at, updated_at')
    .eq('customer_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (wishlistCollectionsRes.error) {
    warning = 'Saved records could not load. Refresh to retry.'
  } else {
    wishlistCollections = (wishlistCollectionsRes.data ?? []) as WishlistCollection[]
    const collectionIds = wishlistCollections.map((collection) => collection.id)
    if (collectionIds.length > 0) {
      const wishlistItemsRes = await supabase
        .from('wishlist_items')
        .select('id, collection_id, item_type, tailor_id, ready_made_item_id, note, created_at')
        .in('collection_id', collectionIds)
        .order('created_at', { ascending: false })
        .limit(120)

      if (wishlistItemsRes.error) {
        warning = warning ?? 'Wishlist items could not load. Refresh to retry.'
      } else {
        wishlistItems = (wishlistItemsRes.data ?? []) as WishlistItem[]
        const savedTailorIds = uniqueValues(wishlistItems.map((item) => item.tailor_id))
        const savedItemIds = uniqueValues(wishlistItems.map((item) => item.ready_made_item_id))

        if (savedTailorIds.length > 0) {
          const savedTailorsRes = await supabase
            .from('tailor_profiles')
            .select(publicTailorProfileSelect)
            .in('id', savedTailorIds)
            .limit(80)
          if (savedTailorsRes.error) {
            warning = warning ?? 'Saved tailors could not load. Refresh to retry.'
          } else {
            savedTailors = (savedTailorsRes.data ?? []) as TailorProfile[]
          }
        }

        if (savedItemIds.length > 0) {
          const savedItemsRes = await supabase
            .from('seller_items')
            .select(sellerItemSelect)
            .in('id', savedItemIds)
            .limit(80)
          if (savedItemsRes.error) {
            warning = warning ?? 'Saved ready-made items could not load. Refresh to retry.'
          } else {
            savedItems = (savedItemsRes.data ?? []) as SellerItem[]
          }
        }
      }
    }
  }

  return {
    wishlistCollections,
    wishlistItems,
    savedTailors,
    savedItems,
    warning,
  }
}

export async function fetchCheckoutSurfaceData(userId: string): Promise<CheckoutSurfaceData> {
  const supabase = createClient()
  let warning: string | null = null

  const ordersRes = await supabase
    .from('orders')
    .select(accountOrderSelect)
    .eq('customer_id', userId)
    .order('created_at', { ascending: false })
    .limit(40)

  const orders = ordersRes.error
    ? []
    : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[])
  if (ordersRes.error) {
    warning = 'Checkout orders could not load. Refresh to retry.'
  }

  const orderIds = orders.map((order) => order.id)
  let payments: AccountPayment[] = []
  let receipts: AccountCommercialReceipt[] = []

  if (orderIds.length > 0) {
    const paymentsRes = await supabase
      .from('order_payments')
      .select(
        'id, order_id, phase, provider, currency, amount, status, confirmed_at, created_at, refunded_at'
      )
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
      .limit(80)

    if (paymentsRes.error) {
      warning = warning ?? 'Checkout payment records could not load. Refresh to retry.'
    } else {
      payments = (paymentsRes.data ?? []) as AccountPayment[]
    }

    const receiptsRes = await supabase
      .from('commercial_receipts')
      .select(
        'receipt_number, order_id, payment_id, provider, provider_reference, currency, subtotal_amount, consultation_credit_amount, promotion_amount, platform_fee_amount, tax_amount, import_tax_amount, duty_amount, tax_collection_mode, shipping_amount, total_amount, tax_jurisdiction, paid_at, fabric_funding_policy_version, tailoring_amount, fabric_allowance_amount'
      )
      .in('order_id', orderIds)
      .order('paid_at', { ascending: false })
      .limit(80)
    if (receiptsRes.error) {
      warning = warning ?? 'Authoritative payment receipts could not load. Refresh to retry.'
    } else {
      receipts = (receiptsRes.data ?? []) as AccountCommercialReceipt[]
    }
  }
  const negotiation = await fetchNegotiationSurfaceData(supabase, orderIds)
  warning = warning ?? negotiation.warning

  return {
    orders,
    payments,
    receipts,
    quotes: negotiation.quotes,
    warning,
  }
}

export async function fetchEarningsSurfaceData(
  userId: string,
  tailorProfileId?: string | null
): Promise<EarningsSurfaceData> {
  if (!tailorProfileId) return emptyEarningsSurfaceData

  const supabase = createClient()
  let warning: string | null = null
  const [payoutsRes, bankActivityRes, ordersRes] = await Promise.all([
    supabase
      .from('payouts')
      .select(
        'id, tailor_profile_id, amount, currency, provider, status, payout_purpose, provider_payout_id, provider_transfer_status, bank_settlement_status, provider_bank_payout_id, bank_settlement_expected_at, bank_settlement_completed_at, bank_settlement_failure_code, blocked_reason, order_id, initiated_at, completed_at, failed_at, processed_at'
      )
      .eq('tailor_profile_id', tailorProfileId)
      .order('initiated_at', { ascending: false, nullsFirst: false })
      .order('processed_at', { ascending: false, nullsFirst: false })
      .limit(80),
    supabase
      .from('provider_payout_events')
      .select(
        'id, provider, provider_bank_payout_id, amount, currency, status, arrival_at, failure_code, failure_message, created_at'
      )
      .eq('tailor_profile_id', tailorProfileId)
      .is('payout_id', null)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('orders')
      .select(accountOrderSelect)
      .or(`tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`)
      .order('created_at', { ascending: false })
      .limit(80),
  ])

  if (payoutsRes.error) {
    warning = 'Payout records could not load. Refresh to retry.'
  }
  if (bankActivityRes.error) {
    warning = warning ?? 'Stripe bank activity could not load. Refresh to retry.'
  }
  if (ordersRes.error) {
    warning = warning ?? 'Payout order context could not load. Refresh to retry.'
  }

  return {
    payouts: payoutsRes.error ? [] : ((payoutsRes.data ?? []) as AccountPayout[]),
    bankActivity: bankActivityRes.error
      ? []
      : ((bankActivityRes.data ?? []) as AccountProviderPayoutEvent[]),
    orders: ordersRes.error
      ? []
      : await hydrateOrderCustomerProfiles(supabase, (ordersRes.data ?? []) as AccountOrder[]),
    warning,
  }
}

export async function fetchProfileSurfaceData(
  tailorProfileId?: string | null
): Promise<ProfileSurfaceData> {
  if (!tailorProfileId) return emptyProfileSurfaceData

  const supabase = createClient()
  const [sellerItemsRes, portfolioItemsRes, mediaPresentationRes] = await Promise.all([
    supabase
      .from('seller_items')
      .select(sellerItemSelect)
      .eq('tailor_profile_id', tailorProfileId)
      .order('updated_at', { ascending: false })
      .limit(30),
    supabase
      .from('portfolio_items')
      .select('id, image_url, title, description, category, sort_order, created_at')
      .eq('tailor_profile_id', tailorProfileId)
      .order('sort_order', { ascending: true })
      .limit(20),
    invokeAccountFunction<{ media?: MarketplaceMedia[] }>('tailor-profile-action', {
      action: 'get-media-presentation',
    }).catch(() => null),
  ])

  let warning: string | null = null
  if (sellerItemsRes.error) {
    warning = 'Shop records could not load. Refresh to retry.'
  }
  if (portfolioItemsRes.error) {
    warning = warning ?? 'Portfolio records could not load. Refresh to retry.'
  }
  if (!mediaPresentationRes) {
    warning = warning ?? 'Portfolio presentation settings could not load. Refresh to retry.'
  }

  return {
    sellerItems: sellerItemsRes.error ? [] : ((sellerItemsRes.data ?? []) as SellerItem[]),
    portfolioItems: portfolioItemsRes.error
      ? []
      : ((portfolioItemsRes.data ?? []) as PortfolioItem[]),
    portfolioMedia: mediaPresentationRes?.media ?? [],
    warning,
  }
}

export async function fetchSettingsSurfaceData(
  userId: string,
  tailorProfileId?: string | null
): Promise<SettingsSurfaceData> {
  const supabase = createClient()
  const orderFilter = tailorProfileId
    ? `customer_id.eq.${userId},tailor_id.eq.${userId},tailor_profile_id.eq.${tailorProfileId}`
    : `customer_id.eq.${userId},tailor_id.eq.${userId}`

  const ordersRes = await supabase
    .from('orders')
    .select('currency')
    .or(orderFilter)
    .not('currency', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(3)

  return {
    orderCurrencies: ordersRes.error
      ? []
      : uniqueValues(
          (ordersRes.data ?? []).map((order) => (order as { currency?: string | null }).currency)
        ),
    warning: ordersRes.error ? 'Settings order context could not load. Refresh to retry.' : null,
  }
}

export async function fetchItemDetailSurfaceData(itemId?: string): Promise<ItemDetailSurfaceData> {
  if (!itemId) return emptyItemDetailSurfaceData

  const supabase = createClient()
  const itemRes = await supabase
    .from('seller_items')
    .select(sellerItemSelect)
    .eq('id', itemId)
    .maybeSingle()

  return {
    item: itemRes.error ? null : ((itemRes.data ?? null) as SellerItem | null),
    warning: itemRes.error ? 'Ready-made item could not load. Refresh to retry.' : null,
  }
}
