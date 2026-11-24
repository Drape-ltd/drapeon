import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

test('assetlinks.json verifies every Android package that declares autoVerify https links', async () => {
  const statements = JSON.parse(await read('apps/web/public/.well-known/assetlinks.json'))
  const config = await read('apps/mobile/app.config.js')
  const packages = new Set([...config.matchAll(/androidPackage: "([^"]+)"/gu)].map((match) => match[1]))
  assert.ok(packages.size > 0)
  const linked = new Map(statements.map((statement) => [statement.target.package_name, statement]))
  for (const pkg of packages) {
    const statement = linked.get(pkg)
    assert.ok(statement, `missing assetlinks statement for ${pkg}`)
    assert.deepEqual(statement.relation, ['delegate_permission/common.handle_all_urls'])
    assert.equal(statement.target.namespace, 'android_app')
    assert.ok(statement.target.sha256_cert_fingerprints.length > 0)
    for (const fingerprint of statement.target.sha256_cert_fingerprints) {
      assert.match(fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/u)
    }
  }
})

test('Bachs and Stripe return paths are covered by the Android app link filter', async () => {
  const appJson = JSON.parse(await read('apps/mobile/app.json'))
  const filters = appJson.expo.android.intentFilters.filter((filter) => filter.autoVerify === true)
  const data = filters.flatMap((filter) => filter.data)
  assert.ok(data.some((entry) => entry.host === 'drapeon.co' && entry.pathPrefix === '/payments'))
})
