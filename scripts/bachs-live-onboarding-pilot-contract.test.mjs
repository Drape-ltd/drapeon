import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const action = await readFile(
  new URL('supabase/functions/payout-account-action/index.ts', root),
  'utf8'
)

test('payout-account-action admits the live pilot only through the allowlisted gate', () => {
  assert.match(action, /const livePilotOnboarding = !sandboxOnboarding && bachsLiveOnboardingPilotForProfile\(profile\.id\)/u)
  assert.match(action, /if \(!sandboxOnboarding && !livePilotOnboarding\)/u)
  assert.match(action, /livePilot: bachsLiveOnboardingPilotForProfile\(profile\.id\)/u)
  assert.match(action, /bachsOnboardingRouteStatusAccepted\(\s*route\.status,\s*sandboxOnboarding \? 'SANDBOX' : 'LIVE_PILOT'\s*\)/u)
})

test('Production onboarding callbacks never accept localhost', () => {
  assert.doesNotMatch(action, /isAllowedBachsCallbackUrl\([^)]*,\s*true\)/u)
  assert.match(action, /isAllowedBachsCallbackUrl\(body\.returnUrl, sandboxOnboarding\)/u)
  assert.match(action, /isAllowedBachsCallbackUrl\(body\.refreshUrl, sandboxOnboarding\)/u)
})

test('the live onboarding pilot flag is read only by payout-account-action', async () => {
  const functionsDir = new URL('supabase/functions/', root)
  const readers = []
  for (const entry of await readdir(functionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '_shared') continue
    let source
    try {
      source = await readFile(new URL(`${entry.name}/index.ts`, functionsDir), 'utf8')
    } catch {
      continue
    }
    if (/BACHS_LIVE_ONBOARDING_(ENABLED|ALLOWLIST)|bachsLiveOnboardingPilot/u.test(source)) {
      readers.push(entry.name)
    }
  }
  assert.deepEqual(readers, ['payout-account-action'])
})

test('Bachs onboarding re-entry syncs with the provider destinations, never an empty list', async () => {
  const onboarding = await readFile(
    new URL('supabase/functions/_shared/bachs-account-onboarding.ts', root),
    'utf8'
  )
  assert.match(onboarding, /providerDestinations: await input\.listProviderDestinations\(accountId\)/u)
  assert.match(action, /listProviderDestinations: async \(accountId\) =>\s*\(await listBachsPayoutDestinations\(bachsClient, \{ accountId \}\)\)\.destinations/u)
})
