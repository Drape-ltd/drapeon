import assert from 'node:assert/strict'
import test from 'node:test'
import { pickupAreaFromOrderSnapshot } from './pickup-area'

test('accepted pickup snapshot overrides an outdated seller profile', () => {
  assert.equal(
    pickupAreaFromOrderSnapshot(
      { city: 'Austin', regionCode: 'TX', postalCode: '78701', countryCode: 'US' },
      'New York, USA'
    ),
    'Austin, TX'
  )
})

test('legacy orders without a snapshot retain their profile area', () => {
  assert.equal(pickupAreaFromOrderSnapshot(null, 'New York, USA'), 'New York, USA')
})

test('incomplete snapshots do not expose stale profile or exact address', () => {
  assert.equal(pickupAreaFromOrderSnapshot({ countryCode: 'US' }, 'New York, USA'), null)
})
