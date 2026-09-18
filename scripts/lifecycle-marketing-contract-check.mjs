#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function read(relativePath) {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath}: file is missing`)
    return ''
  }
  return fs.readFileSync(absolutePath, 'utf8')
}

const config = read('supabase/config.toml')
const guard = read('scripts/supabase-target-guard.mjs')
const webhook = read('supabase/functions/resend-email-webhook/index.ts')
const sharedWebhook = read('supabase/functions/_shared/resend-webhook.ts')
const accountEmail = read('supabase/functions/_shared/account-email.ts')
const suppressionIndex = read('supabase/migrations/20260918120000_communications_address_suppression_lookup.sql')
const welcome = read('packages/shared/src/lifecycle-welcome.ts')
const materials = read('docs/drapeon-launch-materials-and-welcome-copy.md')

if (!config.includes('[functions.resend-email-webhook]')) failures.push('supabase/config.toml: missing [functions.resend-email-webhook]')
if (!guard.includes('RESEND_WEBHOOK_SECRET')) failures.push('scripts/supabase-target-guard.mjs: missing RESEND_WEBHOOK_SECRET')

for (const marker of [
  'verifyResendWebhookSignature',
  'signature_verified: true',
  'communication_provider_events',
  'communication_suppressions',
  'notification_delivery_outcomes',
  "status: 'PROCESSED'",
  "status: 'RETRY'",
]) {
  if (!webhook.includes(marker)) failures.push(`resend-email-webhook: missing ${marker}`)
}

for (const marker of [
  'RESEND_WEBHOOK_MAX_AGE_SECONDS',
  'webhookId',
  'recipient_hashes',
  'email.delivered',
  'email.bounced',
  'email.complained',
]) {
  if (!sharedWebhook.includes(marker)) failures.push(`resend-webhook contract: missing ${marker}`)
}

for (const marker of ['emailAddressHash', 'address_hash', 'PREFERENCE_DISABLED']) {
  if (!accountEmail.includes(marker)) failures.push(`account email suppression: missing ${marker}`)
}
for (const marker of ['communication_suppressions_address_lookup_idx', 'where active and address_hash is not null']) {
  if (!suppressionIndex.includes(marker)) failures.push(`suppression lookup index: missing ${marker}`)
}

for (const marker of [
  'WELCOME_CUSTOMER_V1',
  'WELCOME_CUSTOMER_NEXT_STEP_V1',
  'WELCOME_TAILOR_V1',
  'WELCOME_TAILOR_NEXT_STEP_V1',
  'welcomeIdempotencyKey',
]) {
  if (!welcome.includes(marker)) failures.push(`welcome contract: missing ${marker}`)
  if (!materials.includes(marker)) failures.push(`welcome materials: missing ${marker}`)
}

for (const marker of [
  'Resend is a delivery',
  'suppression ledger',
  'marketing consent',
  'passwords, auth tokens, recovery codes',
]) {
  if (!materials.includes(marker)) failures.push(`welcome materials boundary: missing ${marker}`)
}

if (failures.length) {
  console.error('Lifecycle/marketing contract failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Lifecycle/marketing contract passed.')
console.log('- Welcome copy remains canonical and role-specific.')
console.log('- Resend delivery is signed, redacted, idempotent, and measured.')
console.log('- Optional email suppression is checked before send.')
