#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const shared = read('packages/shared/src/marketing-topics.ts')
const binding = read('supabase/migrations/20260915153000_campaign_topic_binding.sql')
const errors = []

const definitions = [...shared.matchAll(/^  ([A-Z_]+): \{([\s\S]*?)^  \},/gmu)]
  .map((match) => ({ key: match[1], body: match[2] }))
  .map(({ key, body }) => ({ key, alias: body.match(/providerTopicAlias:\s*'([^']+)'/u)?.[1] }))

if (definitions.length === 0) errors.push('No marketing topic definitions were found.')

for (const { key, alias } of definitions) {
  if (!alias) {
    errors.push(`${key} is missing providerTopicAlias in the shared contract.`)
    continue
  }
  if (!binding.includes(`when '${key}' then '${alias}'`)) {
    errors.push(`${key} provider alias ${alias} is missing or drifted in the campaign binding migration.`)
  }
  if (!binding.includes(`when '${key}' then`)) {
    errors.push(`${key} is missing from the database topic eligibility contract.`)
  }
}

if (!binding.includes('communication_campaigns_marketing_topic_key_check')) {
  errors.push('Campaign topic binding must constrain topic keys at the database boundary.')
}
if (!binding.includes('communication_campaigns_marketing_topic_category_check')) {
  errors.push('Campaign topic binding must remain scoped to promotion/product-update categories.')
}
if (!binding.includes('communication_campaign_recipient_topic_contract')) {
  errors.push('Campaign topic binding must snapshot and filter recipients before queueing.')
}
if (!binding.includes("status = 'GRANTED'")) {
  errors.push('Campaign topic binding must re-check current channel consent before queueing.')
}

if (errors.length) {
  console.error('Marketing topic parity failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Marketing topic parity passed.')
console.log(`- ${definitions.length} shared topics match the campaign provider-alias and eligibility contract.`)
