import { spawnSync } from 'node:child_process'
import './cf-build-branch-guard.mjs'
import { readProductionWorkerVars, withProductionWorkerVars } from './worker-build-env.mjs'

const vars = readProductionWorkerVars()
if (vars.DRAPE_WEB_ENV !== 'production' || vars.NEXT_PUBLIC_QUOTE_NEGOTIATION_V1 !== 'true') {
  console.error('Refusing production web build: Wrangler release flags are missing or disabled.')
  process.exit(1)
}

const env = withProductionWorkerVars(process.env, vars)
env.NEXT_DIST_DIR = '.next'
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

for (const args of [
  ['--filter', '@drape/studio', 'build'],
  ['exec', 'opennextjs-cloudflare', 'build'],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Fail closed if the deployable Worker script is not Latin-1: one character
// above U+00FF doubles the script's V8 heap cost and caused error 1102.
const encoding = spawnSync(process.execPath, ['./scripts/check-worker-bundle-encoding.mjs'], { stdio: 'inherit', env })
if (encoding.error || encoding.status !== 0) process.exit(encoding.status || 1)
