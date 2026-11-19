import assert from 'node:assert/strict'
import test from 'node:test'
import { exploreSectionMoveNotificationPath, passportClaimNotificationRoute } from './notification-routing.ts'

test('section-move pushes open the selected public Explore section', () => {
  assert.equal(exploreSectionMoveNotificationPath({ type: 'explore_section_moved', exploreSectionMove: 'READY_TO_WEAR' }), '/(public)/explore?category=READY_TO_WEAR')
  assert.equal(exploreSectionMoveNotificationPath({ type: 'explore_section_moved', exploreSectionMove: 'TAILORING' }), '/(public)/explore?category=TAILORING')
})

test('unknown section-move payloads cannot inject a route', () => {
  assert.equal(exploreSectionMoveNotificationPath({ type: 'explore_section_moved', exploreSectionMove: '/(tailor)/orders' }), null)
  assert.equal(exploreSectionMoveNotificationPath({ type: 'ORDER_UPDATE', exploreSectionMove: 'READY_TO_WEAR' }), null)
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
