import { CANCELLATION_REFUND_COMPONENT_LABELS } from '@drape/shared/cancellation-policy'
import { STAGE_LABELS, type OrderStage } from '@drape/shared/order-machine'
import type { OrderDetail } from './TailorOrderTypes'

export function displayStageChoiceLabel(
  targetStage: OrderStage,
  orderKind: 'CUSTOM' | 'READY_MADE'
) {
  if (orderKind === 'READY_MADE' && targetStage === 'FINISHING') return 'Preparing order'
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') return 'Ready for Drapeon dispatch'
  return STAGE_LABELS[targetStage]
}

export function stageChoiceDetail(targetStage: OrderStage, orderKind: 'CUSTOM' | 'READY_MADE') {
  if (orderKind === 'READY_MADE' && targetStage === 'FINISHING') {
    return 'Pack, check, and prepare the item for handoff.'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'Signal that the packed order is ready for Drapeon-managed dispatch.'
  }
  if (targetStage === 'READY_FOR_COLLECTION') {
    return 'Mark the order ready for customer pickup and code verification.'
  }
  return `Move this order into ${displayStageChoiceLabel(targetStage, orderKind).toLowerCase()} once the real work state has changed.`
}

export function refundCoverageLabel(components: string[]) {
  return components
    .map(
      (component) =>
        CANCELLATION_REFUND_COMPONENT_LABELS[
          component as keyof typeof CANCELLATION_REFUND_COMPONENT_LABELS
        ]
    )
    .join(', ')
}

export function stageUpdateNotePlaceholder(
  order: Pick<OrderDetail, 'orderKind' | 'deliveryMethod'>,
  targetStage: OrderStage
) {
  if (order.orderKind === 'READY_MADE') {
    if (targetStage === 'FINISHING') {
      return order.deliveryMethod === 'LOCAL_COLLECTION'
        ? 'e.g. "Packing your order now and setting it aside for pickup."'
        : 'e.g. "Packing your order now and checking it before dispatch."'
    }
    if (targetStage === 'READY_FOR_COLLECTION') {
      return 'e.g. "Your order is packed and ready for pickup. Please bring your collection code when you come."'
    }
    if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
      return 'e.g. "Your order is packed and ready for Drapeon dispatch. We will hand it to Drapeon ops next."'
    }
    if (targetStage === 'OUT_FOR_DELIVERY') {
      return 'e.g. "Your order is packed and a local rider is bringing it to you now."'
    }
    if (targetStage === 'SHIPPED') {
      return 'e.g. "Your order has been packed and handed to the courier today."'
    }
  }

  if (targetStage === 'DESIGNING') {
    return 'e.g. "Finalising the pattern and design details for your order now."'
  }
  if (targetStage === 'SOURCING') {
    return 'e.g. "Sourcing the agreed fabric and materials for your order now."'
  }
  if (targetStage === 'CUTTING') {
    return 'e.g. "Cutting the fabric now using the approved measurements and plan."'
  }
  if (targetStage === 'SEWING') {
    return 'e.g. "The garment is now in sewing and construction."'
  }
  if (targetStage === 'FINISHING') {
    return 'e.g. "Doing final pressing, finishing, and quality checks now."'
  }
  if (targetStage === 'READY_FOR_COLLECTION') {
    return 'e.g. "Your order is finished and ready for pickup. Please bring your collection code when you come."'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'e.g. "Your order is finished, packed, and ready for Drapeon dispatch."'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') {
    return 'e.g. "A local delivery partner now has your order and is on the way."'
  }
  if (targetStage === 'SHIPPED') {
    return 'e.g. "Your order has been finished, packed, and handed to the courier today."'
  }

  return 'e.g. "Sharing a quick update on your order here."'
}

export function stageUpdatePhotoHint(
  order: Pick<OrderDetail, 'orderKind'>,
  targetStage: OrderStage
) {
  if (targetStage === 'SOURCING') {
    return 'Show sourcing progress such as a market visit, supplier options, or materials being compared. The exact fabric selection is submitted separately for customer approval.'
  }
  if (order.orderKind === 'READY_MADE' && targetStage === 'READY_FOR_COLLECTION') {
    return 'Show the packed order so the customer knows pickup is truly ready.'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'Show the packed order so Drapeon ops and the customer can trust that dispatch can begin.'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') {
    return 'Show the packed order or rider handoff so the customer can trust this delivery update.'
  }
  if (targetStage === 'SHIPPED') {
    return 'Show the packed handoff or dispatch proof so the customer can trust the shipment update.'
  }
  return 'Use fresh photo or video proof for this exact stage. Keep the garment fully in frame, steady, and well lit. Reused media is blocked.'
}

export function stageUpdatePhotoLabel(
  order: Pick<OrderDetail, 'orderKind'>,
  targetStage: OrderStage
) {
  if (order.orderKind === 'READY_MADE') {
    if (targetStage === 'FINISHING') return 'Packing proof'
    if (targetStage === 'READY_FOR_COLLECTION') return 'Pickup-ready proof'
    if (targetStage === 'READY_FOR_DRAPE_DISPATCH') return 'Packed-order proof'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') return 'Delivery handoff proof'
  if (targetStage === 'SHIPPED') return 'Dispatch proof'
  return 'Progress proof'
}

export function stageUpdatePhotoRequiredMessage(
  order: Pick<OrderDetail, 'orderKind'>,
  targetStage: OrderStage
) {
  if (order.orderKind === 'READY_MADE' && targetStage === 'READY_FOR_COLLECTION') {
    return 'Add fresh pickup-ready proof so the customer can see the packed order before collection.'
  }
  if (targetStage === 'READY_FOR_DRAPE_DISPATCH') {
    return 'Add fresh packed-order proof so Drapeon can take over dispatch cleanly.'
  }
  if (targetStage === 'OUT_FOR_DELIVERY') {
    return 'Add fresh delivery handoff proof so the customer can trust that the order is really on the way.'
  }
  if (targetStage === 'SHIPPED') {
    return 'Add fresh dispatch proof so the customer can trust this shipment update.'
  }
  return 'Fresh proof at this stage builds trust. Add a photo or video before updating.'
}
