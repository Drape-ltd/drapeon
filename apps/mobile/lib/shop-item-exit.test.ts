import assert from 'node:assert/strict'
import test from 'node:test'
import { continueAfterDraftDelete } from './shop-item-exit.ts'

test('successful draft deletion clears the unsaved state before navigating', () => {
  let unsaved = true
  let navigated = false

  const continued = continueAfterDraftDelete(
    null,
    () => { unsaved = false },
    () => {
      assert.equal(unsaved, false)
      navigated = true
    },
  )

  assert.equal(continued, true)
  assert.equal(unsaved, false)
  assert.equal(navigated, true)
})

test('failed draft deletion preserves the unsaved state and stays on the form', () => {
  const error = new Error('delete failed')
  let unsaved = true
  let navigated = false

  const continued = continueAfterDraftDelete(
    error,
    () => { unsaved = false },
    () => { navigated = true },
  )

  assert.equal(continued, false)
  assert.equal(unsaved, true)
  assert.equal(navigated, false)
})
