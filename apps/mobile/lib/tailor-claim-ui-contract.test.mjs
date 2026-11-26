import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mobileRoot = new URL('../', import.meta.url)
const route = readFileSync(new URL('app/claim/[token].tsx', mobileRoot), 'utf8')
const webFlow = readFileSync(
  new URL('../../web/components/claim-web-flow.tsx', import.meta.url),
  'utf8'
)
const tailorSetup = readFileSync(
  new URL('app/(tailor)/profile/setup.tsx', mobileRoot),
  'utf8'
)
const claimReceipt = readFileSync(
  new URL('app/(tailor)/claim-receipt.tsx', mobileRoot),
  'utf8'
)
const tailorTabs = readFileSync(new URL('app/(tailor)/_layout.tsx', mobileRoot), 'utf8')
const claimAction = readFileSync(
  new URL('../../../supabase/functions/tailor-claim-action/index.ts', import.meta.url),
  'utf8'
)

test('claim sign-in and pickup reuse the shared Drapeon form primitives', () => {
  assert.match(route, /accountStep === 'password'/)
  assert.match(route, /textContentType="newPassword"/)
  assert.match(route, /autoComplete="new-password"/)
  assert.match(route, /<PhoneNumberInput/)
  assert.match(route, /<AddressAutocompleteInput/)
  assert.match(route, /<ChoiceSheet/)
  assert.match(route, /Apartment \/ unit \(optional\)/)
  assert.match(route, /Confirm your address/)
  assert.match(route, /Enter manually/)
  assert.match(route, /claimPickupPostcodeRequired/)
  assert.match(route, /value\.replace\(\/\\D\/gu, ''\) === '' \? null/)
  assert.match(route, /textContentType="oneTimeCode"/)
  assert.match(route, /Resend code/)
  assert.match(
    route,
    /label="Claim and continue"\s+icon="arrow-right"\s+testID="claim-final-action-dock"/
  )
  assert.match(route, /Next: verify your phone to go live\./)
  assert.match(
    route,
    /provider === 'apple'\s*\?[\s\S]*Try Apple sign-in again[\s\S]*:\s*'The earlier sign-in was closed for safety\. Request a new six-digit email code to continue\.'/
  )
  assert.match(webFlow, /<StructuredAddressSearch/)
  assert.match(webFlow, /autoComplete="new-password"/)
  assert.match(webFlow, /Show password/)
  assert.match(webFlow, /Apartment \/ unit \(optional\)/)
  assert.match(webFlow, /claimPickupPostcodeRequired/)
  assert.match(webFlow, /event\.target\.value\.replace\(\/\\D\/gu, ''\) === ''/)
  assert.match(webFlow, /autoComplete="one-time-code"/)
  assert.match(webFlow, /Resend code/)
  assert.match(webFlow, /Claim and continue/)
  assert.match(webFlow, /<ArrowRight aria-hidden="true" size=\{16\} \/>/)
  assert.match(webFlow, /Next: verify your phone to go live\./)
  assert.match(
    webFlow,
    /SECURE_SESSION_SETUP_RETRY'[\s\S]*The earlier sign-in was closed for safety\. Request a new six-digit email code to continue\./
  )
})

