import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const guard = readFileSync(new URL('./supabase-target-guard.mjs', import.meta.url), 'utf8')
const edgeMap = JSON.parse(readFileSync(new URL('../supabase/functions/import_map.json', import.meta.url), 'utf8'))
const accountProfileConfig = JSON.parse(readFileSync(new URL('../supabase/functions/account-profile-action/deno.json', import.meta.url), 'utf8'))
const mutableTslib = 'https://esm.sh/tslib@2.8.1/denonext/tslib.mjs'

test('guarded single and all-function deploys pass the Edge import map', () => {
  assert.equal(guard.match(/'--import-map', SUPABASE_FUNCTION_IMPORT_MAP/g)?.length, 2)
})

test('Edge dependency maps replace mutable esm.sh tslib with exact npm tslib', () => {
  assert.equal(edgeMap.imports[mutableTslib], 'npm:tslib@2.8.1')
  assert.equal(accountProfileConfig.imports[mutableTslib], 'npm:tslib@2.8.1')
})
