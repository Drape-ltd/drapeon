import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

const guard = readFileSync(new URL('./supabase-target-guard.mjs', import.meta.url), 'utf8')
const edgeMap = JSON.parse(readFileSync(new URL('../supabase/functions/import_map.json', import.meta.url), 'utf8'))
const mutableTslib = 'https://esm.sh/tslib@2.8.1/denonext/tslib.mjs'

test('guarded single and all-function deploys pass the Edge import map', () => {
  assert.equal(guard.match(/'--import-map', SUPABASE_FUNCTION_IMPORT_MAP/g)?.length, 2)
})

test('Edge dependency maps replace mutable esm.sh tslib with exact npm tslib', () => {
  assert.equal(edgeMap.imports[mutableTslib], 'npm:tslib@2.8.1')
})

test('shared Edge import map is a superset of every function deno.json import', () => {
  const functionsDirectory = new URL('../supabase/functions/', import.meta.url)
  const functionConfigs = readdirSync(functionsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => new URL(`${entry.name}/deno.json`, functionsDirectory))
    .filter((configUrl) => {
      try {
        readFileSync(configUrl, 'utf8')
        return true
      } catch {
        return false
      }
    })

  assert.ok(functionConfigs.length > 0, 'expected at least one function-level deno.json')

  for (const configUrl of functionConfigs) {
    const config = JSON.parse(readFileSync(configUrl, 'utf8'))
    for (const [specifier, target] of Object.entries(config.imports ?? {})) {
      assert.equal(
        edgeMap.imports[specifier],
        target,
        `${configUrl.pathname} import ${specifier} must be identical in the shared Edge map`,
      )
    }
  }
})
