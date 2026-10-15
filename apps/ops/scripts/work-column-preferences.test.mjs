import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_WORK_COLUMNS, parseWorkColumns } from '../lib/work-column-preferences.mjs'

test('missing or corrupt preferences do not hide operational columns', () => {
  for (const raw of [null, '', '{', 'null', '42']) assert.deepEqual(parseWorkColumns(raw), DEFAULT_WORK_COLUMNS)
})

test('partial preferences restore valid choices and ignore unrelated data', () => {
  assert.deepEqual(parseWorkColumns(JSON.stringify({ context: false, activity: false, assignee: 'false', casePayload: 'not a preference' })), {
    context: false, assignee: true, nextAction: true, activity: false,
  })
})
