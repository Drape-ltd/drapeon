import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mobileRoot = new URL('../', import.meta.url)
const appJson = JSON.parse(readFileSync(new URL('app.json', mobileRoot), 'utf8'))
const pending = readFileSync(new URL('lib/pending-tailor-claim.ts', mobileRoot), 'utf8')
const route = readFileSync(new URL('app/claim/[token].tsx', mobileRoot), 'utf8')
const auth = readFileSync(new URL('lib/auth.tsx', mobileRoot), 'utf8')
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
  assert.match(route, /tailor-claim-action/)
  assert.match(route, /data\?\.actionable !== true/)
  assert.doesNotMatch(layout, /getPendingTailorClaim/)
  assert.doesNotMatch(layout, /pendingTailorClaimNavigation/)
})

test('sign-out clears the pending claim token', () => {
  assert.match(auth, /clearPendingTailorClaim/)
  assert.match(auth, /await clearPendingTailorClaim\(\)/)
})

test('claim entry does not imply ownership before the final claim receipt exists', () => {
  assert.doesNotMatch(route, /\(auth\)\/welcome/)
  assert.doesNotMatch(route, /Claim saved/)
  assert.match(route, /No account or shop is claimed until the final claim receipt is issued/)
  assert.match(route, /BOOTSTRAP_EMAIL_SESSION/)
  assert.match(route, /PREPARE_PROVIDER_PROOF/)
  assert.match(route, /SUBMIT_PROVIDER_PROOF/)
  assert.match(route, /VERIFY_LINKED_PROVIDER/)
  assert.match(route, /supabase\.auth\.linkIdentity/)
  assert.match(route, /REPORT_PROVIDER_CONFLICT/)
  const providerFlow = route.slice(route.indexOf('async function connectProvider'))
  assert.ok(providerFlow.indexOf('SUBMIT_PROVIDER_PROOF') < providerFlow.indexOf('const installed'))
  assert.match(route, /An existing account cannot take over this shop/)
})

test('temporary resolver errors offer retry in the shared floating dock', () => {
  assert.match(route, /if \(error\) return 'retryable'/)
  assert.match(route, /catch \{\s+return 'retryable'/)
  assert.match(route, /DrapeFloatingActionDock/)
  assert.match(route, /label="Try again"/)
})

test('web handoff uses the shipped drape scheme and both store destinations', () => {
  assert.match(webHandoff, /drape:\/\/claim\//)
  assert.doesNotMatch(webHandoff, /drapeon:\/\//)
  assert.match(webHandoff, /DRAPEON_IOS_STORE_URL/)
  assert.match(webHandoff, /DRAPEON_ANDROID_STORE_URL/)
})
