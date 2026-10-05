import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildProfileParityErrors } from './build-profile-parity.mjs'

const easConfig = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'))
const webWorkerConfig = JSON.parse(await readFile(new URL('../../web/wrangler.jsonc', import.meta.url), 'utf8'))
const featureFlagSource = await readFile(new URL('../lib/feature-flags.ts', import.meta.url), 'utf8')

test('release profiles agree across TestFlight, production app, and web', () => {
  assert.deepEqual(buildProfileParityErrors(easConfig, webWorkerConfig, featureFlagSource), [])
})

test('a production app flag accidentally turned off blocks release', () => {
  const drifted = structuredClone(easConfig)
  drifted.build.production.env.EXPO_PUBLIC_QUOTE_NEGOTIATION_V1 = 'false'
  assert.match(buildProfileParityErrors(drifted, webWorkerConfig, featureFlagSource).join('\n'), /production must set EXPO_PUBLIC_QUOTE_NEGOTIATION_V1="true"/)
})

test('a production web quote flag accidentally turned off blocks release', () => {
  const drifted = structuredClone(webWorkerConfig)
  drifted.vars.NEXT_PUBLIC_QUOTE_NEGOTIATION_V1 = 'false'
  assert.match(buildProfileParityErrors(easConfig, drifted, featureFlagSource).join('\n'), /production web must enable NEXT_PUBLIC_QUOTE_NEGOTIATION_V1/)
})

test('Group Orders and Dark Theme stay explicitly off', () => {
  const drifted = structuredClone(easConfig)
  drifted.build.production.env.EXPO_PUBLIC_GROUP_ORDERS_V1 = 'true'
  assert.match(buildProfileParityErrors(drifted, webWorkerConfig, featureFlagSource).join('\n'), /production must set EXPO_PUBLIC_GROUP_ORDERS_V1="false"/)
})
