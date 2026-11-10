#!/usr/bin/env node
// Post-build guard (cf-build.mjs): bundle the built OpenNext Worker exactly as
// `wrangler deploy` would (--dry-run) and fail if the script contains any
// character above U+00FF. Such a character makes V8 hold the whole script as
// UTF-16, doubling its memory. See worker-source-encoding.mjs.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findNonLatin1 } from './worker-source-encoding.mjs'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = mkdtempSync(join(tmpdir(), 'drape-worker-bundle-'))
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

try {
  const result = spawnSync(command, ['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', outdir], {
    cwd: webRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  })
  if (result.error || result.status !== 0) {
    console.error('Worker bundle encoding check: wrangler --dry-run bundling failed.')
    if (result.error) console.error(result.error)
    process.exit(result.status || 1)
  }

  const scripts = readdirSync(outdir).filter((name) => /\.(m?js|cjs)$/.test(name))
  if (scripts.length === 0) {
    console.error(`Worker bundle encoding check: no script found in ${outdir}.`)
    process.exit(1)
  }

  let failed = false
  for (const name of scripts) {
    const path = join(outdir, name)
    const text = readFileSync(path, 'utf8')
    const { count, hits } = findNonLatin1(text)
    const mb = (bytes) => (bytes / 1048576).toFixed(1)
    const size = statSync(path).size
    if (count === 0) {
      console.log(`Worker bundle encoding: ${name} ${mb(size)} MB, Latin-1 (V8 one-byte source ~${mb(text.length)} MB)`)
      continue
    }
    failed = true
    console.error(
      `Worker bundle encoding: ${name} has ${count} character(s) above U+00FF, so V8 will hold its ` +
        `${text.length.toLocaleString()} characters as UTF-16 (~${mb(text.length * 2)} MB instead of ~${mb(text.length)} MB).`,
    )
    for (const hit of hits) console.error(`  ${hit.codePoint} ${hit.char}  …${hit.context}…`)
  }
  if (failed) {
    console.error('Escape these characters (\\uXXXX) at their source; they are usually inside a regex literal.')
    process.exit(1)
  }
} finally {
  rmSync(outdir, { recursive: true, force: true })
}
