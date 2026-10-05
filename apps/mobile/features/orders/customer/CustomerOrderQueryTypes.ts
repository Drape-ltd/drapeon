import type { OrderStage } from '@drape/shared/order-machine'

export type OrderStageUpdateRow = {
  id: string
  stage: string
  note: string | null
  photo_url: string | null
  evidence_media: unknown
  created_at: string
}

export type CustomOrderDetailRow = {
  garment_type_other: string | null
  gender_presentation: string | null
  social_reference_links: unknown
  style_notes: string | null
  body_note: string | null
  fabric_approval_required: boolean | null
  fabric_approval_status: string | null
  fabric_description: string | null
  fabric_budget_amount: number | null
  fabric_budget_currency: string | null
  fabric_sourcing_deadline_days: number | null
  fabric_sourcing_deadline_at: string | null
  shipping_preference: string | null
  delivery_instructions: string | null
  target_delivery_date: string | null
}

export type TailorProfileJoinRow = {
  display_name: string | null
  location: string | null
}

export type OrderQueryRow = {
  id: string
  reference: string | null
  order_kind: 'CUSTOM' | 'READY_MADE' | null
  seller_item_id: string | null
  fulfillment_option: string | null
  garment_type: string | null
  garment_description: string | null
  occasion: string | null
  deadline: string | null
  item_title: string | null
  item_size: string | null
  item_quantity: number | null
  item_subtotal: number | null
  stage: OrderStage
  tailor_id: string
  quoted_amount: number | null
  currency: string | null
  quoted_currency: string | null
  consultation_fee: number | null
  fulfillment_fee: number | null
  quoted_completion_date: string | null
  quote_expires_at: string | null
  source_currency: string | null
  source_amount: number | null
  subtotal_amount: number | null
  platform_fee_amount: number | null
  tax_amount: number | null
  import_tax_amount: number | null
  duty_amount: number | null
  tax_rate_bps: number | null
  tax_region: string | null
  tax_fallback: boolean | null
  tax_fallback_reason: string | null
  shipping_amount: number | null
  total_amount: number | null
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
  fabric_tracking: string | null
  tracking_number: string | null
  carrier: string | null
  fulfillment_provider: string | null
  fulfillment_reference: string | null
  fulfillment_contact_name: string | null
  fulfillment_contact_phone: string | null
  reference_photos: unknown
  reference_photo_attributions: unknown
  collection_code: string | null
  collection_code_expiry: string | null
  video_call_url: string | null
  handoff_completed_at: string | null
  customer_handoff_confirmed_at: string | null
  special_note: string | null
  customer_measurements_snapshot: Record<string, unknown> | null
  created_at: string
  tailor_profiles: TailorProfileJoinRow | TailorProfileJoinRow[] | null
  custom_order_details: CustomOrderDetailRow | CustomOrderDetailRow[] | null
  order_stage_updates: OrderStageUpdateRow[] | null
  active_quote_id: string | null
  active_quote_version: number | null
  negotiation_round_limit: number | null
  negotiation_rounds_used: number | null
}
