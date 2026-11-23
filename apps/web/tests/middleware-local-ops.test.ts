import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto,
})

test('redirects local Ops requests from another app to the legacy Ops server', () => {
  const response = middleware(
    new NextRequest('http://localhost:3006/ops?view=payouts')
  )

  assert.equal(response.status, 307)
  assert.equal(
    response.headers.get('location'),
    'http://localhost:3005/ops?view=payouts'
  )
})

test('does not redirect a request already served by the legacy Ops server', () => {
  const response = middleware(
    new NextRequest('http://localhost:3005/ops?view=payouts')
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('location'), null)
})
