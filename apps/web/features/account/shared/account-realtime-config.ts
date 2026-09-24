import type { AccountSurface } from '../surface-contract'

export const ORDER_REALTIME_SURFACES = new Set<AccountSurface>([
  'orders',
  'order-detail',
  'work',
  'checkout',
])

export const QUOTE_NEGOTIATION_UI_ENABLED =
  process.env.NEXT_PUBLIC_QUOTE_NEGOTIATION_V1 === 'true'

export const ORDER_REALTIME_ROW_EVENTS = ['INSERT', 'UPDATE', 'DELETE'] as const

export const ORDER_REALTIME_CHILD_TABLES = [
  'custom_order_details',
  'messages',
  'order_material_advances',
  'order_payments',
  'provider_disputes',
  'order_settlement_plans',
  'order_settlement_tranches',
  'order_production_evidence',
  'order_stage_updates',
  'consultation_attendance_reviews',
  'reviews',
  ...(QUOTE_NEGOTIATION_UI_ENABLED
    ? (['order_quotes', 'quote_revision_requests', 'order_events'] as const)
    : []),
] as const
