import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const roots = ['apps/web', 'apps/ops', 'supabase/functions']
const expected = [
  'apps/web/app/ops/action/route.ts',
  'apps/web/lib/money-desk-execution.ts',
  'supabase/functions/_shared/ops-money-execution.ts',
  'supabase/functions/_shared/reviewed-claimed-tranche-monitor.ts',
  'supabase/functions/_shared/reviewed-claimed-tranche-monitor_test.ts',
  'supabase/functions/monitor-settlements/index.ts',
  'supabase/functions/release-settlement-tranche/index.ts',
  'supabase/functions/release-tailor-adjustment/index.ts',
]
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/u.test(name) ? [path] : []
  })
}

test('all release-function callers are explicitly reviewed', () => {
  const actual = roots.flatMap(files).filter((path) =>
    /release-settlement-tranche|release-tailor-adjustment/u.test(readFileSync(path, 'utf8')))
    .map((path) => relative('.', path)).sort()
  assert.deepEqual(actual, expected)
  for (const entry of [
    'supabase/functions/release-settlement-tranche/index.ts',
    'supabase/functions/release-tailor-adjustment/index.ts',
  ]) {
    const source = readFileSync(entry, 'utf8')
    assert.ok(source.includes('withStripeReleasePreflight'), `${entry} must gate claims at the Edge entry point`)
  }
})
