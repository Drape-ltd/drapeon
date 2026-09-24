import type {
  CommercialAdjustmentType,
  ConsultationAttendanceReviewSnapshot,
  MarketplaceMedia,
  OrderEventType,
  PayoutPurpose,
  ProviderDisputeStatus,
  ResolutionRemedy,
  ReturnReason,
} from '@drape/shared'

export type JoinedProfile = {
  id?: string | null
  display_name?: string | null
  business_name?: string | null
  avatar_url?: string | null
  location?: string | null
  availability?: string | null
  accepts_custom_orders_now?: boolean | null
  shop_paused?: boolean | null
  is_live?: boolean | null
  consultation_call_type?: 'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO' | null
}

export type AccountOrder = {
  id: string
  reference: string | null
  order_kind: string | null
  garment_type: string | null
  item_title: string | null
  item_size: string | null
  garment_description: string | null
  occasion: string | null
  stage: string | null
  delivery_method: string | null
  delivery_address?: string | null
  recipient_name?: string | null
  recipient_phone?: string | null
  fabric_source: string | null
  fabric_funding_policy_version: string | null
  special_note: string | null
  fabric_tracking: string | null
  tracking_number?: string | null
  carrier?: string | null
  fulfillment_provider?: string | null
  fulfillment_reference?: string | null
  fulfillment_contact_name?: string | null
  fulfillment_contact_phone?: string | null
  reference_photos?: string[] | null
  customer_measurements_snapshot?: Record<string, unknown> | null
  quoted_amount: number | null
  subtotal_amount: number | null
  fulfillment_fee: number | null
  shipping_amount: number | null
  tax_amount: number | null
  import_tax_amount?: number | null
  duty_amount?: number | null
  tax_collection_mode?: 'COLLECTED_AT_CHECKOUT' | 'PAYABLE_ON_IMPORT' | 'BLOCKED' | null
  tax_responsible_party?: 'TAILOR' | 'DRAPEON_MARKETPLACE_FACILITATOR' | 'CUSTOMER_IMPORTER' | null
  tax_rate_bps?: number | null
  tax_region?: string | null
  tax_fallback?: boolean | null
  platform_fee_amount: number | null
  total_amount: number | null
  currency: string | null
  quoted_currency: string | null
  created_at: string | null
  updated_at: string | null
  deadline: string | null
  quoted_completion_date: string | null
  quote_expires_at?: string | null
  customer_id: string | null
  tailor_id: string | null
  tailor_profile_id: string | null
  seller_item_id: string | null
  payment_provider: string | null
  fulfillment_payment_requested_at?: string | null
  fulfillment_payment_paid_at?: string | null
  fulfillment_payment_provider?: string | null
  fulfillment_payment_intent_id?: string | null
  fulfillment_payment_checkout_url?: string | null
  consultation_fee?: number | null
  video_call_url?: string | null
  escrow_released: boolean | null
  auto_release_at: string | null
  collection_code: string | null
  collection_code_expiry: string | null
  collection_code_used: boolean | null
  tailor_profiles?: JoinedProfile | JoinedProfile[] | null
  customer_profiles?: JoinedProfile | JoinedProfile[] | null
  active_quote_id?: string | null
  active_quote_version?: number | null
  negotiation_round_limit?: number | null
  negotiation_rounds_used?: number | null
}

export type AccountOrderQuote = {
  id: string
  order_id: string
  version: number
  status: 'ACTIVE' | 'SUPERSEDED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
  change_kind: string
  currency: string
  subtotal_amount: number
  tax_amount: number
  import_tax_amount: number
  duty_amount: number
  tax_collection_mode: string | null
  platform_fee_amount: number
  delivery_fee_amount: number
  total_amount: number
  completion_date: string
  breakdown: string | null
  assumptions: string | null
  expires_at: string | null
  created_at: string
  fabric_funding_policy_version: string | null
  fabric_source_snapshot: string | null
  tailoring_amount: number | null
  fabric_allowance_amount: number | null
  fabric_allowance_coverage: string[] | null
  fabric_sourcing_assumptions: string | null
}

