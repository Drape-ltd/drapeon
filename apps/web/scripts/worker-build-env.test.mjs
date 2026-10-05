import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readProductionWorkerVars, withProductionWorkerVars } from './worker-build-env.mjs'

test('production build compiles public flags from Wrangler, not a stale shell value', () => {
  const vars = readProductionWorkerVars()
  const env = withProductionWorkerVars({ NEXT_PUBLIC_QUOTE_NEGOTIATION_V1: 'false', PRIVATE_TEST_SECRET: 'preserved' }, vars)
  assert.equal(vars.NEXT_PUBLIC_QUOTE_NEGOTIATION_V1, 'true')
  assert.equal(env.NEXT_PUBLIC_QUOTE_NEGOTIATION_V1, 'true')
  assert.equal(env.PRIVATE_TEST_SECRET, 'preserved')
})

test('both Cloudflare build and deploy scripts use the guarded production path', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.scripts['cf:build'], 'node ./scripts/cf-build.mjs')
  assert.equal(packageJson.scripts['cf:deploy'], 'node ./scripts/cf-preview.mjs deploy')
  assert.equal(packageJson.scripts['cf:deploy:built'], packageJson.scripts['cf:deploy'])
})
