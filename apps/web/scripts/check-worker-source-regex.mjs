#!/usr/bin/env node
// Pre-merge guard (launch:contracts): no raw non-Latin-1 character inside a
// regex literal in code that is bundled into the web Worker. See
// worker-source-encoding.mjs for why this doubles the Worker's memory.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findNonLatin1, findNonLatin1RegexLiterals } from './worker-source-encoding.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const roots = ['apps/web', 'packages/shared/src', 'packages/db/src']
const skipDirs = new Set(['node_modules', '.next', '.next-build', '.open-next', '.wrangler', 'out', 'public'])
const sourceExt = /\.(ts|tsx|js|jsx|mjs|cjs)$/

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name) || name.startsWith('.next')) continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) yield* walk(path)
    else if (sourceExt.test(name) && !name.endsWith('.d.ts')) yield path
  }
}

const failures = []
let scanned = 0
for (const root of roots) {
  const abs = join(repoRoot, root)
  try {
    statSync(abs)
  } catch {
    continue
  }
  for (const file of walk(abs)) {
    const text = readFileSync(file, 'utf8')
    scanned++
    if (findNonLatin1(text, { limit: 0 }).count === 0) continue
    for (const hit of findNonLatin1RegexLiterals(text, file)) {
      failures.push(`${relative(repoRoot, file)}:${hit.line}  ${hit.literal}`)
    }
  }
}

if (failures.length) {
  console.error(
    'Raw non-Latin-1 characters in regex literals bundled into the web Worker.\n' +
      'esbuild does not escape regex literals, so this makes V8 hold the entire\n' +
      'Worker source as UTF-16 (2x memory, Cloudflare error 1102 under load).\n' +
      'Write each such character as \\uXXXX instead:\n',
  )
  for (const line of failures) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`Worker source regex encoding: ${scanned} files OK`)