export type AccountQuoteRevision = {
  id: string
  order_id: string
  source_quote_id: string
  source_quote_version: number
  round_number: number
  status: 'OPEN' | 'WITHDRAWN' | 'REVISED' | 'CURRENT_RETAINED' | 'ORDER_DECLINED' | 'CLOSED'
  reason_codes: string[]
  note: string
  target_amount: number | null
  currency: string
  created_at: string
  updated_at: string
}

export type AccountOrderEvent = {
  id: string
  order_id: string
  event_type: OrderEventType
  actor_id: string | null
  actor_role: string
  quote_id: string | null
  quote_version: number | null
  revision_request_id: string | null
  title: string
  summary: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export type AccountPayment = {
  id: string
  order_id: string
  phase: string | null
  provider: string | null
  currency: string | null
  amount: number | null
  status: string | null
  confirmed_at: string | null
  created_at: string | null
  refunded_at: string | null
}

export type AccountCommercialReceipt = {
  receipt_number: string
  order_id: string
  payment_id: string
  provider: string
  provider_reference: string
  currency: string
  subtotal_amount: number
  consultation_credit_amount: number
  promotion_amount: number
  platform_fee_amount: number
  tax_amount: number
  import_tax_amount: number
  duty_amount: number
  tax_collection_mode: 'COLLECTED_AT_CHECKOUT' | 'PAYABLE_ON_IMPORT' | 'BLOCKED' | null
  tax_responsible_party: 'TAILOR' | 'DRAPEON_MARKETPLACE_FACILITATOR' | 'CUSTOMER_IMPORTER' | null
  import_treatment: string | null
  shipping_amount: number
  total_amount: number
  tax_jurisdiction: string | null
  paid_at: string
  fabric_funding_policy_version: string | null
  tailoring_amount: number | null
  fabric_allowance_amount: number | null
}

export type AccountSettlementPlan = {
  id: string
  order_id: string
  method: 'SHIPPED' | 'LOCAL_HANDOFF'
  currency: string
  entitlement_amount: number
  seller_subtotal_amount: number | null
  excluded_fabric_allowance_amount: number
  material_recovery_offset_amount: number
  status: 'ACTIVE' | 'FROZEN' | 'SETTLED' | 'CANCELLED'
  frozen_reason: string | null
}

export type AccountSettlementTranche = {
  id: string
  plan_id: string
  code: string
  sequence: number
  amount: number
  currency: string
  status: 'LOCKED' | 'ELIGIBLE' | 'RELEASE_REQUESTED' | 'RELEASED' | 'BLOCKED' | 'CANCELLED'
  eligible_at: string | null
  released_at: string | null
}

export type AccountMessage = {
  id: string
  order_id: string
  sender_id: string | null
  sender_role?: string | null
  sender_name?: string | null
  type: string | null
  body: string | null
  photo_url: string | null
  voice_url: string | null
  read_at: string | null
  created_at: string | null
  is_deleted?: boolean | null
  edited_at?: string | null
  reply_to_id?: string | null
}

export type AccountMessageReaction = {
  id: string
  message_id: string
  order_id: string
  user_id: string
  emoji: string
  created_at: string | null
}

export type StageUpdate = {
  id: string
  order_id: string
  stage: string | null
  note: string | null
  photo_url: string | null
  evidence_media?: unknown
  created_at: string | null
}

export type ProductionEvidence = {
  id: string
  order_id: string
  stage_key: string | null
  note: string | null
  photo_urls: string[] | null
  metadata: Record<string, unknown> | null
  created_at: string | null
}

export type CustomerProfile = {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  measurements: Record<string, unknown> | null
  unit_preference: string | null
  updated_at: string | null
}

export type TailorProfile = {
  id: string
  user_id: string
  display_name: string | null
  business_name: string | null
  bio: string | null
  location: string | null
  languages: string[] | null
  specialty_tags: string[] | null
  price_range_min: number | null
  price_range_max: number | null
  currency: string | null
  tier: string | null
  availability: string | null
  accepts_custom_orders_now?: boolean | null
  shop_paused?: boolean | null
  seller_type?: string | null
  is_live: boolean | null
  is_verified: boolean | null
  avg_rating: number | null
  total_reviews: number | null
  total_orders: number | null
  supports_custom_orders: boolean | null
  supports_ready_made: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  consultation_mode?: 'UNAVAILABLE' | 'FREE' | 'PAID' | null
  consultation_requirement?: 'OPTIONAL' | 'REQUIRED' | null
  consultation_fee_amount?: number | null
  consultation_currency?: string | null
  consultation_duration_minutes?: number | null
  consultation_call_type?: 'AUDIO' | 'VIDEO' | 'AUDIO_OR_VIDEO' | null
  consultation_fee_creditable?: boolean | null
  portfolio_photo_urls: string[] | null
  portfolio_video_urls: string[] | null
  avatar_url: string | null
  profile_completed?: boolean | null
  id_verification_status?: string | null
  trust_verification_video_path?: string | null
  trust_verification_challenge_id?: string | null
  trust_verification_challenge_text?: string | null
  id_verification_submitted_at?: string | null
  id_verification_rejection_reason?: string | null
  id_verification_rejected_at?: string | null
  id_verification_metadata?: Record<string, unknown> | null
  payout_currency?: string | null
  payout_provider?: string | null
  payout_reverification_required?: boolean | null
  payout_account_type?: string | null
  payout_account_verified?: boolean | null
  payout_account_verified_at?: string | null
  payout_bank_name?: string | null
  payout_account_name?: string | null
  payout_account_masked?: string | null
  payout_country_code?: string | null
  manual_bank_entry?: boolean | null
  manual_bank_name?: string | null
  manual_bank_country_code?: string | null
  manual_bank_country_name?: string | null
  manual_bank_swift_bic?: string | null
  manual_bank_account_name?: string | null
  manual_bank_verification_status?: string | null
  manual_bank_submitted_at?: string | null
  paystack_recipient_code?: string | null
  stripe_connect_account_id?: string | null
  paystack_account_id?: string | null
  stripe_account_id?: string | null
  payout_account_change_count?: number | null
  payout_account_last_changed_at?: string | null
  payout_account_change_locked_until?: string | null
  payout_destination_hold_until?: string | null
}

export type TailorPickupDetails = {
  user_id: string
  pickup_address: string | null
  pickup_address_line1: string | null
  pickup_city: string | null
  pickup_region: string | null
  pickup_postal_code: string | null
  pickup_country_code: string | null
  pickup_instructions: string | null
  updated_at: string | null
}

export type SellerItem = {
  id: string
  tailor_profile_id: string | null
  title: string | null
  description: string | null
  category: string | null
  sizes: string[] | null
  size_inventory?: Record<string, number> | null
  price_amount: number | null
  currency: string | null
  photo_urls: string[] | null
  stock_status: string | null
  inventory_quantity?: number | null
  size_guide?: Record<string, unknown> | null
  is_live: boolean | null
  pickup_available: boolean | null
  delivery_available: boolean | null
  shipping_available: boolean | null
  updated_at: string | null
  tailor_profiles?: JoinedProfile | JoinedProfile[] | null
}

export type ReadyMadeCheckoutPricingPreview = {
  currency: string
  displayCurrency?: string | null
  sourceCurrency?: string | null
  sourceSubtotal?: number | null
  fxRate?: number | null
  fxRateTimestamp?: string | null
  subtotalAmount: number
  platformFeeAmount: number
  taxAmount: number
  taxRateBps: number
  taxRegion: string | null
  taxFallback: boolean
  taxFallbackReason: string | null
  shippingAmount: number
  totalAmount: number
  taxLabel: string | null
}

export type WishlistCollection = {
  id: string
  name: string | null
  cover_image_url: string | null
  item_count: number | null
  created_at: string | null
  updated_at: string | null
}

export type WishlistItem = {
  id: string
  collection_id: string
  item_type: 'TAILOR' | 'READY_MADE_ITEM' | string
  tailor_id: string | null
  ready_made_item_id: string | null
  note: string | null
  created_at: string | null
}

type TailorReview = {
  id: string
  tailor_profile_id: string | null
  rating: number | null
  body: string | null
  tags: string[] | null
  media_urls: string[] | null
  reviewer_name: string | null
  tailor_response?: string | null
  created_at: string | null
  published_at: string | null
}

export type AccountReview = {
  id: string
  order_id: string | null
  rating: number | null
  created_at: string | null
}

export type PortfolioItem = {
  id: string
  image_url: string | null
  title: string | null
  description: string | null
  category: string | null
  sort_order: number | null
  created_at: string | null
}

export type MaterialAdvance = {
  id: string
  order_id: string
  customer_id: string
  tailor_id: string
  requested_by: string | null
  title: string | null
  description: string | null
  amount: number | null
  currency: string | null
  status: string | null
  release_status: string | null
  estimate_photo_url?: string | null
  estimate_storage_bucket?: string | null
  estimate_storage_path?: string | null
  receipt_url?: string | null
  receipt_storage_bucket?: string | null
  receipt_storage_path?: string | null
  receipt_note?: string | null
  actual_spent_amount?: number | null
  reconciliation_status?: string | null
  reconciliation_outcome?: string | null
  reconciliation_resolution?: string | null
  customer_refund_amount?: number | null
  unapproved_overage_amount?: number | null
  acquired_storage_bucket?: string | null
  acquired_storage_path?: string | null
  reconciled_at?: string | null
  customer_response_note?: string | null
  customer_response_reason?: string | null
  payment_provider?: string | null
  provider_checkout_url?: string | null
  payment_id?: string | null
  created_at: string | null
  updated_at: string | null
  funding_source?: 'LEGACY_SEPARATE_PAYMENT' | 'FUNDED_FABRIC_ALLOWANCE' | null
  provider_release_status?: string | null
}

export type AccountCommercialAdjustment = {
  id: string
  reference: string
  order_id: string
  proposed_by_role: 'CUSTOMER' | 'TAILOR' | 'OPS'
  adjustment_type: CommercialAdjustmentType
  status:
    | 'PROPOSED'
    | 'ACCEPTED'
    | 'DECLINED'
    | 'CANCELLED'
    | 'PAYMENT_PENDING'
    | 'PAID'
    | 'OPS_REVIEW'
    | 'COMPLETED'
  summary: string
  reason: string
  responsibility: string
  amount_delta: number
  currency: string
  original_deadline: string | null
  proposed_deadline: string | null
  requires_payment: boolean
  created_at: string
}

export type AccountReturnRequest = {
  id: string
  reference: string
  order_id: string
  requester_role: 'CUSTOMER' | 'TAILOR'
  reason_code: ReturnReason
  requested_remedy: ResolutionRemedy
  summary: string
  eligibility_status: string
  eligibility_reason: string
  return_required: boolean
  status: string
  response_due_at: string
  created_at: string
}

export type AccountResolutionProposal = {
  id: string
  return_request_id: string
  version: number
  proposed_by_role: 'CUSTOMER' | 'TAILOR' | 'OPS'
  remedy: ResolutionRemedy
  amount: number | null
  currency: string | null
  return_required: boolean
  return_shipping_responsibility: string | null
  note: string
  status: string
  created_at: string
}

export type CustomOrderDetail = {
  order_id: string
  garment_type_other?: string | null
  gender_presentation?: string | null
  social_reference_links?: string[] | null
  style_notes?: string | null
  body_note?: string | null
  fabric_description?: string | null
  fabric_budget_amount?: number | null
  fabric_budget_currency?: string | null
  fabric_sourcing_deadline_days?: number | null
  fabric_sourcing_deadline_at?: string | null
  fabric_approval_required: boolean | null
  fabric_approval_status: string | null
  fabric_approval_requested_at?: string | null
  fabric_approved_at?: string | null
  fabric_changes_requested_at?: string | null
  shipping_preference?: string | null
  delivery_instructions?: string | null
  target_delivery_date?: string | null
}

export type AccountPayout = {
  id: string
  tailor_profile_id: string | null
  amount: number | null
  currency: string | null
  provider: string | null
  status: string | null
  payout_purpose: PayoutPurpose
  provider_payout_id: string | null
  provider_transfer_status: string | null
  bank_settlement_status: string | null
  provider_bank_payout_id: string | null
  bank_settlement_expected_at: string | null
  bank_settlement_completed_at: string | null
  bank_settlement_failure_code: string | null
  blocked_reason: string | null
  order_id: string | null
  initiated_at: string | null
  completed_at: string | null
  failed_at: string | null
  processed_at: string | null
}

export type AccountProviderDispute = {
  status: ProviderDisputeStatus
  amount: number
  currency: string
  evidence_due_at: string | null
  money_movement_blocked: boolean
  updated_at: string
}

export type AccountProviderPayoutEvent = {
  id: string
  provider: string | null
  provider_bank_payout_id: string | null
  amount: number | null
  currency: string | null
  status: string | null
  arrival_at: string | null
  failure_code: string | null
  failure_message: string | null
  created_at: string | null
}

export type AccountBaseData = {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
  warning: string | null
}

export type AccountShellData = {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
  pickupDetails: TailorPickupDetails | null
  activeOrderCount: number
  customerActiveOrderCount: number
  tailorActiveOrderCount: number
  unreadCount: number
  checkoutPendingCount: number
  payoutNeedsSetup: boolean
  warning: string | null
}

export type ExploreSurfaceData = {
  exploreTailors: TailorProfile[]
  exploreItems: SellerItem[]
  warning: string | null
}

export type ExploreRenderData = ExploreSurfaceData & {
  userId: string | null
  accountCurrency: string | null
}

export type OrderActorData = {
  userId: string | null
  tailorProfile: TailorProfile | null
}

export type OrdersSurfaceData = {
  orders: AccountOrder[]
  payments: AccountPayment[]
  messages: AccountMessage[]
  consultationAttendanceReviews: Array<
    ConsultationAttendanceReviewSnapshot & {
      orderId: string
      createdAt: string
    }
  >
  warning: string | null
}

export type OrdersRenderData = OrdersSurfaceData & OrderActorData

export type OrderDetailSurfaceData = {
  order: AccountOrder | null
  payments: AccountPayment[]
  receipts: AccountCommercialReceipt[]
  settlementPlan: AccountSettlementPlan | null
  settlementTranches: AccountSettlementTranche[]
  providerDisputes: AccountProviderDispute[]
  messages: AccountMessage[]
  stageUpdates: StageUpdate[]
  productionEvidence: ProductionEvidence[]
  materialAdvances: MaterialAdvance[]
  commercialAdjustments: AccountCommercialAdjustment[]
  returnRequests: AccountReturnRequest[]
  resolutionProposals: AccountResolutionProposal[]
  benefitReservations: AccountBenefitReservation[]
  tips: AccountOrderTip[]
  customOrderDetail: CustomOrderDetail | null
  reviews: AccountReview[]
  quotes: AccountOrderQuote[]
  quoteRevisions: AccountQuoteRevision[]
  orderEvents: AccountOrderEvent[]
  consultationBooking: {
    status: string | null
    scheduled_start_at: string | null
    scheduled_end_at: string | null
    fee_mode: string | null
    fee_amount: number | null
    fee_currency: string | null
    payment_status: string | null
    paid_at: string | null
    call_type: string | null
  } | null
  warning: string | null
}

export type ConsultationBookingSnapshot = {
  order_id?: string
  status: string | null
  scheduled_start_at: string | null
  scheduled_end_at: string | null
  fee_mode: string | null
  fee_amount: number | null
  fee_currency: string | null
  payment_status: string | null
  paid_at: string | null
  call_type: string | null
}

export type AccountBenefitReservation = {
  id: string
  order_id: string
  total_benefit_amount: number
  customer_due_amount: number
  currency: string
  status: string
  expires_at: string
}

export type AccountOrderTip = {
  id: string
  order_id: string
  amount: number
  currency: string
  status: string
  customer_id: string
  tailor_id: string
}

export type OrderDetailRenderData = OrderDetailSurfaceData &
  OrderActorData & {
    customerProfile: CustomerProfile | null
  }

export type PayoutRenderData = {
  tailorProfile: TailorProfile | null
}

export type SupportSurfaceData = {
  orders: AccountOrder[]
  warning: string | null
}

export type SupportRenderData = SupportSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
}

