import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupOrderTimeline } from '../lib/order-timeline-groups.mjs'

const reminder = (id, days = 8) => ({ id, source: 'stage', type: 'CONFIRMED', actor: 'Order lifecycle', summary: `Drapeon reminded the tailor after ${days} days without a production update.` })
test('repeated reminders collapse without losing evidence', () => {
  const entries = [reminder('a', 9), reminder('b', 8), reminder('c', 7)]
  const groups = groupOrderTimeline(entries)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups.flatMap((group) => group.entries), entries)
})
test('real transitions and differently sourced messages stay separate', () => {
  const entries = [reminder('a'), { ...reminder('b'), summary: 'Order escalated to dispute review.' }, reminder('c'), { ...reminder('d'), source: 'order' }, { ...reminder('e'), type: 'IN_DISPUTE' }]
  assert.equal(groupOrderTimeline(entries).length, 5)
})
