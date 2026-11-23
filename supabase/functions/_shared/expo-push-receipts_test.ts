import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { classifyExpoPushReceipt, receiptIndicatesBadDeviceToken, receiptNeedsMoneyPushCheck } from './expo-push-receipts.ts'

Deno.test('quarantines only definite repeated BadDeviceToken outcomes', () => {
  assertEquals(receiptIndicatesBadDeviceToken(classifyExpoPushReceipt({
    status: 'error', details: { error: 'BadDeviceToken' },
  })), true)
  assertEquals(receiptIndicatesBadDeviceToken(classifyExpoPushReceipt({
    status: 'error', message: 'APNs: BadDeviceToken', details: { error: 'DeveloperError' },
  })), true)
  assertEquals(receiptIndicatesBadDeviceToken(classifyExpoPushReceipt({
    status: 'error', message: 'Unknown failure', details: { error: 'DeveloperError' },
  })), false)
  assertEquals(receiptIndicatesBadDeviceToken(classifyExpoPushReceipt({ status: 'ok' })), false)
})

Deno.test('classifies accepted Expo receipts without claiming device delivery', () => {
  assertEquals(classifyExpoPushReceipt({ status: 'ok' }), { kind: 'provider-accepted' })
})

Deno.test('classifies missing Expo receipts as pending', () => {
  assertEquals(classifyExpoPushReceipt(undefined), { kind: 'pending' })
  assertEquals(classifyExpoPushReceipt({}), { kind: 'pending' })
})

Deno.test('preserves Expo delivery error codes for token cleanup and ops review', () => {
  assertEquals(
    classifyExpoPushReceipt({
      status: 'error',
      message: 'The device is not registered.',
      details: { error: 'DeviceNotRegistered' },
    }),
    {
      kind: 'delivery-error',
      errorCode: 'DeviceNotRegistered',
      message: 'The device is not registered.',
    },
  )
})

Deno.test('persisted delivery errors and expired receipts check the durable money outcome', () => {
  const deliveryError = classifyExpoPushReceipt({ status: 'error', details: { error: 'DeviceNotRegistered' } })
  const missingReceipt = classifyExpoPushReceipt(undefined)
  const acceptedReceipt = classifyExpoPushReceipt({ status: 'ok' })
  assertEquals(receiptNeedsMoneyPushCheck(deliveryError, false, true), true)
  assertEquals(receiptNeedsMoneyPushCheck(missingReceipt, true, true), true)
  assertEquals(receiptNeedsMoneyPushCheck(missingReceipt, false, true), false)
  assertEquals(receiptNeedsMoneyPushCheck(acceptedReceipt, false, true), false)
  assertEquals(receiptNeedsMoneyPushCheck(deliveryError, false, false), false)
  assertEquals(receiptNeedsMoneyPushCheck(missingReceipt, true, false), false)
})