export type ShopSurfaceData = {
  sellerItems: SellerItem[]
  exploreItems: SellerItem[]
  warning: string | null
}

export type ShopRenderData = ShopSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
  pickupDetails: TailorPickupDetails | null
}

export type WorkSurfaceData = {
  orders: AccountOrder[]
  payments: AccountPayment[]
  sellerItems: SellerItem[]
  warning: string | null
}

export type WorkRenderData = WorkSurfaceData & OrderActorData

export type CheckoutSurfaceData = {
  orders: AccountOrder[]
  payments: AccountPayment[]
  receipts: AccountCommercialReceipt[]
  quotes: AccountOrderQuote[]
  warning: string | null
}

export type CheckoutRenderData = CheckoutSurfaceData & {
  userId: string | null
}

export type EarningsSurfaceData = {
  payouts: AccountPayout[]
  bankActivity: AccountProviderPayoutEvent[]
  orders: AccountOrder[]
  warning: string | null
}

export type EarningsRenderData = EarningsSurfaceData & {
  tailorProfile: TailorProfile | null
}

export type ProfileSurfaceData = {
  sellerItems: SellerItem[]
  portfolioItems: PortfolioItem[]
  portfolioMedia: MarketplaceMedia[]
  warning: string | null
}

export type ProfileRenderData = ProfileSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
  pickupDetails: TailorPickupDetails | null
}

