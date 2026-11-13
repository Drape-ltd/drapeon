import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const checkout = readFileSync(join(process.cwd(), 'apps/mobile/app/(customer)/tailor/item/checkout/[itemId].tsx'), 'utf8').replace(/\s+/gu, ' ')
const order = readFileSync(join(process.cwd(), 'apps/mobile/app/(customer)/orders/[id].tsx'), 'utf8').replace(/\s+/gu, ' ')
const policy = readFileSync(join(process.cwd(), 'apps/mobile/lib/ready-made-policy.ts'), 'utf8').replace(/\s+/gu, ' ')

test('ready-made declutter keeps checkout, pickup, delivery, payment, and cancellation disclosures', () => {
  assert.ok(checkout.includes('Payment stays protected until the handoff is confirmed.'))
  assert.ok(checkout.includes('Pickup has no delivery fee, but tax can still apply based on the order location. Pickup details stay private until the seller marks the order ready. Bring your collection code and inspect the item before closing the order.'))
  assert.ok(checkout.includes('Drapeon collects the standard delivery or shipping fee in this checkout. Carrier surcharges, customs, or import duties are not charged automatically; if anything extra is needed, Drapeon will ask you to approve it before dispatch.'))
  assert.ok(checkout.includes('ORDER_CANCELLATION_POLICY_ROWS.map'))
  assert.ok(checkout.includes('{ORDER_CANCELLATION_ACK_COPY}'))
  assert.ok(policy.includes('Standard delivery and shipping are Drapeon-managed. The flat fulfillment fee is included in this checkout.'))
  assert.ok(order.includes('This is not your order number. Inspect the order first, then share the code so Drapeon can record the pickup handoff.'))
  assert.ok(order.includes('This exact amount comes from the fabric allowance already paid at checkout. Approval does not charge you again; Drapeon Money Desk reviews the release before the tailor receives it.'))
  assert.ok(order.includes('This is separate from the main order funds. Approve only if this material cost makes sense; Drapeon reviews the release before the tailor receives it.'))
})
