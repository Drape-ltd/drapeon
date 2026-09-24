#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const errors = []

function read(relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8')
  } catch {
    errors.push(`Missing Resend delivery webhook artifact: ${relativePath}`)
    return ''
  }
}

const verifier = read('supabase/functions/_shared/resend-webhook.ts')
const handler = read('supabase/functions/resend-email-webhook/index.ts')
const migration = read('supabase/migrations/20260916120000_resend_delivery_webhook.sql')
const config = read('supabase/config.toml')
const secretManifest = read('scripts/supabase-target-guard.mjs')
const materials = read('docs/drapeon-launch-materials-and-welcome-copy.md')

for (const event of [
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
  'email.delivery_delayed',
]) {
  if (!verifier.includes(event)) errors.push(`Verifier is missing ${event}.`)
  if (!migration.includes(event)) errors.push(`Delivery ledger is missing ${event}.`)
}

for (const marker of [
  'request.text()',
  "request.headers.get('svix-id')",
  "request.headers.get('svix-timestamp')",
  "request.headers.get('svix-signature')",
  'verifyResendWebhookSignature',
  'record_resend_email_provider_event',
  'RESEND_WEBHOOK_SECRET',
]) {
  if (!handler.includes(marker)) errors.push(`Webhook handler is missing ${marker}.`)
}

for (const marker of [
  'crypto.subtle.importKey',
  "'HMAC'",
  'WEBHOOK_CLOCK_SKEW_SECONDS',
  'RESEND_DELIVERY_EVENT_TYPES',
  'data?.email_id',
]) {
  if (!verifier.includes(marker)) errors.push(`Webhook verifier is missing ${marker}.`)
}

for (const marker of [
  'create table if not exists public.email_provider_events',
  'unique (provider, provider_event_id)',
  'enable row level security',
  'revoke all on table public.email_provider_events from public, anon, authenticated',
  'email_provider_events_provider_reference_idx',
  'record_resend_email_provider_event',
  'and not exists (',
  "recorded.occurred_at > p_occurred_at",
  "when p_observation_status = 'DELAYED' then outcomes.terminal_at",
]) {
  if (!migration.includes(marker)) errors.push(`Delivery ledger is missing ${marker}.`)
}

for (const forbidden of [
  'data?.to',
  'data?.from',
  'data?.subject',
  'data?.html',
  'data?.text',
  'email.opened',
  'email.clicked',
  'raw_payload:',
]) {
  if (handler.includes(forbidden) || verifier.includes(forbidden)) {
    errors.push(`Webhook persistence must not retain engagement or message data: ${forbidden}.`)
  }
}

if (!config.includes('[functions.resend-email-webhook]\nverify_jwt = false')) {
  errors.push('Supabase config must expose the signed Resend webhook without JWT enforcement.')
}
if (!secretManifest.includes("'RESEND_WEBHOOK_SECRET'")) {
  errors.push('Supabase secret manifest must require RESEND_WEBHOOK_SECRET.')
}
for (const boundary of [
  'provider terminal outcome',
  'Resend is a delivery',
  'suppression ledger',
]) {
  if (!materials.includes(boundary)) errors.push(`Launch materials are missing delivery boundary: ${boundary}.`)
}

if (errors.length) {
  console.error('Resend delivery webhook check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Resend delivery webhook check passed.')
console.log('- Signed provider events are privacy-minimized, replay-safe, and release-gated.')
