import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTailorStockAlert, formatTailorStockAlertSummary } from './ready-made-stock.ts'

function stockAlert(inventoryQuantity: number, stockStatus?: string) {
  return buildTailorStockAlert({
    itemId: `item-${inventoryQuantity}`,
    title: 'Kaftan',
    sizes: ['M'],
    sizeInventory: { M: inventoryQuantity },
    inventoryQuantity,
    isLive: true,
    stockStatus: stockStatus ?? (inventoryQuantity === 0 ? 'SOLD_OUT' : 'IN_STOCK'),
  })
}

test('one remaining unit is low stock, not sold out', () => {
  const alert = stockAlert(1)

  assert.equal(alert?.severity, 'low_stock')
  assert.equal(formatTailorStockAlertSummary(alert ? [alert] : []), '1 item is running low')
})

test('zero inventory is called sold out separately from low stock', () => {
  const alert = stockAlert(0)

  assert.equal(alert?.severity, 'sold_out')
  assert.equal(formatTailorStockAlertSummary(alert ? [alert] : []), '1 item sold out')
})

test('a server low-stock state also appears in the tailor summary', () => {
  const alert = stockAlert(5, 'LOW_STOCK')

  assert.equal(alert?.severity, 'low_stock')
  assert.equal(formatTailorStockAlertSummary(alert ? [alert] : []), '1 item is running low')
})

test('summary preserves low-stock and sold-out counts separately', () => {
  const low = stockAlert(2)
  const soldOut = stockAlert(0)

  assert.equal(
    formatTailorStockAlertSummary([low, soldOut].filter((alert) => alert !== null)),
    '1 item sold out · 1 item is running low',
  )
})
