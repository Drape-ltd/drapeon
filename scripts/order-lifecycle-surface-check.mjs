#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const errors = []

function read(relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\s+/gu, ' ')
  } catch {
    errors.push(`Missing order-lifecycle surface: ${relativePath}`)
    return ''
  }
}

const component = read('apps/web/components/order-lifecycle-preview.tsx')
const route = read('apps/web/app/lifecycle-preview/order-timeline/page.tsx')
const evidence = read('apps/web/tests/e2e/order-lifecycle-preview.spec.ts')

for (const [label, source, needles] of [
  ['order timeline preview', component, [
    'TIMELINES',
    "'ready-made'",
    'Simulate provider hold',
    'Order completion and payout release are shown as separate events.',
    'It does not mutate an order, move money, or call a payment provider.',
    'disabled={payoutBlocked || atEnd || activeIndex !== timeline.length - 2}',
  ]],
  ['order timeline route', route, ['OrderLifecyclePreview', 'process.env.NODE_ENV']],
  ['order timeline browser evidence', evidence, [
    '/lifecycle-preview/order-timeline',
    'replays a custom order to completion and keeps payout separate',
    'shows a recoverable provider hold before release',
    'switches to the ready-made branch without custom production stages',
  ]],
]) {
  for (const needle of needles) {
    if (!source.includes(needle)) errors.push(`${label} is missing ${needle}.`)
  }
}

if (errors.length > 0) {
  console.error('Order-lifecycle surface check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Order-lifecycle surface check passed.')
console.log('- Custom and ready-made happy paths, provider-hold recovery, and browser evidence are bound.')