test('claim lifecycle checks use the owner-scoped profile guard RPC', () => {
  assert.match(
    tailorSetup,
    /fetchOwnTailorProfileGuard\(user\.id\)\.then\(\(\{ data \}\) => \{[\s\S]{0,300}setClaimLifecycleState/
  )
  assert.match(
    tailorSetup,
    /async function finalizeClaimAfterPhoneVerification(?:\([^)]*\))?[\s\S]{0,300}fetchOwnTailorProfileGuard\(user\.id\)[\s\S]{0,200}CLAIMED_AWAITING_EMAIL/
  )
  assert.doesNotMatch(
    tailorSetup,
    /\.from\(['"]tailor_profiles['"]\)[\s\S]{0,120}\.select\(['"]lifecycle_state['"]\)/
  )
  assert.match(
    tailorSetup,
    /if \(!claimLifecycleState \|\| !draftHydrated\) return[\s\S]{0,120}setSetupView\('hub'\)/
  )
  assert.match(tailorSetup, /const currentSetupSectionBlocked =\s*!claimLifecycleState &&/)
  assert.match(
    tailorSetup,
    /This environment skipped SMS verification, but publishing requires a recorded phone verification\./
  )
  assert.match(
    tailorSetup,
    /isCurrentPhoneVerified\(normalizedPhone\)[\s\S]*afterVerify === 'finish'[\s\S]*finalizeClaimAfterPhoneVerification\(\)/
  )
})

test('claim edits preserve unfinished comma-separated input until save and phone recovery clears stale claim routing', () => {
  assert.match(route, /const \[editLanguagesText, setEditLanguagesText\] = useState\(''\)/)
  assert.match(route, /value=\{editLanguagesText\}[\s\S]{0,120}onChangeText=\{setEditLanguagesText\}/)
  assert.match(route, /const parsedLanguages = editLanguagesText[\s\S]{0,180}languages: parsedLanguages/)
  assert.match(route, /async function retryClaimWithPhone\(\)[\s\S]{0,900}await clearPendingTailorClaim\(\)[\s\S]{0,180}await clearTailorClaimResume\(\)/)
  assert.match(webFlow, /const \[languagesText, setLanguagesText\] = useState\(''\)/)
  assert.match(webFlow, /const \[specialtiesText, setSpecialtiesText\] = useState\(''\)/)
  assert.match(webFlow, /value=\{languagesText\}[\s\S]{0,100}setLanguagesText\(event\.target\.value\)/)
  assert.match(webFlow, /value=\{specialtiesText\}[\s\S]{0,100}setSpecialtiesText\(event\.target\.value\)/)
  assert.match(webFlow, /languages: languagesText\.split\(','\)[\s\S]{0,160}specialties: specialtiesText\.split\(','\)/)
})

test('private claim preview links refresh before their ten-minute expiry', () => {
  assert.match(route, /AppState\.addEventListener\('change'/)
  assert.match(route, /if \(appIsActive && !wasActive\) void refreshMediaLinks\(\)/)
  assert.match(route, /setInterval\(\(\) => void refreshMediaLinks\(\), 4 \* 60 \* 1000\)/)
  assert.ok(route.includes("action: 'GET_CLAIM_CONTEXT', token"))
  assert.ok(route.includes('setClaimMedia(context.data.media as ClaimMedia[])'))
  assert.ok(claimAction.includes('createSignedUrls('))
  assert.ok(claimAction.includes('10 * 60'))
})

test('the live receipt sends a tailor to the existing payout setup with clear hand-off copy', () => {
  assert.match(claimReceipt, /Your shop is visible and enquiries are open\./)
  assert.match(claimReceipt, /Paid orders start once payouts are set up\./)
  assert.match(claimReceipt, /pathname: '\/\(tailor\)\/profile\/payout-setup'/)
  assert.match(claimReceipt, /historyChain: appendToHistory\(undefined, '\/\(tailor\)\/claim-receipt'\)/)
  assert.match(claimReceipt, />Set up payouts<\/Text>/)
})

test('the live receipt follows system appearance only while focused', () => {
  assert.match(claimReceipt, /useFocusEffect\(useCallback\(\(\) => \{/)
  assert.match(claimReceipt, /Appearance\.setColorScheme\(null\)/)
  assert.match(claimReceipt, /return \(\) => Appearance\.setColorScheme\('light'\)/)
  assert.match(claimReceipt, /const palette = getDrapeColors\(scheme\)/)
  assert.match(claimReceipt, /backgroundColor: palette\.bone/)
  assert.match(tailorTabs, /segments\[1\] === 'claim-receipt'/)
})
