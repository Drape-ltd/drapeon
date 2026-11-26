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
const webStoreLinks = readFileSync(
  new URL('../../web/components/app-store-links.tsx', import.meta.url),
  'utf8'
)
const liveReceipt = readFileSync(new URL('app/(tailor)/claim-receipt.tsx', mobileRoot), 'utf8')
const accountRoutes = readFileSync(
  new URL('../../web/features/account/account-route-runtime.tsx', import.meta.url),
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
  assert.match(layout, /getPendingTailorClaim\(\)\.then/)
  assert.match(layout, /pendingTailorClaimNavigation\.current === token/)
  assert.match(layout, /pathname: '\/claim\/\[token\]'/)
  assert.match(layout, /accountOrigin === 'CLAIMED'/)
  assert.match(layout, /clearPendingTailorClaim\(\)/)
})

test('sign-out clears the pending claim token', () => {
  assert.match(auth, /clearPendingTailorClaim/)
  assert.match(auth, /await clearPendingTailorClaim\(\)/)
})

test('claim entry does not imply ownership before the final claim receipt exists', () => {
  assert.doesNotMatch(route, /\(auth\)\/welcome/)
  assert.doesNotMatch(route, /Claim saved/)
  assert.match(route, /Only people with this link can review your shop before it goes live\./)
  assert.match(route, /state === 'ready' && accountStep === 'review' \? \(/)
  assert.match(route, /BOOTSTRAP_EMAIL_SESSION/)
  assert.match(route, /PREPARE_PROVIDER_PROOF/)
  assert.match(route, /SUBMIT_PROVIDER_PROOF/)
  assert.match(route, /VERIFY_LINKED_PROVIDER/)
  assert.match(route, /supabase\.auth\.linkIdentity/)
  assert.match(route, /REPORT_PROVIDER_CONFLICT/)
  assert.match(route, /FAIL_PROVIDER_SESSION/)
  assert.match(route, /linked\.error\.code === 'identity_already_exists'/)
  assert.match(route, /The provider could not be connected\. Check your connection and try again\./)
  const providerFlow = route.slice(route.indexOf('async function connectProvider'))
  assert.ok(providerFlow.indexOf('SUBMIT_PROVIDER_PROOF') < providerFlow.indexOf('const installed'))
  assert.match(route, /An existing account cannot take over this shop/)
})

test('Google claim linking stays implemented but is hidden unless explicitly enabled', () => {
  assert.match(route, /EXPO_PUBLIC_TAILOR_CLAIM_GOOGLE_ENABLED === 'true'/)
  assert.match(route, /GOOGLE_CLAIM_ENABLED \? \(/)
  assert.match(route, /connectProvider\('google'\)/)
})

test('temporary resolver errors offer retry in the shared floating dock', () => {
  assert.match(
    route,
    /if \(result\.serverError === 'RATE_LIMITED'\) return \{ state: 'rate-limited' \}/
  )
  assert.match(route, /return \{ state: 'retryable' \}/)
  assert.match(route, /state === 'retryable' \|\| state === 'rate-limited'/)
  assert.match(route, /DrapeFloatingActionDock/)
  assert.match(route, /label="Try again"/)
})

test('web handoff uses the shipped drape scheme and both store destinations', () => {
  assert.match(webHandoff, /drape:\/\/claim\//)
  assert.doesNotMatch(webHandoff, /drapeon:\/\//)
  assert.match(webHandoff, /import \{ AppStoreLinks \} from '\.\/app-store-links'/)
  assert.match(webHandoff, /<AppStoreLinks/)
  assert.match(webStoreLinks, /DRAPEON_IOS_STORE_URL/)
  assert.match(webStoreLinks, /DRAPEON_ANDROID_STORE_URL/)
})

test('only the authoritative mobile receipt offers the payout hand-off once', () => {
  assert.match(liveReceipt, /action: 'GET_FINALIZE_RECEIPT'/)
  assert.match(liveReceipt, /accessibilityLabel="Set up payouts"/)
  assert.match(
    liveReceipt,
    /historyChain: appendToHistory\(undefined, '\/\(tailor\)\/claim-receipt'\)/
  )
  assert.doesNotMatch(
    liveReceipt,
    /<Text[^>]*>Set up payouts<\/Text>[\s\S]{0,600}<Text[^>]*>Set up payouts<\/Text>/
  )
  assert.doesNotMatch(accountRoutes, /claim-receipt/)
})

test('a failed finalize clears cold-start intent and offers an explicit publish retry', () => {
  assert.match(layout, /state === 'FAILED' \|\| result\.data\?\.state === 'CLEANING'/)
  assert.match(layout, /await clearPendingTailorFinalize\(\)[\s\S]{0,250}pathname: '\/\(tailor\)\/profile\/setup'/)
  assert.match(liveReceipt, /retryFailureCode \? 'Retry publishing' : 'Retry receipt'/)
  assert.match(liveReceipt, /SHOP STILL PRIVATE/)
})
