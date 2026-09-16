#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const errors = []

function read(relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8')
  } catch {
    errors.push(`Missing welcome delivery surface: ${relativePath}`)
    return ''
  }
}

const contract = read('packages/shared/src/lifecycle-welcome.ts')
const worker = read('supabase/functions/process-job-queue/index.ts')
const accountEmail = read('supabase/functions/_shared/account-email.ts')
const migration = read('supabase/migrations/20260915120000_account_welcome_lifecycle.sql')
const materials = read('docs/drapeon-launch-materials-and-welcome-copy.md')

for (const needle of [
  'WELCOME_CUSTOMER_V1',
  'WELCOME_CUSTOMER_NEXT_STEP_V1',
  'WELCOME_TAILOR_V1',
  'WELCOME_TAILOR_NEXT_STEP_V1',
  'welcomeIdempotencyKey',
]) {
  if (!contract.includes(needle)) errors.push(`Welcome contract is missing ${needle}.`)
  if (!materials.includes(needle)) errors.push(`Launch materials are missing ${needle}.`)
}

for (const needle of [
  "p_idempotency_key => 'welcome:' || lower(v_role) || ':' || v_user_id || ':welcome'",
  "p_idempotency_key => 'welcome:' || lower(v_role) || ':' || v_user_id || ':next_step'",
  "'recipientName', v_recipient_name",
]) {
  if (!migration.includes(needle)) errors.push(`Welcome migration is missing ${needle}.`)
}

for (const needle of [
  'getWelcomeMessage',
  'ensureWelcomeRole',
  'ensureWelcomeStep',
  'idempotencyKey: job.dedupe_key',
  'recipientName: asString(payload.recipientName)',
  'templateKey: welcomeMessage?.templateKey',
  'subject: welcomeMessage?.subject ?? requireString(payload, "subject")',
  'headline: welcomeMessage?.headline ?? requireString(payload, "headline")',
  'body: welcomeMessage?.body ?? requireString(payload, "body")',
  'ctaLabel: welcomeMessage?.ctaLabel ?? requireString(payload, "ctaLabel")',
  'webPath: welcomeMessage?.webPath ?? requireString(payload, "webPath")',
  'template_key: welcomeTemplate?.templateKey',
  'welcome_role: welcomeTemplate ? welcomeRole : null',
  'welcome_step: welcomeTemplate ? welcomeStep : null',
]) {
  if (!worker.includes(needle)) errors.push(`Welcome worker is missing ${needle}.`)
}

for (const needle of [
  'accountEmailProviderHeaders',
  "headers['Idempotency-Key']",
  'X-Drapeon-Template-Key',
  'templateKey?: string | null',
  'recipientName?: string | null',
  'providerReference',
  "status: 'ACCEPTED'",
]) {
  if (!accountEmail.includes(needle)) errors.push(`Account email delivery is missing ${needle}.`)
}

for (const boundary of [
  'Resend is a delivery',
  'suppression ledger',
  'marketing consent',
  'passwords, auth tokens, recovery codes',
]) {
  if (!materials.includes(boundary)) errors.push(`Welcome materials are missing boundary: ${boundary}.`)
}

if (errors.length) {
  console.error('Welcome delivery surface check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Welcome delivery surface check passed.')
console.log('- Canonical role copy, origin-correct CTAs, and provider idempotency are bound.')
