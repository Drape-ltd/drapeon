import assert from 'node:assert/strict'
import test from 'node:test'
import { exploreSectionNotificationRoute, passportClaimNotificationRoute } from './notification-routing.ts'

test('Explore section push opens seller support and never a customer screen', () => {
  const data = { type: 'EXPLORE_SECTION_MOVED', url: 'https://drapeon.co/account/support' }
  assert.equal(exploreSectionNotificationRoute('TAILOR', data), '/(tailor)/profile/help')
  assert.equal(exploreSectionNotificationRoute('CUSTOMER', data), null)
  assert.equal(exploreSectionNotificationRoute('TAILOR', { type: 'ORDER_UPDATE' }), null)
})

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
