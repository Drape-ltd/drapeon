import assert from 'node:assert/strict'
import test from 'node:test'
import { groupEarningsByWeek, startOfWeek } from './earnings-weeks'

const now = new Date(2026, 10, 11, 12) // Wed 11 Nov 2026

test('weeks start on Monday', () => {
  assert.equal(startOfWeek(now).getDate(), 9)
  assert.equal(startOfWeek(new Date(2026, 10, 15, 23)).getDate(), 9) // Sunday stays in the same week
  assert.equal(startOfWeek(new Date(2026, 10, 16, 1)).getDate(), 16)
})

test('earnings group into weeks newest first with per-day totals', () => {
  const weeks = groupEarningsByWeek([
    { date: new Date(2026, 10, 11, 9).toISOString(), netAmount: 12000, netCurrency: 'USD' },
    { date: new Date(2026, 10, 9, 9).toISOString(), netAmount: 500, netCurrency: 'USD' },
    { date: new Date(2026, 10, 4, 9).toISOString(), netAmount: 12500, netCurrency: 'USD' },
  ], 'USD', now)
  assert.equal(weeks.length, 2)
  assert.equal(weeks[0].total, 12500)
  assert.deepEqual(weeks[0].dayTotals, [500, 0, 12000, 0, 0, 0, 0])
  assert.equal(weeks[0].rows[0].netAmount, 12000)
  assert.equal(weeks[1].total, 12500)
  assert.equal(weeks[1].start.getDate(), 2)
  assert.equal(weeks[1].end.getDate(), 8)
})

test('other currencies are listed but never added to the total', () => {
  const [week] = groupEarningsByWeek([
    { date: new Date(2026, 10, 10).toISOString(), netAmount: 9000, netCurrency: 'NGN' },
    { date: new Date(2026, 10, 10).toISOString(), netAmount: 100, netCurrency: 'USD' },
  ], 'USD', now)
  assert.equal(week.total, 100)
  assert.equal(week.rows.length, 2)
})

test('the current week exists even with no earnings', () => {
  const weeks = groupEarningsByWeek([], 'USD', now)
  assert.equal(weeks.length, 1)
  assert.equal(weeks[0].total, 0)
})

test('unsettled orders never count and earnings sit in the week they were earned', () => {
  const weeks = groupEarningsByWeek([
    // Paid last week, touched again this week: stays in last week.
    { date: new Date(2026, 10, 11).toISOString(), earnedAt: new Date(2026, 10, 4).toISOString(), netAmount: 12500, netCurrency: 'USD', settled: true },
    // Unpaid / cancelled order this week: ignored.
    { date: new Date(2026, 10, 10).toISOString(), earnedAt: new Date(2026, 10, 10).toISOString(), netAmount: 9900, netCurrency: 'USD', settled: false },
    { date: new Date(2026, 10, 10).toISOString(), earnedAt: new Date(2026, 10, 10).toISOString(), netAmount: 100, netCurrency: 'NGN', settled: true },
  ], 'USD', now)
  assert.equal(weeks[0].total, 0)
  assert.equal(weeks[0].countedRows, 0)
  assert.equal(weeks[0].rows.length, 1) // the NGN row is listed but not summed
  assert.equal(weeks[1].total, 12500)
  assert.equal(weeks[1].countedRows, 1)
})
