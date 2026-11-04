import assert from 'node:assert/strict'
import test from 'node:test'
import { continueAfterDraftDelete, getShopItemExitDecision } from './shop-item-exit.ts'

test('an intentional exit dispatches immediately even before the cleared dirty state renders', () => {
  assert.equal(getShopItemExitDecision({ allowExit: true, saving: false }), 'dispatch')
  assert.equal(getShopItemExitDecision({ allowExit: true, saving: true }), 'dispatch')
  assert.equal(getShopItemExitDecision({ allowExit: false, saving: true }), 'block')
  assert.equal(getShopItemExitDecision({ allowExit: false, saving: false }), 'prompt')
})

test('successful draft deletion grants the synchronous exit guard before navigating', () => {
  let allowExit = false
  let navigated = false

  const continued = continueAfterDraftDelete(
    null,
    () => { allowExit = true },
    () => {
      assert.equal(getShopItemExitDecision({ allowExit, saving: false }), 'dispatch')
      navigated = true
    },
  )

  assert.equal(continued, true)
  assert.equal(allowExit, true)
  assert.equal(navigated, true)
})

test('failed draft deletion preserves the prompt guard and stays on the form', () => {
  const error = new Error('delete failed')
  let allowExit = false
  let navigated = false

  const continued = continueAfterDraftDelete(
    error,
    () => { allowExit = true },
    () => { navigated = true },
  )

  assert.equal(continued, false)
  assert.equal(getShopItemExitDecision({ allowExit, saving: false }), 'prompt')
  assert.equal(navigated, false)
})
