import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { otaPlan } from './publish-ota.mjs'

const config = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'))
const sha = 'a'.repeat(40)

test('staging and production use their corresponding profile variables', () => {
  const staging = otaPlan(config, 'staging', sha)
  const production = otaPlan(config, 'production', sha)
  assert.equal(staging.env.EXPO_PUBLIC_APP_VARIANT, 'testflight')
  assert.equal(staging.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT, 'beta')
  assert.equal(production.env.EXPO_PUBLIC_APP_VARIANT, 'production')
  assert.equal(production.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT, 'production')
  assert.equal(production.env.EXPO_PUBLIC_RELEASE_SHA, sha)
  assert.ok(production.args.includes('--environment'))
  assert.ok(production.args.includes('production'))
})

test('rejects wrong channel, SHA, or backend', () => {
  assert.throws(() => otaPlan(config, 'development', sha))
  assert.throws(() => otaPlan(config, 'production', 'short'))
  const bad = structuredClone(config)
  bad.build.production.env.EXPO_PUBLIC_SUPABASE_ENV = 'development'
  assert.throws(() => otaPlan(bad, 'production', sha))
})