export type SettingsSurfaceData = {
  orderCurrencies: string[]
  warning: string | null
}

export type SettingsRenderData = SettingsSurfaceData & {
  userId: string | null
  accountCurrency: string | null
  customerProfile: CustomerProfile | null
  tailorProfile: TailorProfile | null
}

export type TailorDetailSurfaceData = {
  tailor: TailorProfile | null
  readyMade: SellerItem[]
  tailorReviews: TailorReview[]
  isSaved: boolean
  warning: string | null
}

export type ItemDetailSurfaceData = {
  item: SellerItem | null
  warning: string | null
}

export type ItemDetailRenderData = ItemDetailSurfaceData & {
  userId: string | null
  tailorProfile: TailorProfile | null
}

export type MessagesSurfaceData = {
  orders: AccountOrder[]
  messages: AccountMessage[]
  reactions: AccountMessageReaction[]
  quotes: AccountOrderQuote[]
  quoteRevisions: AccountQuoteRevision[]
  orderEvents: AccountOrderEvent[]
  consultationBookings: Array<ConsultationBookingSnapshot & { order_id: string }>
  warning: string | null
}

export type MessagesRenderData = MessagesSurfaceData & {
  userId: string | null
}

export type SavedSurfaceData = {
  wishlistCollections: WishlistCollection[]
  wishlistItems: WishlistItem[]
  savedTailors: TailorProfile[]
  savedItems: SellerItem[]
  warning: string | null
}
