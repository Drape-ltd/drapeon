import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { resolveCloudflareBuildMode } from './cf-build-mode.mjs'
import { readProductionWorkerVars, withProductionWorkerVars } from './worker-build-env.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const envLocalPath = resolve(scriptDir, '..', '.env.local')
const productionProjectRef = 'wkfsrunetmgjdtcurmoj'

function parseEnvFile(content) {
  const entries = {}

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    entries[key] = value
  }

  return entries
}

function getSupabaseProjectRef(url) {
  if (url === 'https://auth.drapeon.co') return 'wkfsrunetmgjdtcurmoj'
  const match = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/u)
  return match?.[1] ?? null
}

function readEnvLocal() {
  if (!existsSync(envLocalPath)) {
    return {}
  }

  return parseEnvFile(readFileSync(envLocalPath, 'utf8'))
}

function logSupabaseRef(mode, envLocal) {
  const shellUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? null
  const fileUrl = envLocal.NEXT_PUBLIC_SUPABASE_URL ?? null
  const activeUrl = shellUrl ?? fileUrl
  const ref = getSupabaseProjectRef(activeUrl)

  if (!ref) return

  const source = shellUrl ? 'shell env' : 'apps/web/.env.local'
  console.log(`[web env] ${mode} using Supabase project ref ${ref} from ${source}.`)
}

function assertSafeDeployEnv(mode) {
  const envLocal = readEnvLocal()
  const wranglerVars = readProductionWorkerVars()
  logSupabaseRef(mode, envLocal)

  if (mode !== 'deploy') {
    return
  }

  // A branch build must never publish the production Worker. In hosted CI,
  // require an explicit, unambiguous main-branch signal before any build or
  // deploy subprocess is started. Local manual deploys remain possible.
  if (
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    process.env.WORKERS_CI === '1' ||
    process.env.CF_PAGES ||
    process.env.CF_PAGES_BRANCH ||
    process.env.GITHUB_ACTIONS === 'true'
  ) {
    const branchSignals = [
      process.env.WORKERS_CI_BRANCH,
      process.env.CF_PAGES_BRANCH,
      process.env.GITHUB_REF_NAME,
    ].filter(Boolean)
    if (!branchSignals.length || branchSignals.some((branch) => branch !== 'main')) {
      console.error(
        `[web env] Refusing production deploy from branch ${branchSignals.join(', ') || 'unknown'}; only main may deploy.`
      )
      process.exit(1)
    }
  }

  const publicSupabaseUrlKeys = [
    'DRAPEON_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
  ]
  const publicSupabaseKeyKeys = [
    'DRAPEON_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
  ]
  const publicSupabaseKeys = [...publicSupabaseUrlKeys, ...publicSupabaseKeyKeys]
  const presentKeys = publicSupabaseKeys.filter((key) => Boolean(envLocal[key]))
  const localUrl = publicSupabaseUrlKeys
    .map((key) => envLocal[key])
    .find((value) => Boolean(value))
  const localRef = getSupabaseProjectRef(localUrl)
  const shellUrl =
    process.env.DRAPEON_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    null
  const shellRef = getSupabaseProjectRef(shellUrl)
  const wranglerRef = getSupabaseProjectRef(wranglerVars.NEXT_PUBLIC_SUPABASE_URL)
  const expectedRef = wranglerVars.DRAPE_EXPECTED_SUPABASE_PROJECT_REF

  if (
    wranglerVars.DRAPE_WEB_ENV !== 'production' ||
    expectedRef !== productionProjectRef ||
    wranglerRef !== productionProjectRef
  ) {
    console.error(
      `[web env] Refusing deploy because wrangler.jsonc is not locked to production project ${productionProjectRef}.`
    )
    process.exit(1)
  }

  if (shellUrl && shellRef !== productionProjectRef) {
    console.error(
      `[web env] Refusing deploy because the shell resolves public Supabase access to ` +
        `${shellRef ?? 'an invalid URL'}, not production project ${productionProjectRef}.`
    )
    process.exit(1)
  }

  if (!presentKeys.length) {
    return
  }

  const projectLabel = localRef ? ` for project ${localRef}` : ''

  if (
    process.env.ALLOW_LOCAL_WEB_ENV_DEPLOY !== '1' ||
    localRef !== productionProjectRef
  ) {
    console.error(
      `[web env] Refusing Cloudflare deploy because apps/web/.env.local defines ${presentKeys.join(', ')}${projectLabel}.`
    )
    console.error(
      `[web env] ALLOW_LOCAL_WEB_ENV_DEPLOY=1 may only permit a local file already locked to production project ${productionProjectRef}; it can never permit DEV.`
    )
    process.exit(1)
  }

  console.log(
    `[web env] Local deploy override accepted only because apps/web/.env.local targets production project ${productionProjectRef}.`
  )
}

const forcedMode = process.argv[2]
const workersCiBranch = process.env.WORKERS_CI_BRANCH?.trim() || null
let mode
try {
  mode = resolveCloudflareBuildMode({ forcedMode, workersCiBranch })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

assertSafeDeployEnv(mode)

if (mode === 'skip') {
  console.log(`Worker build for branch ${workersCiBranch} completed without publishing. Configure isolated Worker Previews before enabling branch deployments.`)
  process.exit(0)
}

function runOpenNext(openNextMode) {
  let childEnv = { ...process.env }

  if (mode === 'deploy') {
    // OpenNext reads Next's canonical output directory. Local `pnpm build`
    // continues to use `.next-build` so it cannot churn a live dev server.
    childEnv.NEXT_DIST_DIR = '.next'
    childEnv = withProductionWorkerVars(childEnv, readProductionWorkerVars())
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, ['exec', 'opennextjs-cloudflare', openNextMode], {
      stdio: 'inherit',
      env: childEnv,
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
        return
      }

      if ((code ?? 1) !== 0) {
        reject(new Error(`OpenNext ${openNextMode} exited with code ${code ?? 1}.`))
        return
      }

      resolve()
    })
  })
}

try {
  if (mode === 'deploy') {
    await runOpenNext('build')
  }

  await runOpenNext(mode)
} catch (error) {
  console.error(`Failed to run OpenNext ${mode}:`, error instanceof Error ? error.message : error)
  process.exit(1)
}
