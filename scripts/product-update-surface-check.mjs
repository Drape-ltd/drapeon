#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const errors = []

function read(relativePath) {
  const absolutePath = path.join(root, relativePath)
  try {
    return fs.readFileSync(absolutePath, 'utf8')
  } catch {
    errors.push(`Missing product-update surface: ${relativePath}`)
    return ''
  }
}

const shared = read('packages/shared/src/product-updates.ts')
const web = read('apps/web/app/whats-new/page.tsx')
const native = read('apps/mobile/components/ProductUpdatesScreen.tsx')
const customer = read('apps/mobile/app/(customer)/profile/whats-new.tsx')
const tailor = read('apps/mobile/app/(tailor)/profile/whats-new.tsx')
const releaseContract = read('config/release-contract.json')

for (const [label, source, needles] of [
  ['shared contract', shared, ['getVisibleProductUpdates', "surfaces: ['web', 'ios', 'android']"]],
  ['web feed', web, ['getVisibleProductUpdates', 'data-analytics-event="product_update_opened"']],
  ['native feed', native, ['getVisibleProductUpdates', 'captureLifecycleEvent', 'product_update_opened', 'You’re up to date', 'Platform.OS', 'AsyncStorage', 'readUpdateIds', 'markRead', 'drapeon.product-updates.']],
  ['customer route', customer, ['ProductUpdatesScreen', 'role="CUSTOMER"']],
  ['tailor route', tailor, ['ProductUpdatesScreen', 'role="TAILOR"']],
  ['release contract', releaseContract, ['education.whats-new', '"happy"', '"negative"']],
]) {
  for (const needle of needles) {
    if (!source.includes(needle)) errors.push(`${label} is missing ${needle}.`)
  }
}

if (errors.length > 0) {
  console.error('Product-update surface check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Product-update surface check passed.')
console.log('- Shared web/iOS/Android feeds, role routes, consent-aware telemetry, and release evidence are bound.')
