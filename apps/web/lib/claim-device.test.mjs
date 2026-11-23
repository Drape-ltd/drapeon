import assert from 'node:assert/strict'
import test from 'node:test'
import { isPhoneOrTablet } from './claim-device.ts'

test('phone and tablet routing follows the device, independent of viewport width', () => {
  assert.equal(isPhoneOrTablet('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', 'iPhone', 5), true)
  assert.equal(isPhoneOrTablet('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Linux armv8l', 5), true)
  assert.equal(
    isPhoneOrTablet('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 5),
    true
  )
  assert.equal(
    isPhoneOrTablet('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'MacIntel', 0),
    false
  )
  assert.equal(isPhoneOrTablet('Mozilla/5.0 (Windows NT 10.0)', 'Win32', 10), false)
})
