import assert from 'node:assert/strict'
import test from 'node:test'
import { passportClaimNotificationRoute } from './notification-routing.ts'

test('tailor passport-claimed pushes route to the claimed Diary filter', () => {
  assert.deepEqual(
    passportClaimNotificationRoute('TAILOR', {
      type: 'PASSPORT_CLAIMED',
      screen: '/(tailor)/clients',
      destinationParams: { tab: 'diary', filter: 'claimed' },
    }),
    {
      pathname: '/(tailor)/clients',
      params: { tab: 'diary', filter: 'claimed' },
    }
  )
})

test('passport-claimed pushes do not open tailor screens in customer mode', () => {
  assert.equal(passportClaimNotificationRoute('CUSTOMER', { type: 'PASSPORT_CLAIMED' }), null)
})

test('other tailor notifications do not override their normal destination', () => {
  assert.equal(passportClaimNotificationRoute('TAILOR', { type: 'ORDER_UPDATE' }), null)
})
