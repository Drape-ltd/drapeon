import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

test('tailors still in setup can open payout setup instead of bouncing to step 1', async () => {
  const runtime = await read('apps/web/features/account/account-route-runtime.tsx')
  assert.match(runtime, /TAILOR_SETUP_ALLOWED_PATHS = \['\/account\/payout'\] as const/u)
  // Both the redirect effect and the render guard must honour the allowlist.
  const guards = runtime.match(/state\.identity\.setupRequired &&\s*!tailorSetupAllowsPath\(pathname\) &&/gu) ?? []
  assert.equal(guards.length, 2)
  assert.match(runtime, /state\.identity\.setupRequired && tailorSetupAllowsPath\(pathname\)/u)
  assert.match(runtime, /href=\{TAILOR_SETUP_RETURN_HREF\}/u)
})

test('selected fulfillment addresses keep the street, not just the place name', async () => {
  for (const path of [
    'apps/web/features/account/profile/tailor-selling-setup-editor.tsx',
    'apps/mobile/app/(tailor)/profile/setup.tsx',
    'apps/mobile/app/(tailor)/profile/edit.tsx',
  ]) {
    const source = await read(path)
    assert.doesNotMatch(source, /setPickupAddress\(address\.line1 \|\| address\.displayValue\)/u, path)
    assert.match(source, /setPickupAddress\(structuredStreetAddress\(address\)\)/u, path)
  }
})
