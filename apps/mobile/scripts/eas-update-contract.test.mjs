import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { easUpdateContractErrors } from './eas-update-contract.mjs'

const [app, eas, pkg] = await Promise.all(
  ['../app.json', '../eas.json', '../package.json'].map(async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')))
)

test('all mobile builds have compatible, isolated update configuration', () => {
  assert.deepEqual(easUpdateContractErrors(app, eas, pkg), [])
})

test('a production build pointed at the staging channel fails', () => {
  const drifted = structuredClone(eas)
  drifted.build.production.channel = 'staging'
  assert.match(easUpdateContractErrors(app, drifted, pkg).join('\n'), /production must use the production update channel/)
})

test('a mismatched update URL or missing runtime policy fails', () => {
  const drifted = structuredClone(app)
  drifted.expo.updates.url = 'https://u.expo.dev/another-project'
  delete drifted.expo.runtimeVersion
  const errors = easUpdateContractErrors(drifted, eas, pkg).join('\n')
  assert.match(errors, /updates.url must match/)
  assert.match(errors, /runtimeVersion must use/)
})
