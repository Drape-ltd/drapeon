import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mobileRoot = new URL('../', import.meta.url)
const appJson = JSON.parse(readFileSync(new URL('app.json', mobileRoot), 'utf8'))
const pending = readFileSync(new URL('lib/pending-tailor-claim.ts', mobileRoot), 'utf8')
const route = readFileSync(new URL('app/claim/[token].tsx', mobileRoot), 'utf8')
const layout = readFileSync(new URL('app/_layout.tsx', mobileRoot), 'utf8')
const webHandoff = readFileSync(
  new URL('../../web/components/claim-app-handoff.tsx', import.meta.url),
  'utf8'
)

test('iOS and Android accept the HTTPS claim route', () => {
  assert.ok(appJson.expo.ios.associatedDomains.includes('applinks:drapeon.co'))
  const claimHosts = appJson.expo.android.intentFilters
    .flatMap((filter) => filter.data ?? [])
    .filter((entry) => entry.pathPrefix === '/claim')
    .map((entry) => entry.host)
  assert.deepEqual(claimHosts.sort(), ['drapeon.co', 'www.drapeon.co'])
})

test('pending claims use secure storage and resume the exact token route', () => {
  assert.match(pending, /expo-secure-store/)
  assert.match(pending, /drapeon\.pending-tailor-claim\.v1/)
  assert.match(route, /savePendingTailorClaim/)
  assert.match(layout, /getPendingTailorClaim/)
  assert.match(layout, /pathname: '\/claim\/\[token\]'/)
})

test('web handoff uses the shipped drape scheme and both store destinations', () => {
  assert.match(webHandoff, /drape:\/\/claim\//)
  assert.doesNotMatch(webHandoff, /drapeon:\/\//)
  assert.match(webHandoff, /DRAPEON_IOS_STORE_URL/)
  assert.match(webHandoff, /DRAPEON_ANDROID_STORE_URL/)
})
