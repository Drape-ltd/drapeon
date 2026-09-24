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
    errors.push(`Missing launch-materials artifact: ${relativePath}`)
    return ''
  }
}

const materials = read('docs/drapeon-launch-materials-and-welcome-copy.md')
const welcomeContract = read('packages/shared/src/lifecycle-welcome.ts')

for (const templateKey of [
  'WELCOME_CUSTOMER_V1',
  'WELCOME_CUSTOMER_NEXT_STEP_V1',
  'WELCOME_TAILOR_V1',
  'WELCOME_TAILOR_NEXT_STEP_V1',
]) {
  if (!welcomeContract.includes(templateKey)) errors.push(`Welcome contract is missing ${templateKey}.`)
  if (!materials.includes(templateKey)) errors.push(`Launch materials are missing ${templateKey}.`)
}

for (const requiredHeading of [
  '## 1. Voice and vocabulary',
  '## 2. Welcome sequence',
  '## 3. Supporting launch materials',
  '## 4. Measurement, conversion, and surveys',
  '## 5. Topics and analytics boundary',
  '## 6. Content QA and release gate',
]) {
  if (!materials.includes(requiredHeading)) errors.push(`Launch materials are missing ${requiredHeading}.`)
}

for (const requiredBoundary of [
  'Resend is a delivery',
  'suppression ledger',
  'marketing consent',
  'verified account display name only',
  'Microsoft Clarity remains deferred for V1',
  'survey participation separate from marketing consent',
  'evidence/<releaseSha>/<surface>/<flow>/',
]) {
  if (!materials.includes(requiredBoundary)) errors.push(`Launch materials are missing boundary: ${requiredBoundary}.`)
}

if (errors.length > 0) {
  console.error('Launch materials contract failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Launch materials contract passed.')
console.log('- Welcome keys, role guidance, consent boundaries, surveys, Topics, and evidence gates are documented.')
