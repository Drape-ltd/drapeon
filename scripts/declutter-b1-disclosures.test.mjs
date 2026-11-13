import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const briefSource = readFileSync(join(process.cwd(), 'apps/mobile/app/(customer)/brief/[tailorId].tsx'), 'utf8')
const briefCopy = briefSource.replace(/\s+/gu, ' ')

test('brief declutter keeps delivery, collection, handmade, and cancellation disclosures', () => {
  assert.ok(briefCopy.includes('Drapeon includes a standard'))
  assert.ok(briefCopy.includes('Carrier surcharges, customs, or import duties are never charged'))
  assert.ok(briefCopy.includes('we will ask you to approve anything extra before dispatch.'))
  assert.ok(briefCopy.includes('Share it only when you have collected the order.'))
  assert.ok(briefCopy.includes('Try to collect within 7 days of the ready notice; after 14 days Drapeon may follow up so the tailor is not left storing finished work.'))
  assert.ok(briefCopy.includes('Bespoke garments can have small handmade variation. Fit, finish, wrong item, or quality issues are still protected through the order concern and aftercare path.'))
  assert.ok(briefCopy.includes('ORDER_CANCELLATION_POLICY_ROWS.map'))
  assert.ok(briefCopy.includes('{ORDER_CANCELLATION_ACK_COPY}'))
})
