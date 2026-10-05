import { readFileSync } from 'node:fs'

export function readProductionWorkerVars() {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))
  return config.vars ?? {}
}

export function withProductionWorkerVars(shellEnv, workerVars) {
  const env = { ...shellEnv }
  for (const [key, value] of Object.entries(workerVars)) {
    if (typeof value === 'string') env[key] = value
  }
  return env
}
