import { spawnSync } from 'node:child_process'
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
