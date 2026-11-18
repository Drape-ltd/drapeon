#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const migrationsDir = join(root, 'supabase/migrations')
const migrations = readdirSync(migrationsDir)
  .filter((file) => /^\d+_.*\.sql$/u.test(file))
  .sort()
  .map((file) => ({ file, source: readFileSync(join(migrationsDir, file), 'utf8') }))

// lifecycle_state is a schema-level public-eligibility input. A migration that
// introduces it must also update is_public_tailor_profile somewhere at or after
// that migration. This catches a future split where the column is added but the
// authorization helper silently keeps the old definition.
const lifecycleAdd = /add\s+column(?:\s+if\s+not\s+exists)?\s+lifecycle_state\b/iu
const helperUpdate = /create\s+or\s+replace\s+function\s+public\.is_public_tailor_profile\s*\(/iu

for (let index = 0; index < migrations.length; index += 1) {
  if (!lifecycleAdd.test(migrations[index].source)) continue

  const matchingHelper = migrations
    .slice(index)
    .find(({ source }) => helperUpdate.test(source) && /lifecycle_state/iu.test(source))

  assert.ok(
    matchingHelper,
    `${migrations[index].file} adds lifecycle_state without updating is_public_tailor_profile`,
  )
}

const productionForwardHelper = readFileSync(
  join(root, 'supabase/migrations/20261118014508_phase4_production_tailor_profile_policy_helpers.sql'),
  'utf8',
)
const publicHelperBody = productionForwardHelper.match(
  /create\s+or\s+replace\s+function\s+public\.is_public_tailor_profile[\s\S]*?as\s+\$\$([\s\S]*?)\$\$/iu,
)

assert.ok(publicHelperBody, 'production forward migration must define is_public_tailor_profile')
assert.doesNotMatch(
  publicHelperBody[1],
  /lifecycle_state/iu,
  'Production public-profile helper must use the current Production predicate, not Dev-only lifecycle_state',
)
for (const predicate of ['tp.id::text = p_tailor_profile_id', 'tp.is_live', 'tp.is_verified', 'not tp.is_test_profile']) {
  assert.match(
    publicHelperBody[1],
    new RegExp(predicate.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'),
    `Production public-profile helper must retain ${predicate}`,
  )
}

assert.match(
  productionForwardHelper,
  /is_public_tailor_profile\(tailor_profile_id::text\)/u,
  'dependent policies must work with both UUID and text profile IDs',
)

console.log('Tailor lifecycle/helper contract passed.')
