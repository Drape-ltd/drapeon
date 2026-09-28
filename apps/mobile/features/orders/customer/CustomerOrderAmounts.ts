import type { OrderDetail } from './contracts'

export function baseAmount(
  order: Pick<
    OrderDetail,
    | 'orderKind'
    | 'itemSubtotal'
    | 'subtotalAmount'
    | 'quotedAmount'
    | 'fulfillmentFee'
    | 'taxAmount'
  >
) {
  if (typeof order.subtotalAmount === 'number' && order.subtotalAmount > 0) {
    return order.subtotalAmount
  }
  if (order.orderKind === 'READY_MADE') {
    return (
      order.itemSubtotal ??
      (order.quotedAmount != null ? Math.max(order.quotedAmount - order.fulfillmentFee, 0) : null)
    )
  }
  if (order.quotedAmount == null) return null
  return Math.max(order.quotedAmount - order.fulfillmentFee - (order.taxAmount ?? 0), 0)
}

export function fulfillmentFeeLabel(
  order: Pick<OrderDetail, 'orderKind' | 'deliveryMethod' | 'fulfillmentOption'>
) {
  if (
    order.deliveryMethod === 'LOCAL_DELIVERY' ||
    (order.orderKind === 'READY_MADE' && order.fulfillmentOption === 'DELIVERY')
  )
    return 'Standard delivery fee'
  if (order.deliveryMethod === 'LOCAL_COLLECTION' || order.fulfillmentOption === 'PICKUP')
    return 'Fulfillment fee'
  return 'Standard shipping fee'
}
