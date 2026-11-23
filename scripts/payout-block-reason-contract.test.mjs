import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function* files(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* files(file)
    else if (/\.(?:ts|sql)$/.test(entry.name) && !/_test\.ts$/.test(entry.name)) yield file
  }
}

test('server payout block literals have shared copy or an explicit domain exemption', () => {
  const shared = readFileSync(path.join(root, 'packages/shared/src/payout-gating.ts'), 'utf8')
  const known = new Set(
    [...shared.matchAll(/^  ([A-Z][A-Z0-9_]+): '\1',$/gm)].map((match) => match[1]),
  )
  const otherDomains = new Map([
    ['OPEN_REVIEW', 'settlement tranche state, not payout history'],
    ['FABRIC_PAYOUT_DESTINATION_CONFLICT', 'Ops case blocker'],
    ['FABRIC_SOURCE_CHARGE_MISSING', 'Ops case blocker'],
  ])
  const unknown = []
  for (const directory of ['supabase/functions', 'supabase/migrations']) {
    for (const file of files(path.join(root, directory))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\b(?:blocked_reason|blockerCode)\s*[:=]\s*'([A-Z][A-Z0-9_]+)'/g)) {
        if (!known.has(match[1]) && !otherDomains.has(match[1])) {
          unknown.push(`${path.relative(root, file)}: ${match[1]}`)
        }
      }
    }
  }
  assert.deepEqual(unknown, [])
})
