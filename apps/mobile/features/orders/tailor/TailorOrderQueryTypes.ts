import type { OrderStage } from '@drape/shared/order-machine'

export type CustomerProfileJoinRow = {
  display_name: string | null
}

export type CustomOrderDetailJoinRow = {
  garment_type_other: string | null
  gender_presentation: string | null
  social_reference_links: unknown
  style_notes: string | null
  body_note: string | null
  fabric_description: string | null
  fabric_budget_amount: number | null
  fabric_budget_currency: string | null
  fabric_sourcing_deadline_days: number | null
  fabric_sourcing_deadline_at: string | null
  fabric_approval_status: string | null
  shipping_preference: string | null
  delivery_instructions: string | null
  target_delivery_date: string | null
}

export type TailorOrderDetailQueryRow = {
  id: string
  reference: string
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  fulfillment_option: string | null
  garment_type: string | null
  garment_description: string | null
  item_title: string | null
  item_size: string | null
  item_quantity: number | null
  item_subtotal: number | null
  stage: OrderStage
  customer_id: string
  tailor_profile_id: string | null
  quoted_amount: number | null
  currency: string | null
  quoted_currency: string | null
  fulfillment_fee: number | null
  source_amount: number | null
  subtotal_amount: number | null
  tax_amount: number | null
  tax_rate_bps: number | null
  tax_region: string | null
  tax_fallback: boolean | null
  shipping_amount: number | null
  total_amount: number | null
  quoted_completion_date: string | null
  active_quote_id: string | null
  active_quote_version: number | null
  negotiation_round_limit: number | null
  negotiation_rounds_used: number | null
  fulfillment_payment_requested_at: string | null
  fulfillment_payment_paid_at: string | null
  fulfillment_payment_provider: string | null
  fulfillment_payment_intent_id: string | null
  fulfillment_payment_checkout_url: string | null
  fabric_source: string | null
  fabric_funding_policy_version: string | null
  delivery_method: string | null
  delivery_address: string | null
  recipient_name: string | null
  recipient_phone: string | null
  tracking_number: string | null
  carrier: string | null
  fulfillment_provider: string | null
  fulfillment_reference: string | null
  fulfillment_contact_name: string | null
  fulfillment_contact_phone: string | null
  reference_photos: unknown
  reference_photo_attributions: unknown
  fit_note: string | null
  customer_measurements_snapshot: unknown
  special_note: string | null
  collection_code: string | null
  video_call_url: string | null
  occasion: string | null
  deadline: string | null
  created_at: string
  customer_profiles: CustomerProfileJoinRow | CustomerProfileJoinRow[] | null
  custom_order_details: CustomOrderDetailJoinRow | CustomOrderDetailJoinRow[] | null
  order_stage_updates: Array<{
    id: string
    stage: string
    note: string | null
    photo_url: string | null
    evidence_media: unknown
    created_at: string
  }> | null
}
